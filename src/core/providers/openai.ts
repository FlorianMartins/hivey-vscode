// The OpenAI-compatible wire format — which by now is what almost everything speaks: Ollama,
// LM Studio, llama.cpp, vLLM, TGI, LiteLLM, Azure, OpenRouter, and OpenAI itself.
//
// Two provider-specific details are worth the branches:
//   • OpenRouter returns the REAL cost of a call when asked (`usage.include`), which is the only
//     way a budget can be enforced on facts instead of on an estimate.
//   • Ollama exposes fill-in-the-middle through its native `/api/generate` with a `suffix`, and
//     that path is much better than hand-writing FIM tokens into a chat prompt.

import { request } from "../util/http.js";
import { sseData, sseLines } from "../util/sse.js";
import type {
  ChatDelta,
  ChatRequest,
  ChatResult,
  CompletionRequest,
  Provider,
  ToolCall,
  Usage,
} from "./types.js";
import { EMPTY_USAGE } from "./types.js";
import { keepCacheMarks } from "./cache.js";
import { toolCallsFromText } from "./textToolCall.js";

export interface OpenAIProviderOptions {
  id: string;
  baseUrl: string;
  apiKey?: string;
  isLocal: boolean;
  /** OpenRouter attribution headers. Sent to OpenRouter ONLY: on a local server they turn the
   *  request into a preflighted one and some builds answer 403 to the OPTIONS. */
  referer?: string;
  title?: string;
  timeoutMs?: number;
  /**
   * Ask OpenRouter for Anthropic's prompt cache, which means marking content parts.
   *
   * OFF by default, and the reason is worth keeping: turning it on changes the SHAPE of the
   * request. A message's `content` stops being a string and becomes an array of parts, because that
   * is the only place `cache_control` can go. Every provider behind OpenRouter then has to accept
   * that shape, and not all of them do the same thing with it — one of them answered with an empty
   * completion, billed for the prompt, and reported no error at all. The extension looked as though
   * it had stopped working, for a week, and nothing in the request said why.
   *
   * The saving is real — a cache read costs a tenth of an input token — so the option stays. What
   * does not stay is it being on for everybody by default.
   */
  promptCache?: boolean;
}

const trimSlash = (u: string) => u.replace(/\/+$/, "");

export class OpenAICompatibleProvider implements Provider {
  readonly id: string;
  readonly baseUrl: string;
  readonly isLocal: boolean;
  private readonly opts: OpenAIProviderOptions;
  private ollamaProbe: boolean | undefined;

  constructor(opts: OpenAIProviderOptions) {
    this.opts = opts;
    this.id = opts.id;
    this.baseUrl = trimSlash(opts.baseUrl);
    this.isLocal = opts.isLocal;
  }

  /**
   * Is this endpoint an Ollama server? The port is the usual clue, but plenty of teams run it
   * behind a reverse proxy on 443 or on a custom port, and getting this wrong costs the good
   * fill-in-the-middle path. So: sniff the URL first, then probe once and remember.
   *
   * The probe only ever runs against an endpoint already classified as local. A remote provider
   * must never receive a request the user did not ask for, even an empty one.
   */
  private async isOllamaServer(): Promise<boolean> {
    if (this.ollamaProbe !== undefined) return this.ollamaProbe;
    if (isOllama(this.baseUrl)) return (this.ollamaProbe = true);
    if (!this.isLocal) return (this.ollamaProbe = false);
    try {
      const root = trimSlash(this.baseUrl).replace(/\/v1$/, "");
      const res = await request(`${root}/api/version`, { timeoutMs: 2500, label: "server probe" });
      this.ollamaProbe = res.ok;
    } catch {
      this.ollamaProbe = false;
    }
    return this.ollamaProbe;
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = { "Content-Type": "application/json" };
    const key = this.opts.apiKey?.trim();
    if (key) h["Authorization"] = `Bearer ${key}`;
    if (this.id === "openrouter") {
      if (this.opts.referer) h["HTTP-Referer"] = this.opts.referer;
      if (this.opts.title) h["X-Title"] = this.opts.title;
    }
    return h;
  }

