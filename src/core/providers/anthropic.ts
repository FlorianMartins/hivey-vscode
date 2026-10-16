// Anthropic's native Messages API. Kept separate from the OpenAI shape rather than proxied
// through a compatibility layer for one reason that matters to the cost target: PROMPT CACHING
// is explicit here. Marking the stable prefix — system prompt, repository map, the files already
// discussed — makes every later turn of a conversation cost a fraction of the first, and that is
// the single biggest lever on a coding assistant's bill, because a coding conversation resends
// almost the same context on every turn.

import { request } from "../util/http.js";
import { sseData, sseLines } from "../util/sse.js";
import type { ChatDelta, ChatRequest, ChatResult, Provider, ToolCall, Usage } from "./types.js";
import { toolCallsFromText } from "./textToolCall.js";
import { EMPTY_USAGE } from "./types.js";
import { anthropicThinking } from "./reasoningMap.js";
import { keepCacheMarks } from "./cache.js";
import { describeHttpError, isCompleteJson } from "./openai.js";

export interface AnthropicOptions {
  baseUrl: string;
  apiKey: string;
  version?: string;
}

/**
 * The most a model may write, learned from the API's own refusal, per model.
 *
 * ⚠️ "adapt to the models' own limits, don't add manual limits". The API demands a `max_tokens`, and
 * a fixed figure is a cap on every model that could write more. So the turn asks for a generous
 * one, and a model that cannot go that far says so — "max_tokens: 64000 > 32000, which is the
 * maximum allowed number of output tokens for …" — and the request is sent again at exactly its
 * limit, which is remembered.
 */
const learnedMaxOutput = new Map<string, number>();
const GENEROUS_MAX_OUTPUT = 64_000;

export class AnthropicProvider implements Provider {
  readonly id = "anthropic";
  readonly baseUrl: string;
  readonly isLocal = false;
  private readonly opts: AnthropicOptions;

  constructor(opts: AnthropicOptions) {
    this.opts = opts;
    this.baseUrl = opts.baseUrl.replace(/\/+$/, "");
  }

