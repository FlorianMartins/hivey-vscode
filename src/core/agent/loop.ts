// The agent turn: model, tools, model again, until it has an answer.
//
// Three things are deliberately NOT inside this loop, because putting them here is what turns an
// agent into something nobody can audit:
//
//   • WHAT A TOOL DOES. Tools are injected. The loop knows their schemas and nothing else, so the
//     same loop drives the editor extension and the terminal client with different capabilities.
//   • WHETHER SOMETHING IS ALLOWED. Approval is a callback. The loop never decides that writing a
//     file is fine; it asks, and it treats a refusal as an ordinary tool result so the model can
//     react to it instead of being cut off mid-thought.
//   • WHAT MAY LEAVE THE MACHINE. Redaction is a callback applied to the messages just before the
//     request, and to nothing else. The rule "model-visible means redacted" is enforced by there
//     being exactly one place where messages become a request.
//
// What the loop does own: the step budget, the transcript of the turn, and the guarantee that a
// tool result is always paired with the call that produced it — a model that receives an
// unmatched tool result from a provider that is strict about it gets a 400 and the user gets a
// mysterious failure.

import type { ChatMessage, ChatResult, Provider, ReasoningEffort, ToolCall, ToolSchema, Usage } from "../providers/types.js";
import { coerceArgs, parseToolArgs, unknownToolMessage, validateArgs } from "./toolcall.js";
import { estimateMessageTokens } from "../util/tokens.js";

export interface ToolContext {
  /** Cancels when the user stops the turn. */
  signal?: AbortSignal;
  /** Progress line for the UI, e.g. "read src/app.ts (120 lines)". */
  report(message: string): void;
}

export interface ToolResult {
  /** What the model sees. Keep it short: tool output is re-sent on every later step. */
  content: string;
  /** Set when the tool failed; the model is told so it can try something else. */
  isError?: boolean;
  /** Anything the UI wants to show (a diff, a file path) but the model does not need. */
  display?: unknown;
}