  /**
   * Send the request, and let the server correct it.
   *
   * "OpenAI-compatible" is a family, not a specification. OpenAI's own API refuses `max_tokens` on
   * its reasoning models and demands `max_completion_tokens`; it refuses any temperature but the
   * default on the same models; several gateways reject a field they have never heard of instead of
   * ignoring it. Each of those is an HTTP 400 that ends the answer, on the models people most want
   * to use their own account for.
   *
   * The alternative to this would be a table of which vendor rejects which field for which model —
   * a table that is wrong the week a model is renamed, and this repository has already learned what
   * hard-coded model names cost. So nothing is predicted: the request goes out as written, and if
   * the server names a parameter it will not take, that parameter is removed or renamed and the
   * request goes again. At most twice, and only ever by dropping something — a retry can never add
   * a field, so it cannot turn a refusal into a different request than the user asked for.
   */
  private async post(body: Record<string, unknown>, signal?: AbortSignal): Promise<Response> {
    let attempt = body;
    let waits = 0;
    for (let tries = 0; ; tries++) {
      const res = await request(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify(attempt),
        signal,
        timeoutMs: this.opts.timeoutMs ?? 180_000,
        label: "chat",
      });

      // A 402 that carries `Retry-After` is not an empty account.
      //
      // OpenRouter answers 402 for two unrelated things. One is the balance, which no retry fixes.
      // The other is its in-flight spending budget: requests already in flight have provisionally
      // reserved credit, so a funded account is briefly told it cannot pay — and their
      // documentation is explicit that this one is a wait-and-retry case, distinguished by the
      // header. "A 402 Payment Required without the header is not a wait-and-retry case."
      //
      // Everything here treated 402 as terminal, and said so in a sentence about the account
      // balance. Somebody with a valid key and credit to spare was told their account was empty,
      // and no retry was attempted, so the turn simply ended.
      //
      // The header alone decides. Reading the body for `limit_source` would consume it, and a
      // response whose body has been drunk can no longer explain itself if the wait does not help.
      const pause = retryAfterMs(res);
      if (pause !== undefined && waits < 2) {
        waits += 1;
        await sleep(pause, signal);
        continue;
      }

      // 400 is the server objecting to a FIELD. 402 is it objecting to the SIZE — and it says by
      // how much: "you requested up to 4096 tokens, but can only afford 1991".
      //
      // ⚠️ Only 400 came here, so the one refusal that carries its own remedy was the one that never
      // reached the code that applies remedies. A funded-but-nearly-empty account got a dead end
      // where a shorter answer was available, and the fix to `adaptRequest` was unreachable until
      // this line changed. Two defects, one of them hiding the other.
      const adaptable = res.status === 400 || res.status === 402;
      if (res.ok || !adaptable || tries >= 2) return res;
      // The body has to be read to know what it objected to, which consumes it — so a response that
      // teaches us nothing is rebuilt from what was read rather than returned half-drunk.
      const detail = await res.text();
      const fixed = adaptRequest(attempt, detail);
      if (!fixed) return new Response(detail, { status: res.status, statusText: res.statusText });
      // What it accepted, so the answer can say it was shortened rather than let the user read a
      // fragment as the model's opinion.
      const capped = Number(fixed["max_tokens"] ?? fixed["max_completion_tokens"] ?? 0);
      if (res.status === 402 && capped > 0) this.lastShortened = capped;
      attempt = fixed;
    }
  }

  /**
   * The cap a 402 forced this request down to, when one did.
   *
   * On the instance rather than threaded through, because the adaptation happens two layers below
   * `chat` and the only consumer is the result it returns. Cleared at the start of every turn, so a
   * later answer never inherits an earlier shortening.
   */
  private lastShortened: number | undefined;

  async chat(req: ChatRequest, onDelta?: (d: ChatDelta) => void): Promise<ChatResult> {
    this.lastShortened = undefined;
    // The same ceiling of four, because the same models are behind OpenRouter — a request with five
    // breakpoints is refused by Anthropic whichever door it came through.
    const marks = keepCacheMarks(req.messages.flatMap((m, i) => (m.cacheable ? [i] : [])));
    const body: Record<string, unknown> = {
      model: req.model,
      stream: true,
      messages: req.messages.map((m, index) => {
        if (m.role === "tool") return { role: "tool", tool_call_id: m.toolCallId, content: m.content };
        if (m.toolCalls?.length) {
          return {
            role: m.role,
            content: m.content || null,
            tool_calls: m.toolCalls.map((t) => ({ id: t.id, type: "function", function: { name: t.name, arguments: t.args } })),
          };
        }
        // Two reasons to use the array form of `content`, and one of them is money.
        //
        // IMAGES. Text first: every provider's documentation puts it there, and a model handed an
        // image before the question it is about describes the image instead of answering.
        //
        // CACHING, on OpenRouter. Anthropic's prompt cache is not automatic — it only applies to the
        // prefixes a request explicitly marks — and OpenRouter passes the marker through in the
        // OpenAI format, on a content part. Without it, a Claude conversation routed through
        // OpenRouter pays the full input price for its system prompt, its repository map and its
        // whole transcript on EVERY request. That is what this extension's own cost report was
        // showing and nobody could see why: the marker existed, and only the native Anthropic
        // client ever emitted it. OpenAI's and DeepSeek's caches are automatic and ignore the field.
        const cache = this.opts.promptCache === true && this.id === "openrouter" && marks.has(index);
        if (m.images?.length || cache) {
          const text: Record<string, unknown> = { type: "text", text: m.content };
          if (cache) text["cache_control"] = { type: "ephemeral" };
          return {
            role: m.role,
            content: [
              text,
              ...(m.images ?? []).map((img) => ({
                type: "image_url",
                image_url: { url: `data:${img.mediaType};base64,${img.data}` },
              })),
            ],
          };
        }
        return { role: m.role, content: m.content };
      }),
    };
    if (req.maxTokens) body["max_tokens"] = req.maxTokens;
    if (req.temperature != null) body["temperature"] = req.temperature;
    if (req.tools?.length) {
      body["tools"] = req.tools.map((t) => ({
        type: "function",
        function: { name: t.name, description: t.description, parameters: t.parameters },
      }));
    }
    // Reasoning. OpenRouter normalizes it under `reasoning`; OpenAI's own API and several
    // gateways take `reasoning_effort`. Sending both is safe: an unknown field is dropped, and a
    // server that knows one of them gets the intent.
    if (req.reasoning && req.reasoning !== "none") {
      if (this.id === "openrouter") body["reasoning"] = { effort: req.reasoning };
      else body["reasoning_effort"] = req.reasoning;
    } else if (req.reasoning === "none" && this.id === "openrouter") {
      // Explicitly off, so a model that thinks by default does not bill for it.
      body["reasoning"] = { exclude: true };
    }

    // Ask for the accounting. OpenAI-compatible servers that do not know the field ignore it.
    body["stream_options"] = { include_usage: true };
    if (this.id === "openrouter") body["usage"] = { include: true };

    const res = await this.post(body, req.signal);
    if (!res.ok || !res.body) throw new Error(await describeHttpError(res, this.id));

    let text = "";
    let reasoning = "";
    let stopReason: ChatResult["stopReason"] = "stop";
    const usage: Usage = { ...EMPTY_USAGE };
    // Tool calls arrive in fragments indexed by position; assemble them by index, never by id
    // (several providers send the id only on the first fragment).
    const partial = new Map<number, { id: string; name: string; args: string }>();

    for await (const line of sseLines(res.body, req.signal)) {
      const payload = sseData(line) as any;
      if (!payload) continue;
      if (payload.error) throw new Error(payload.error.message ?? String(payload.error));
      const choice = payload.choices?.[0];
      if (payload.usage) {
        usage.promptTokens = payload.usage.prompt_tokens ?? usage.promptTokens;
        usage.completionTokens = payload.usage.completion_tokens ?? usage.completionTokens;
        usage.cachedTokens = payload.usage.prompt_tokens_details?.cached_tokens ?? usage.cachedTokens;
        if (typeof payload.usage.cost === "number") usage.costUsd = payload.usage.cost;
      }
      if (!choice) continue;
      if (choice.finish_reason === "length") stopReason = "length";
      const delta = choice.delta ?? {};
      // DeepSeek names it reasoning_content, OpenRouter normalizes to reasoning.
      const r = delta.reasoning_content ?? delta.reasoning;
      if (typeof r === "string" && r) {
        reasoning += r;
        onDelta?.({ reasoning: r });
      }
      if (typeof delta.content === "string" && delta.content) {
        text += delta.content;
        onDelta?.({ text: delta.content });
      }
      for (const tc of delta.tool_calls ?? []) {
        const idx = tc.index ?? 0;
        const cur = partial.get(idx) ?? { id: "", name: "", args: "" };
        if (tc.id) cur.id = tc.id;
        if (tc.function?.name) cur.name += tc.function.name;
        if (tc.function?.arguments) cur.args += tc.function.arguments;
        partial.set(idx, cur);
      }
    }

    const toolCalls: ToolCall[] = [...partial.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([i, t]) => ({ id: t.id || `call_${i}`, name: t.name, args: t.args || "{}" }))
      .filter((t) => t.name);

    // The call the model wrote in its message because its runtime does not emit the protocol one.
    //
    // Not an edge case: Ollama returns `qwen2.5-coder`'s tool calls as text in `content`, with
    // `tool_calls: null` and `finish_reason: "stop"` — the model named in this project's README, on
    // the runtime its README says to install. Agent mode therefore did nothing at all on the
    // default local setup: the model produced correct calls and they were printed as prose.
    //
    // Only when the protocol returned nothing, and only when the message is nothing but the call —
    // see `toolCallsFromText`, where the rules and the reasons live. The text is dropped when a call
    // is recognised, because it is not an answer and showing raw JSON as one is how this was missed.
    if (!toolCalls.length && text.trim()) {
      const written = toolCallsFromText(text, (req.tools ?? []).map((t) => t.name));
      if (written.length) {
        toolCalls.push(...written);
        text = "";
      }
    }
    if (toolCalls.length) stopReason = "tool_calls";

    return {
      text,
      reasoning,
      toolCalls,
      usage,
      stopReason,
      ...(this.lastShortened ? { shortenedTo: this.lastShortened } : {}),
    };
  }

  /**
   * Fill-in-the-middle. Ollama's native endpoint takes prefix/suffix as fields, which is both
   * simpler and more reliable than embedding the model's FIM tokens in a prompt — the server
   * knows the template for the model it loaded. Anything else goes through /completions with the
   * templated prompt the caller built.
   */
  async complete(req: CompletionRequest): Promise<string> {
    if (await this.isOllamaServer()) {
      const root = trimSlash(this.baseUrl).replace(/\/v1$/, "");
      const res = await request(`${root}/api/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        timeoutMs: 45_000,
        label: "completion",
        body: JSON.stringify({
          model: req.model,
          prompt: req.prefix,
          suffix: req.suffix,
          stream: false,
          raw: false,
          options: { num_predict: req.maxTokens, temperature: 0.1, stop: req.stop },
          // Keep the weights resident: the cost of a cold start is paid on the next keystroke.
          keep_alive: "30m",
        }),
        signal: req.signal,
      });
      if (!res.ok) throw new Error(await describeHttpError(res, this.id));
      const json = (await res.json()) as { response?: string };
      return json.response ?? "";
    }

    const res = await request(`${this.baseUrl}/completions`, {
      method: "POST",
      headers: this.headers(),
      timeoutMs: 45_000,
      label: "completion",
      body: JSON.stringify({
        model: req.model,
        prompt: req.prefix,
        suffix: req.suffix,
        max_tokens: req.maxTokens,
        temperature: 0.1,
        stop: req.stop,
        stream: false,
      }),
      signal: req.signal,
    });
    if (!res.ok) throw new Error(await describeHttpError(res, this.id));
    const json = (await res.json()) as any;
    return json.choices?.[0]?.text ?? "";
  }

  /**
   * Load the model without generating anything. Ollama unloads weights after a few minutes of
   * inactivity, and the first request after that pays the whole load time — which is the one
   * request the user is watching. Called on activation and after a long idle.
   */
  async warmup(model: string): Promise<void> {
    if (!(await this.isOllamaServer())) return;
    const root = trimSlash(this.baseUrl).replace(/\/v1$/, "");
    try {
      await request(`${root}/api/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model, prompt: "", keep_alive: "30m" }),
        timeoutMs: 120_000,
        label: "warm-up",
      });
    } catch {
      // A warm-up that fails is not an error the user needs: the next real request will report it.
    }
  }

  async listModels(): Promise<string[]> {
    try {
      const res = await request(`${this.baseUrl}/models`, { headers: this.headers(), timeoutMs: 15_000, label: "model list" });
      if (res.ok) {
        const json = (await res.json()) as any;
        const ids = (json.data ?? []).map((m: any) => m.id).filter(Boolean);
        if (ids.length) return ids;
      }
    } catch {
      /* fall through to the native listing */
    }
    // Older or proxied Ollama builds do not serve /v1/models.
    if (await this.isOllamaServer()) {
      const root = trimSlash(this.baseUrl).replace(/\/v1$/, "");
      const res = await request(`${root}/api/tags`, { timeoutMs: 15_000, label: "model list" });
      if (!res.ok) throw new Error(await describeHttpError(res, this.id));
      const json = (await res.json()) as any;
      return (json.models ?? []).map((m: any) => m.name).filter(Boolean);
    }
    return [];
  }
}