  async chat(req: ChatRequest, onDelta?: (d: ChatDelta) => void): Promise<ChatResult> {
    const system = req.messages.filter((m) => m.role === "system");
    const rest = req.messages.filter((m) => m.role !== "system");

    // One budget of four breakpoints, shared by the system blocks and the messages, in that order —
    // which is the order the API reads them in. Beyond four Anthropic rejects the request outright,
    // and a repository with two skills loaded reaches five without anyone doing anything unusual.
    const wanted: number[] = [];
    system.forEach((m, i) => {
      if (m.cacheable !== false) wanted.push(i);
    });
    rest.forEach((m, i) => {
      if (m.cacheable) wanted.push(system.length + i);
    });
    const marks = keepCacheMarks(wanted);

    const body: Record<string, unknown> = {
      model: req.model,
      // The API demands a figure. With no cap asked for: the model's own, once it has said it.
      max_tokens: req.maxTokens ?? learnedMaxOutput.get(req.model) ?? GENEROUS_MAX_OUTPUT,
      stream: true,
      messages: rest.map((m, index) => {
        if (m.role === "tool") {
          return { role: "user", content: [{ type: "tool_result", tool_use_id: m.toolCallId, content: m.content }] };
        }
        // Signed thinking blocks first, as the API returned them — see `ChatMessage.thinkingBlocks`.
        const thought = m.role === "assistant" ? (m.thinkingBlocks ?? []) : [];
        if (m.toolCalls?.length) {
          const blocks: unknown[] = [...thought];
          if (m.content) blocks.push({ type: "text", text: m.content });
          for (const t of m.toolCalls) {
            blocks.push({ type: "tool_use", id: t.id, name: t.name, input: safeJson(t.args) });
          }
          return { role: "assistant", content: blocks };
        }
        const block: Record<string, unknown> = { type: "text", text: m.content };
        // A cache breakpoint costs nothing when it misses and saves ~90 % of the input price when
        // it hits. Which ones survive the ceiling of four is decided once, above.
        if (marks.has(system.length + index)) block["cache_control"] = { type: "ephemeral" };
        // Images after the text, for the same reason as everywhere else: a model handed a picture
        // before the question it is about describes the picture instead of answering.
        const images = (m.images ?? []).map((img) => ({
          type: "image",
          source: { type: "base64", media_type: img.mediaType, data: img.data },
        }));
        return { role: m.role === "assistant" ? "assistant" : "user", content: [...thought, block, ...images] };
      }),
    };
    if (system.length) {
      body["system"] = system.map((s, i) => {
        const b: Record<string, unknown> = { type: "text", text: s.content };
        if (marks.has(i)) b["cache_control"] = { type: "ephemeral" };
        return b;
      });
    }
    // Thinking, per model family — see providers/reasoningMap.ts, where each rule cites the docs.
    // A chore is not a level anybody picked: the model's own default, as an unpicked turn.
    const think = anthropicThinking(req.model, req.chore ? undefined : req.reasoning);
    if (think.thinking) body["thinking"] = think.thinking;
    if (think.effort) body["output_config"] = { effort: think.effort };
    if (think.headroom) {
      // Thinking tokens count against `max_tokens`: a cap the caller set is for the ANSWER, so the
      // thinking is added on top — the API also refuses a budget that is not below max_tokens.
      const asked = Number(body["max_tokens"]);
      const ceiling = learnedMaxOutput.get(req.model);
      const wanted = req.maxTokens !== undefined ? asked + think.headroom : Math.max(asked, think.headroom + 4096);
      body["max_tokens"] = ceiling ? Math.min(wanted, ceiling) : wanted;
    }
    // Refused outright on the newest models, and alongside thinking on the older ones.
    if (think.temperature && req.temperature != null) body["temperature"] = req.temperature;
    if (req.tools?.length) {
      body["tools"] = req.tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters }));
    }

    const send = () =>
      request(`${this.baseUrl}/messages`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": this.opts.apiKey.trim(),
          "anthropic-version": this.opts.version ?? "2023-06-01",
        },
        body: JSON.stringify(body),
        signal: req.signal,
        timeoutMs: 180_000,
        label: "chat",
      });
    let res = await send();
    if (!res.ok && req.maxTokens === undefined) {
      const said = await describeHttpError(res);
      const limit = maxOutputFromRefusal(said);
      if (!limit) throw new Error(said);
      learnedMaxOutput.set(req.model, limit);
      body["max_tokens"] = limit;
      res = await send();
    }
    if (!res.ok || !res.body) throw new Error(await describeHttpError(res));

    let text = "";
    let reasoning = "";
    let stopReason: ChatResult["stopReason"] = "stop";
    const usage: Usage = { ...EMPTY_USAGE };
    const blocks = new Map<number, { type: string; id?: string; name?: string; json: string; thinking?: string; signature?: string; data?: string }>();

    for await (const line of sseLines(res.body, req.signal)) {
      const ev = sseData(line) as any;
      if (!ev) continue;
      switch (ev.type) {
        case "message_start": {
          const u = ev.message?.usage;
          if (u) {
            usage.promptTokens = u.input_tokens ?? 0;
            // Reads are the cheap tokens; writes are billed at a premium once and repay on turn 2.
            usage.cachedTokens = u.cache_read_input_tokens ?? 0;
            usage.promptTokens += (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0);
          }
          break;
        }
        case "content_block_start":
          blocks.set(ev.index, {
            type: ev.content_block?.type,
            id: ev.content_block?.id,
            name: ev.content_block?.name,
            json: "",
            ...(ev.content_block?.type === "thinking" ? { thinking: ev.content_block?.thinking ?? "", signature: ev.content_block?.signature ?? "" } : {}),
            ...(ev.content_block?.type === "redacted_thinking" ? { data: ev.content_block?.data } : {}),
          });
          break;
        case "content_block_delta": {
          const d = ev.delta ?? {};
          if (d.type === "text_delta" && d.text) {
            text += d.text;
            onDelta?.({ text: d.text });
          } else if (d.type === "thinking_delta" && d.thinking) {
            reasoning += d.thinking;
            onDelta?.({ reasoning: d.thinking });
            const b = blocks.get(ev.index);
            if (b) b.thinking = (b.thinking ?? "") + d.thinking;
          } else if (d.type === "signature_delta" && d.signature) {
            const b = blocks.get(ev.index);
            if (b) b.signature = (b.signature ?? "") + d.signature;
          } else if (d.type === "input_json_delta") {
            const b = blocks.get(ev.index);
            if (b) b.json += d.partial_json ?? "";
          }
          break;
        }
        case "message_delta":
          if (ev.usage?.output_tokens) usage.completionTokens = ev.usage.output_tokens;
          if (ev.delta?.stop_reason === "max_tokens") stopReason = "length";
          if (ev.delta?.stop_reason === "tool_use") stopReason = "tool_calls";
          break;
        case "error":
          throw new Error(ev.error?.message ?? "Anthropic stream error");
      }
    }

    const toolCalls: ToolCall[] = [...blocks.entries()]
      .filter(([, b]) => b.type === "tool_use")
      .sort((a, b) => a[0] - b[0])
      .map(([i, b]) => ({ id: b.id ?? `call_${i}`, name: b.name ?? "", args: b.json || "{}" }))
      .filter((t) => t.name);

    // The same fallback the OpenAI-compatible client has, for the same reason, applied here for
    // symmetry rather than because Anthropic needs it: `api.anthropic.com` always returns `tool_use`
    // natively. What does not is a GATEWAY speaking Anthropic's shape in front of something else —
    // which is an ordinary enterprise deployment, and would have failed exactly as Ollama did.
    // Leaving one of the two clients without the fallback would mean the bug is fixed depending on
    // which wire format the operator's proxy happens to speak.
    if (!toolCalls.length && text.trim()) {
      const written = toolCallsFromText(text, (req.tools ?? []).map((t) => t.name));
      if (written.length) {
        toolCalls.push(...written);
        text = "";
      }
    }
    // Cut off by `max_tokens`: an unfinished call is dropped and "length" kept, as in the
    // OpenAI-compatible client — see the note there.
    const cut = stopReason === "length";
    const usable = cut ? toolCalls.filter((c) => isCompleteJson(c.args)) : toolCalls;
    if (usable.length && !cut) stopReason = "tool_calls";

    // The signed thinking, to go back with the calls it led to. A block without its signature cannot
    // be verified and would be refused, so it is not kept.
    const thinkingBlocks = [...blocks.entries()]
      .sort((a, b) => a[0] - b[0])
      .flatMap(([, b]): Array<Record<string, string>> =>
        b.type === "thinking" && b.signature
          ? [{ type: "thinking", thinking: b.thinking ?? "", signature: b.signature }]
          : b.type === "redacted_thinking" && b.data
            ? [{ type: "redacted_thinking", data: b.data }]
            : [],
      );

    return { text, reasoning, toolCalls: usable, usage, stopReason, ...(thinkingBlocks.length ? { thinkingBlocks } : {}) };
  }

  async listModels(): Promise<string[]> {
    const res = await request(`${this.baseUrl}/models`, {
      headers: { "x-api-key": this.opts.apiKey.trim(), "anthropic-version": this.opts.version ?? "2023-06-01" },
      timeoutMs: 15_000,
      label: "model list",
    });
    if (!res.ok) throw new Error(await describeHttpError(res));
    const json = (await res.json()) as any;
    return (json.data ?? []).map((m: any) => m.id).filter(Boolean);
  }
}

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return {};
  }
}

/** The model's own output limit, from a refusal of a larger `max_tokens`; 0 when it is not one. */
export function maxOutputFromRefusal(message: string): number {
  const m = /max_tokens:\s*(\d+)\s*>\s*(\d+)/.exec(message);
  return m && Number(m[2]) < Number(m[1]) ? Number(m[2]) : 0;
}