export interface Tool {
  schema: ToolSchema;
  /**
   * Whether this call needs the user's blessing. Returning a string asks with that description;
   * `false` runs it. Reads are usually free, writes and commands are not.
   */
  approval(args: Record<string, unknown>): string | false;
  /**
   * Whether this call may run at the same time as its neighbours in one step.
   *
   * A function of the ARGUMENTS rather than a flag on the tool, because for the interesting case it
   * depends on them: dispatching a sub-agent is safe to fan out when that agent can only read, and
   * is not when it can write. Two agents editing files concurrently is a race nobody can debug from
   * a transcript.
   *
   * Absent means sequential, which is the safe answer for anything with a side effect.
   */
  parallel?(args: Record<string, unknown>): boolean;
  run(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult>;
  /**
   * A version of this tool that cannot change anything, for plan mode.
   *
   * Most tools do not need one: they either only read (and plan mode lists them) or only write (and
   * plan mode must not have them). It exists for the few whose ARGUMENTS decide which they are —
   * `ibmi_sql` runs a SELECT or a DELETE, `arcad_rest` sends a GET or a POST. Without this those
   * tools face a bad choice: leave them out and plan mode cannot read a table, or leave them in and
   * "plan mode changes nothing" becomes "plan mode changes nothing unless you approve a dialog".
   * Refusing inside the restricted tool keeps the promise absolute.
   */
  restrict?(): Tool;
}

export type Approver = (request: { tool: string; description: string; args: Record<string, unknown> }) => Promise<boolean>;

export interface TurnOptions {
  provider: Provider;
  model: string;
  /** Messages built from the session (system prompt, ambient context, transcript). */
  messages: ChatMessage[];
  tools?: Tool[];
  maxSteps?: number;
  maxTokens?: number;
  temperature?: number;
  reasoning?: ReasoningEffort;
  signal?: AbortSignal;
  onDelta?: (d: { text?: string; reasoning?: string }) => void;
  onStep?: (info: { step: number; toolCalls: ToolCall[] }) => void;
  onToolResult?: (info: { call: ToolCall; result: ToolResult }) => void;
  /**
   * One measurement per request: what we estimated the prompt at, and what the provider counted.
   *
   * Reported here rather than by the caller because only this loop knows the exact messages of each
   * step — an agent turn is many requests, and pairing the first estimate with the SUM of every
   * step's usage would teach the calibrator that its estimate is four times too low.
   */
  onUsage?: (info: { model: string; estimated: number; actual: number }) => void;
  approve?: Approver;
  /** Applied to the messages of EVERY step, immediately before the request leaves. */
  beforeRequest?: (messages: ChatMessage[]) => Promise<ChatMessage[]> | ChatMessage[];
  /** Applied to text coming back, to put real values behind the placeholders. */
  afterResponse?: (text: string) => string;
  report?: (message: string) => void;
}

export interface TurnResult {
  text: string;
  reasoning: string;
  steps: number;
  usage: Usage;
  /** The tool calls made during this turn, for the transcript and the audit log. */
  trace: Array<{ call: ToolCall; result: ToolResult; approved: boolean }>;
  stoppedBecause: "answer" | "max-steps" | "cancelled";
}

const DEFAULT_MAX_STEPS = 12;

/**
 * Below this there is nothing worth caching, and marking it costs money.
 *
 * A cache entry is written at a premium — Anthropic charges 1.25× for the tokens it stores — and
 * read back at a tenth. So marking pays off the moment a prefix is reused once, and is a 25 %
 * penalty when it never is. A title, a commit message, a classification: one short request, never
 * repeated. Anthropic will not cache under about a thousand tokens in any case.
 */
const CACHE_WORTH_IT_TOKENS = 2000;

/**
 * Move the cache breakpoint to the end of what is being sent.
 *
 * This is the difference between caching the system prompt and caching the CONVERSATION, and on a
 * long agent turn it is most of the bill.
 *
 * The prefix marked as cacheable by the caller is the part that never changes: the system prompt and
 * the repository map. Everything a turn then produces — the model's tool calls, the file it read,
 * the output of the command it ran — is appended, and on the next step every byte of it is sent
 * again. Marked nowhere, all of it is charged at full price on step 2, and again on step 3, and so
 * on: the cost of a twelve-step turn grows with the SQUARE of its length.
 *
 * One more breakpoint, at the end of each request, turns that into a straight line. Step N writes a
 * cache entry covering everything it sent; step N+1 finds it, pays a tenth for all of it, and full
 * price only for the tool result that has arrived since. The same mechanism makes the second
 * question in a conversation cheap, and the twentieth cheap as well.
 *
 * Returns a new array: the flag must not stick to the messages the loop keeps, or a twelve-step turn
 * would accumulate twelve breakpoints and Anthropic accepts four.
 */
export function withRollingCacheMark(messages: ChatMessage[]): ChatMessage[] {
  if (messages.length < 2) return messages;
  const total = estimateMessageTokens(messages);
  if (total < CACHE_WORTH_IT_TOKENS) return messages;
  const last = messages[messages.length - 1]!;
  if (last.cacheable) return messages;
  return [...messages.slice(0, -1), { ...last, cacheable: true }];
}


export async function runTurn(opts: TurnOptions): Promise<TurnResult> {
  const tools = opts.tools ?? [];
  const byName = new Map(tools.map((t) => [t.schema.name, t]));
  const schemas: ToolSchema[] = tools.map((t) => t.schema);
  const maxSteps = opts.maxSteps ?? DEFAULT_MAX_STEPS;

  const working: ChatMessage[] = [...opts.messages];
  const trace: TurnResult["trace"] = [];
  const usage: Usage = { promptTokens: 0, completionTokens: 0, cachedTokens: 0, costUsd: 0 };
  let text = "";
  let reasoning = "";

  for (let step = 0; step < maxSteps; step++) {
    if (opts.signal?.aborted) return done("cancelled");

    const prepared = opts.beforeRequest ? await opts.beforeRequest(working) : working;
    const outgoing = withRollingCacheMark(prepared);
    let res: ChatResult;
    try {
      res = await opts.provider.chat(
        {
          model: opts.model,
          messages: outgoing,
          tools: schemas.length ? schemas : undefined,
          maxTokens: opts.maxTokens,
          temperature: opts.temperature,
          reasoning: opts.reasoning,
          signal: opts.signal,
        },
        opts.onDelta,
      );
    } catch (err) {
      if (opts.signal?.aborted) return done("cancelled");
      throw err;
    }

    // Measured against `outgoing`, which is what actually left — after redaction, after whatever
    // `beforeRequest` did to it. Estimating the pre-redaction messages would calibrate against text
    // no provider ever saw.
    if (res.usage.promptTokens > 0) {
      opts.onUsage?.({ model: opts.model, estimated: estimateMessageTokens(outgoing), actual: res.usage.promptTokens });
    }

    usage.promptTokens += res.usage.promptTokens;
    usage.completionTokens += res.usage.completionTokens;
    usage.cachedTokens += res.usage.cachedTokens;
    if (typeof res.usage.costUsd === "number") usage.costUsd = (usage.costUsd ?? 0) + res.usage.costUsd;

    const answer = opts.afterResponse ? opts.afterResponse(res.text) : res.text;
    if (answer) text = text ? `${text}\n${answer}` : answer;
    if (res.reasoning) reasoning += res.reasoning;

    if (!res.toolCalls.length) return done("answer");

    opts.onStep?.({ step, toolCalls: res.toolCalls });
    working.push({ role: "assistant", content: res.text, toolCalls: res.toolCalls });

    // Every call gets a result message, including the ones that were refused or failed. A missing
    // result is a protocol error with most providers and a silent hang with the rest.
    //
    // Two passes, and the split is the whole point. APPROVALS ARE RESOLVED FIRST, one at a time,
    // because they are questions to a person and two dialogs at once is not an interface. Only then
    // is anything executed — and there, calls the tool declares safe to fan out run together.
    //
    // Fusing only CONSECUTIVE parallel-safe calls, rather than hoisting them all to the front, is
    // what keeps the order the model asked for: a read followed by a write followed by a read is
    // three steps in a sequence it may well be depending on.
    interface Planned {
      call: ToolCall;
      tool?: Tool;
      args?: Record<string, unknown>;
      /** Set when the call is already settled — unknown tool, bad JSON, refused, cancelled. */
      settled?: string;
      parallel: boolean;
    }

    const planned: Planned[] = [];
    for (const call of res.toolCalls) {
      if (opts.signal?.aborted) {
        planned.push({ call, settled: "Cancelled by the user.", parallel: false });
        continue;
      }
      const tool = byName.get(call.name);
      if (!tool) {
        // Naming the nearest real tool rather than only refusing: models invent plurals and
        // synonyms constantly, and a refusal with no suggestion costs a whole step to recover from.
        planned.push({ call, settled: unknownToolMessage(call.name, [...byName.keys()]), parallel: false });
        continue;
      }
      // Repaired rather than refused where the text has exactly one plausible reading — a fence
      // around the object, a trailing comma, a real newline inside a string. A small model given
      // "not valid JSON" sends the same thing again; see `parseToolArgs` for why each repair is
      // safe and why nothing is guessed.
      const parsed = parseToolArgs(call.args || "{}");
      if (!parsed.ok || !parsed.args) {
        planned.push({ call, settled: parsed.error ?? "Those arguments could not be read.", parallel: false });
        continue;
      }
      if (parsed.repaired) opts.report?.(`repaired the arguments of ${call.name}`);
      // Checked against the schema before the tool sees them, so a missing field is one corrective
      // sentence rather than an exception from inside a tool that says nothing useful.
      const invalid = validateArgs(tool.schema, parsed.args);
      if (invalid) {
        planned.push({ call, settled: invalid, parallel: false });
        continue;
      }
      const args: Record<string, unknown> = coerceArgs(tool.schema, parsed.args);

      const needs = tool.approval(args);
      let approved = true;
      if (needs !== false) {
        approved = opts.approve ? await opts.approve({ tool: call.name, description: needs, args }) : false;
      }
      if (!approved) {
        const result: ToolResult = { content: "The user declined this action.", isError: true };
        trace.push({ call, result, approved: false });
        opts.onToolResult?.({ call, result });
        planned.push({ call, settled: result.content, parallel: false });
        continue;
      }

      planned.push({ call, tool, args, parallel: Boolean(tool.parallel?.(args)) });
    }

    const execute = async (item: Planned): Promise<void> => {
      if (item.settled !== undefined) {
        working.push({ role: "tool", toolCallId: item.call.id, content: item.settled });
        return;
      }
      let result: ToolResult;
      try {
        result = await item.tool!.run(item.args!, {
          signal: opts.signal,
          report: (m) => opts.report?.(m),
        });
      } catch (err) {
        result = { content: `Tool failed: ${(err as Error).message}`, isError: true };
      }
      trace.push({ call: item.call, result, approved: true });
      opts.onToolResult?.({ call: item.call, result });
      working.push({ role: "tool", toolCallId: item.call.id, content: result.content });
    };

    for (let i = 0; i < planned.length; ) {
      const item = planned[i]!;
      if (!item.parallel) {
        await execute(item);
        i += 1;
        continue;
      }
      // A run of neighbours that may all go at once. One is not a batch, and `Promise.all` on a
      // single item costs a microtask to say the same thing.
      let end = i;
      while (end < planned.length && planned[end]!.parallel) end += 1;
      const batch = planned.slice(i, end);
      if (batch.length > 1) opts.report?.(`${batch.length} in parallel`);
      await Promise.all(batch.map(execute));
      i = end;
    }
  }

  return done("max-steps");

  function done(stoppedBecause: TurnResult["stoppedBecause"]): TurnResult {
    return { text, reasoning, steps: trace.length, usage, trace, stoppedBecause };
  }
}