/**
 * What to drop when a server refuses a parameter, read from what it said.
 *
 * Returns a new body, or `undefined` when the complaint is not about a parameter — a missing model,
 * an empty message, a content filter — because retrying those would only spend the user's time
 * twice on the same error.
 */
/**
 * How many tokens the provider says the balance can still afford.
 *
 * OpenRouter's 402 carries the answer inside the refusal:
 *
 *     "This request requires more credits, or fewer max_tokens.
 *      You requested up to 4096 tokens, but can only afford 1991."
 *
 * and its `remedy_hint` says the same thing: add credit, **or lower `max_tokens` to fit the
 * remaining balance**. So the request is repeatable for what is affordable, and the user gets a
 * shorter answer where they used to get an error.
 */
export function affordableTokens(error: string): number | undefined {
  const found = /can only afford\s+(\d+)/i.exec(error ?? "");
  if (!found) return undefined;
  const n = Number(found[1]);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

/**
 * Below this, there is no answer worth returning.
 *
 * A reply in a hundred and fifty tokens is not a short answer, it is a fragment — and a fragment
 * returned silently is worse than the error, because the user reads it as what the model thinks.
 * Under the floor the refusal stands and says the balance is the problem.
 */
const MIN_USEFUL_ANSWER = 256;

export function adaptRequest(body: Record<string, unknown>, error: string): Record<string, unknown> | undefined {
  const said = error.toLowerCase();
  const next = { ...body };
  let changed = false;

  // The balance, first and on its own, because the generic rule below would get this exactly
  // backwards.
  //
  // ⚠️ The refusal contains the words `max_tokens` — "requires more credits, or fewer max_tokens" —
  // so "remove whatever the server names" DELETED the cap and retried without one: asking for an
  // unbounded answer at the moment the server said to ask for a smaller one. It was then refused
  // again, and the user saw a dead end where a shorter answer was available.
  const affordable = affordableTokens(error);
  if (affordable !== undefined) {
    const asked = Number(next["max_tokens"] ?? next["max_completion_tokens"] ?? 0);
    // Only when it is genuinely lower. If the cap was already under what is affordable then the
    // refusal is about the PROMPT, not the answer, and lowering it further would claim to have fixed
    // something it has not.
    if (affordable >= MIN_USEFUL_ANSWER && asked > affordable) {
      if ("max_tokens" in next) next["max_tokens"] = affordable;
      if ("max_completion_tokens" in next) next["max_completion_tokens"] = affordable;
      return next;
    }
    // Nothing worth retrying for: let the refusal stand, with its own text, which names the remedy.
    return undefined;
  }

  // OpenAI's rename. Only when the server asks for it by name: elsewhere `max_tokens` is the field
  // that works, and swapping it blindly would break every server that never renamed anything.
  if ("max_tokens" in next && said.includes("max_completion_tokens")) {
    next["max_completion_tokens"] = next["max_tokens"];
    delete next["max_tokens"];
    changed = true;
  }
  // Anything else it names and will not take. A temperature the model fixes at 1, a reasoning field
  // this vendor spells differently, an accounting option an older gateway does not know.
  for (const field of ["temperature", "reasoning_effort", "reasoning", "stream_options", "max_tokens", "tools"]) {
    if (!(field in next)) continue;
    if (!said.includes(field)) continue;
    // `tools` is the one field whose removal changes the answer rather than the request, so it goes
    // only if the server is refusing tools outright — an agent turn without them is not the turn.
    if (field === "tools" && !/not support|unsupported|does not support/.test(said)) continue;
    delete next[field];
    changed = true;
  }
  return changed ? next : undefined;
}

export function isOllama(baseUrl: string): boolean {
  return /:11434(\/|$)/.test(baseUrl) || /ollama/i.test(baseUrl);
}

/**
 * `provider` is named in the message because with a Hivey preset it is not the one the panel shows.
 *
 * "Check the API key" is unhelpful advice to somebody who has just checked the API key — of the
 * provider they selected, which is not the one that answered. Naming it turns the message into
 * something a person can act on.
 */
/**
 * How long to wait before repeating a request, when the server has said it is worth repeating.
 *
 * Only for 402 — the documented wait-and-retry status on OpenRouter, where it means the in-flight
 * spending budget rather than the balance. A 429 is deliberately NOT handled here: a rate limit is
 * answered by moving to the next endpoint in the fallback chain, which is both faster and the
 * behavior the free preset depends on.
 *
 * Bounded at thirty seconds. A server asking for longer than that is not asking for a retry, it is
 * asking to be left alone, and a request that hangs for a minute with nothing on screen is
 * indistinguishable from one that is broken.
 */
function retryAfterMs(res: Response): number | undefined {
  if (res.status !== 402) return undefined;
  const header = res.headers.get("retry-after");
  if (!header) return undefined;
  const seconds = Number(header.trim());
  if (!Number.isFinite(seconds) || seconds < 0 || seconds > 30) return undefined;
  // Zero is a legitimate answer and means "immediately"; a short floor keeps it from spinning.
  return Math.max(250, seconds * 1000);
}

/** A wait a cancelled turn does not sit through. */
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const timer = setTimeout(done, ms);
    function done(): void {
      clearTimeout(timer);
      signal?.removeEventListener("abort", done);
      resolve();
    }
    signal?.addEventListener("abort", done, { once: true });
  });
}

export async function describeHttpError(res: Response, provider?: string): Promise<string> {
  let detail = "";
  /**
   * Which limit the provider says it hit, when it says so.
   *
   * ⚠️ Worth reading, because the alternative is two sentences contradicting each other. On a 402
   * OpenRouter's own message said "adjust the key's monthly limit" while this client said "this is
   * the account balance, not the API key" — and the client was right, so the key's limit was raised,
   * twice, and nothing changed. The structured field says `openrouter_credits`, which is the one
   * thing neither sentence established.
   */
  let limitSource = "";
  try {
    const body = await res.text();
    const json = JSON.parse(body);
    detail = json?.error?.message ?? json?.error ?? json?.message ?? body.slice(0, 300);
    const source = json?.error?.metadata?.limit_source;
    if (typeof source === "string" && source) limitSource = source;
  } catch {
    /* body already consumed or not JSON */
  }
  const hint =
    res.status === 401 || res.status === 403
      ? ` — check the API key for ${provider ?? "this provider"} (Hivey Code: “Store a provider key”).`
      : // 402 covers two unrelated things, and saying the wrong one sends people to look at a
        // balance that is fine. With `Retry-After` it is a temporary hold — credit reserved by
        // requests still in flight — and it has already been waited out twice by the time this
        // message is built. Without it, it really is the balance, and no key and no retry fix that.
        res.status === 402
        ? res.headers.get("retry-after")
          ? ` — ${provider ?? "the provider"} is holding credit for requests still in flight, not refusing the key. It was retried and still said no; try again in a moment.`
          : limitSource
            ? // Said by the provider rather than inferred. `openrouter_credits` means the account
              // has no money; a key or organisation limit means there IS money and something is
              // capping it. Sending somebody to the wrong one of those costs an afternoon.
              ` — the limit that refused this is \`${limitSource}\`. ${
                /credit/i.test(limitSource)
                  ? // ⚠️ Said this plainly because the obvious reading is the wrong one, and it cost an
                    // afternoon: a key's limit is PERMISSION TO SPEND, not money. A $50 limit on an
                    // account with a zero balance means "you may spend up to $50 of what you have",
                    // and there is nothing to spend. What turns a limit into usable headroom is auto
                    // top-up — so when a balance refuses a request, auto top-up either is not on, has
                    // not reached its threshold, or its payment failed. The provider's own message
                    // sends you to the key's limit, which changes none of those.
                    `That is the account BALANCE, not your key's limit — a limit is permission to spend money the account has. Check the balance and auto top-up (a declined card is the usual cause); raising the key's limit does nothing.`
                  : "That is a configured cap rather than the balance — raise it where it is set."
              } A Hivey preset always bills your OpenRouter account, whichever provider the panel shows.`
            : ` — this is the account balance at ${provider ?? "the provider"}, not the API key. A Hivey preset always bills your OpenRouter account, whichever provider the panel shows.`
        : res.status === 404
          ? " — check the endpoint URL and that the model exists on it."
          : res.status === 429
            ? " — rate limited by the provider."
            : "";
  return `HTTP ${res.status} ${res.statusText}${detail ? `: ${detail}` : ""}${hint}`;
}
