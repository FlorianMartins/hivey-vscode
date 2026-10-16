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
import { restoreDeep } from "../redaction/index.js";
import { t } from "../../shared/i18n.js";
import type { RecallStore } from "./recall.js";
import { isWrongLanguage, steerMessage, withReplyLanguage } from "../prompts.js";

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
   * a SQL tool runs a SELECT or a DELETE, a REST tool sends a GET or a POST. Without this those
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
  /**
   * How many model requests one turn may make. `Infinity` for none: the extension's own agent turn
   * runs until the task is done, the user presses stop, or the model goes round in circles — which
   * the repeat detector catches without a count. See `DEFAULT_MAX_STEPS` for everyone else.
   */
  maxSteps?: number;
  /**
   * Asked once, when the model stops calling tools: is this really finished?
   *
   * Returns a corrective message to continue with, or nothing to accept the answer. The POLICY lives
   * with the caller (`selfCheckMessage` in the router) so this file stays free of opinions about
   * what counts as verified; the MECHANISM is here, and it is deliberately small.
   *
   * ⚠️ At most one per turn. A second would be an argument, and a model that insists would turn the
   * step cap into the only brake. One catches forgetfulness — which is what this is for — and does
   * not negotiate.
   */
  selfCheck?: (trace: TurnResult["trace"]) => string | undefined;
  maxTokens?: number;
  /** A side task — see `ChatRequest.chore`. Thinking is switched off for it on a self-hosted server. */
  chore?: boolean;
  /**
   * The server's runtime context window, when known. Checked BEFORE each request: a turn that has
   * grown past it gets its oldest tool outputs shortened first, rather than an error from the server.
   */
  contextWindow?: number;
  /**
   * Where every tool output is kept whole — see `core/agent/recall.ts`. When the turn has to shorten
   * an old output to fit, the model is told the id that gives it back word for word.
   */
  recall?: RecallStore;
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
  /**
   * Move the cache breakpoint to the end of each request. Off unless asked for — see
   * `OpenAIProviderOptions.promptCache` for what turning it on changes and what it cost.
   */
  promptCache?: boolean;
  approve?: Approver;
  /** Applied to the messages of EVERY step, immediately before the request leaves. */
  beforeRequest?: (messages: ChatMessage[]) => Promise<ChatMessage[]> | ChatMessage[];
  /** Applied to text coming back, to put real values behind the placeholders. */
  afterResponse?: (text: string) => string;
  /**
   * The user's language, held for the whole turn: the rule and the reminder go on every request (see
   * `withReplyLanguage`), and a note written in another language goes through `translate`.
   */
  replyLanguage?: "en" | "fr";
  /** Puts a note back in the user's language — a small request, thinking off. Undefined: left as is. */
  translate?: (text: string, lang: "en" | "fr", signal?: AbortSignal) => Promise<string | undefined>;
  /** A note was rewritten after it streamed — the text as streamed, then as kept. */
  onTranslated?: (from: string, to: string) => void;
  /**
   * What the person typed while the turn was running, handed over and forgotten by the caller.
   * Asked before every request: the messages go in after the last tool results, so the model reads
   * them at its next step without the turn being stopped. Asked again when the model has just
   * answered, so a correction typed during the final words reopens the turn instead of being lost.
   */
  steer?: () => string[];
  /**
   * Put the real values back into a tool call's arguments, before anything looks at them.
   *
   * The same vault as `afterResponse`, applied to what the tools DO rather than to what the user
   * reads. It runs before validation, before the approval card and before execution, so the schema
   * check, the sentence the user approves and the diff all show what will actually happen — a card
   * saying `write_file ⟨HOST_1⟩` asks somebody to approve a thing they cannot see.
   */
  restoreArgs?: (text: string) => string;
  report?: (message: string) => void;
}

export interface TurnResult {
  text: string;
  reasoning: string;
  steps: number;
  usage: Usage;
  /** The tool calls made during this turn, for the transcript and the audit log. */
  trace: Array<{ call: ToolCall; result: ToolResult; approved: boolean }>;
  /**
   * Whether the turn's one self-check actually fired.
   *
   * Instrumented because the chantier that added the self-check could not be judged without it. The
   * bench showed no improvement — 48/56 before, 47/56 after, and the figure it was meant to move
   * unchanged — and the honest question was then "did it ever fire?", which nothing could answer.
   * Arguing about that instead of measuring it is the failure mode this whole phase exists against.
   */
  selfChecked: boolean;
  /** The cap a provider's refusal forced the last request down to, when one did. */
  shortenedTo?: number;
  stoppedBecause: "answer" | "max-steps" | "repeating" | "cancelled";
  /**
   * The model ran out of output budget rather than finishing.
   *
   * It was thrown away — the provider reports `finish_reason: "length"` and nothing read it — so a
   * sentence cut in half and a finished answer looked identical to everything above. On a model
   * that thinks before answering the consequence is worse than a missing paragraph: the reasoning
   * is charged against the same budget, so a long think leaves nothing for the answer and the turn
   * ends with a full block of thinking and no reply at all. Which is precisely how it was reported
   * — "it only does the reasoning and gives no answer" — and why plan mode felt it first: it is the
   * mode that asks the model to investigate before it writes.
   */
  truncated: boolean;
  /** The last reply's stream was cut before the model finished — see `ChatResult.interrupted`. */
  interrupted?: boolean;
}

/**
 * How many tool calls one turn may make.
 *
 * ⚠️ Raised from 12, and the number was not the only problem. Reported as "it stops a task right in
 * the middle, so agents and subagents don't work" — a turn ending with its work half
 * done, which is the worst outcome an agent has: a repository in a state nobody chose.
 *
 * Twelve was calibrated against turns that worked. A turn that hits a defect does not spend its steps
 * on the task: the session that produced that report spent them re-reading a file, re-checking a diff
 * and disbelieving its own tools, because an edit was landing in the editor's buffer and not on disk.
 * Those defects are fixed; the cap still has to leave room for the ordinary case of a long file —
 * read, search, edit, verify, and again for the next place.
 *
 * Not unbounded, for the reason the cap exists: a model going round in circles must stop by itself
 * rather than be stopped by the person watching it. Thirty is roughly three passes of
 * read-edit-verify over three places, which is the shape of a real change.
 */
const DEFAULT_MAX_STEPS = 30;

/**
 * How many times one turn asks for the rest of a reply the output cap cut off. Two: enough to get
 * past one long plan or one large file, few enough that a model which keeps writing past any cap
 * cannot spend the whole step budget doing it.
 */
const MAX_CONTINUATIONS = 2;

/** How many times one turn shortens old tool outputs before giving up on fitting the window. */
const MAX_SHRINKS = 3;
/** Room left for the answer once the request fits again, in tokens. */
const ANSWER_ROOM_TOKENS = 8192;
/** A tool output keeps this many characters of its head when shortened. */
const KEPT_HEAD_CHARS = 1500;

/**
 * The same call — same tool, same arguments — made this many times in one turn is not run again.
 * "it's been going round in circles for 12 hours on one request": a model that re-reads the same file
 * or re-runs the same search gets the same answer every time, and only a turn limit ever stopped it.
 * The model is told so instead, and the turn ends if it insists past `MAX_REPEAT_NUDGES`.
 */
const REPEAT_LIMIT = 3;
const MAX_REPEAT_NUDGES = 2;
const REPEATED_CALL =
  "You already made this exact call (same tool, same arguments) twice in this turn and have its result. " +
  "Do not repeat it: use what you already have, try a different approach, or give your answer.";

/**
 * The server's "does not fit" refusal, and by how many tokens — llama.cpp says
 * "request (69882 tokens) exceeds the available context size (69632 tokens)" or "input (N tokens)
 * is larger than the max context size (M tokens)". Other providers say less; an unknown excess is
 * taken as a quarter of what is being sent, which is decided by the caller's shrink.
 */
export function contextOverflow(message: string): { excess: number } | undefined {
  if (!/exceeds the available context size|larger than the max context size|exceed_context_size|context_length_exceeded|maximum context length/i.test(message)) {
    return undefined;
  }
  const m = /\((\d+) tokens\)[^(]*\((\d+) tokens\)/.exec(message);
  return { excess: m ? Math.max(0, Number(m[1]) - Number(m[2])) : 0 };
}

/**
 * Shorten the OLDEST tool outputs in place until about `tokens` have been taken out. A tool output
 * keeps its head and says how much was cut, so the model knows it is looking at an excerpt and can
 * read again what it needs. The latest output is left whole: it is the one the next step is about.
 * Returns whether anything was shortened.
 */
export function shrinkToolOutputs(messages: ChatMessage[], tokens: number, keptAs?: (toolCallId: string) => string | undefined): boolean {
  const target = Math.max(tokens, 1000) * 4; // characters, at the usual ~4 per token
  const tools = messages.map((m, i) => ({ m, i })).filter(({ m }) => m.role === "tool" && m.content.length > KEPT_HEAD_CHARS + 200);
  const lastTool = messages.reduce((last, m, i) => (m.role === "tool" ? i : last), -1);
  let saved = 0;
  // The thinking of older steps goes first: it led to calls whose results are still here, and the
  // last two steps' thinking is what the next one builds on.
  const thinkers = messages.filter((m) => m.role === "assistant" && m.reasoning);
  for (const m of thinkers.slice(0, -2)) {
    if (saved >= target) break;
    saved += m.reasoning!.length;
    delete m.reasoning;
  }
  for (const { m, i } of tools) {
    if (saved >= target) break;
    if (i === lastTool) continue;
    const cut = m.content.length - KEPT_HEAD_CHARS;
    // Kept whole in the memory when there is one: the model is told exactly how to have it back.
    const id = m.toolCallId ? keptAs?.(m.toolCallId) : undefined;
    const back = id
      ? `the full output is kept: recall {"id":"${id}","offset":${KEPT_HEAD_CHARS}} gives the rest word for word`
      : "read it again if you need the rest";
    m.content = `${m.content.slice(0, KEPT_HEAD_CHARS)}\n[… ${cut} more characters of this output were removed to fit the model's context window — ${back}.]`;
    saved += cut;
  }
  return saved > 0;
}
const CONTINUE_AFTER_CUT =
  "Your previous reply was cut off by the output token limit before you finished, and any tool call you were writing was lost. " +
  "Continue from where you stopped without repeating what you already wrote. " +
  "If you were writing a large file, a long plan or a big edit, split it into several smaller tool calls, each well under the limit.";
const CONTINUE_AFTER_INTERRUPT =
  "Your previous reply was interrupted before you finished (the connection to you was closed), and any tool call you were writing was lost. " +
  "Continue exactly from where you stopped, without repeating what you already wrote.";

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
  /** Whether the one self-check of this turn has been spent. See `selfCheck`. */
  let selfChecked = false;
  /** Carried out of the provider: a refusal capped an answer, and the user has to be told. */
  let shortenedTo: number | undefined;

  const working: ChatMessage[] = [...opts.messages];
  const trace: TurnResult["trace"] = [];
  const usage: Usage = { promptTokens: 0, completionTokens: 0, cachedTokens: 0, costUsd: 0 };
  let text = "";
  let reasoning = "";
  /** Set by the last response that ran out of output budget. See `TurnResult.truncated`. */
  let truncated = false;
  /** Set by the last response whose stream was cut. See `TurnResult.interrupted`. */
  let interrupted = false;
  /** How many times this turn has asked for the rest of a reply the cap cut off. */
  let continuations = 0;
  /** How many times this turn has shortened old tool outputs to fit the context window. */
  let shrinkAttempts = 0;
  /** Which kept memory entry holds each tool output of this turn, by tool call id. */
  const recallIds = new Map<string, string>();
  const keptAs = (toolCallId: string): string | undefined => recallIds.get(toolCallId);
  /** How many times each exact call (tool + arguments) was made this turn. See `REPEAT_LIMIT`. */
  const callCounts = new Map<string, number>();
  /** How many repeated calls were refused this turn. */
  let repeatNudges = 0;
  /**
   * Real prompt tokens over estimated, from the last response. ⚠️ The estimate counts ~4 characters
   * a token and code packs tighter: a turn the estimate put at 56k was 68k on the server, and
   * filled the window in the middle of the model's thinking. Never below 1.
   */
  let tokenRatio = 1;

  for (let step = 0; step < maxSteps; step++) {
    if (opts.signal?.aborted) return done("cancelled");
    // Going round in circles: told twice to stop repeating the same call and doing it again. The
    // turn ends here rather than spending the rest of its steps — or hours — on the same thing.
    if (repeatNudges > MAX_REPEAT_NUDGES) {
      opts.report?.(t("the model kept repeating the same tool call — the turn was stopped"));
      return done("repeating");
    }
    // Typed by the person since the last request — read at this step, the turn carries on.
    const steered = opts.steer?.() ?? [];
    if (steered.length) working.push({ role: "user", content: steerMessage(steered) });

    // Fitted BEFORE it is sent, when the window is known: the estimate counts ~4 characters a
    // token and code packs tighter, so a tenth is kept in hand, plus room for the answer.
    if (opts.contextWindow && opts.contextWindow > 0) {
      const limit = Math.floor(opts.contextWindow * 0.9) - ANSWER_ROOM_TOKENS;
      const estimate = Math.ceil(estimateMessageTokens(working) * tokenRatio);
      if (estimate > limit && shrinkToolOutputs(working, estimate - limit, keptAs)) {
        opts.report?.(t("the turn was approaching the model's context window — older tool outputs were shortened"));
      }
    }
    const prepared0 = opts.beforeRequest ? await opts.beforeRequest(working) : working;
    const prepared = opts.replyLanguage ? withReplyLanguage(prepared0, opts.replyLanguage) : prepared0;
    const outgoing = opts.promptCache ? withRollingCacheMark(prepared) : prepared;
    let res: ChatResult;
    try {
      res = await opts.provider.chat(
        {
          model: opts.model,
          messages: outgoing,
          tools: schemas.length ? schemas : undefined,
          maxTokens: opts.maxTokens,
          ...(opts.chore ? { chore: true } : {}),
          temperature: opts.temperature,
          reasoning: opts.reasoning,
          signal: opts.signal,
        },
        opts.onDelta,
      );
    } catch (err) {
      if (opts.signal?.aborted) return done("cancelled");
      // ⚠️ The turn outgrew the server's context window MID-WAY: "request (69882 tokens) exceeds
      // the available context size (69632 tokens)". Tool results pile up inside a turn and nothing
      // trimmed them, so a long agent turn died on an error after doing half its work. The oldest
      // tool outputs are shortened — their head is kept, which is where a listing or a log says
      // what it is — by what the server says is missing plus room to answer, and the same step is
      // asked again. Bounded; when nothing is left to shorten the error stands, and the extension's
      // own recovery (summarize, ask again) handles a conversation too long before the turn began.
      const overflow = contextOverflow(String((err as Error)?.message ?? err));
      if (overflow && shrinkAttempts < MAX_SHRINKS && shrinkToolOutputs(working, overflow.excess + ANSWER_ROOM_TOKENS, keptAs)) {
        shrinkAttempts++;
        opts.report?.(t("the turn no longer fit the model's context — older tool outputs were shortened"));
        step--;
        continue;
      }
      throw err;
    }

    // Measured against `outgoing`, which is what actually left — after redaction, after whatever
    // `beforeRequest` did to it. Estimating the pre-redaction messages would calibrate against text
    // no provider ever saw.
    if (res.usage.promptTokens > 0) {
      const estimated = estimateMessageTokens(outgoing);
      opts.onUsage?.({ model: opts.model, estimated, actual: res.usage.promptTokens });
      if (estimated > 0) tokenRatio = Math.max(1, res.usage.promptTokens / estimated);
    }

    usage.promptTokens += res.usage.promptTokens;
    usage.completionTokens += res.usage.completionTokens;
    usage.cachedTokens += res.usage.cachedTokens;
    if (typeof res.usage.costUsd === "number") usage.costUsd = (usage.costUsd ?? 0) + res.usage.costUsd;

    // ⚠️ Cut because the SERVER's window was full, not because of an answer cap: "it used its whole
    // answer budget on reasoning" on a local model with no budget at all. Prompt and thinking
    // together reached the window (69631 of 69632), the reply was cut mid-thought, and the
    // extension then started the whole task over. The cut reply is dropped, older tool outputs
    // are shortened — kept word for word in memory, see recall.ts — and the SAME step is asked
    // again with the room that frees. Bounded with the other shrinks.
    const windowFull =
      res.stopReason === "length" &&
      (!opts.maxTokens ||
        (opts.contextWindow !== undefined &&
          res.usage.promptTokens + res.usage.completionTokens >= opts.contextWindow * 0.97));
    if (
      windowFull &&
      !res.toolCalls.length &&
      shrinkAttempts < MAX_SHRINKS &&
      shrinkToolOutputs(working, Math.max(res.usage.completionTokens, ANSWER_ROOM_TOKENS) + ANSWER_ROOM_TOKENS, keptAs)
    ) {
      shrinkAttempts++;
      opts.report?.(t("the model's context window filled up mid-reply — older tool outputs were shortened and the step asked again"));
      step--;
      continue;
    }

    // The safety net behind the language rule: a note the model wrote in another language is put back
    // in the user's — before it is kept, so what the user reads and what the model reads next agree.
    if (opts.replyLanguage && opts.translate && res.text.trim() && isWrongLanguage(res.text, opts.replyLanguage)) {
      try {
        const fixed = await opts.translate(res.text, opts.replyLanguage, opts.signal);
        if (fixed?.trim()) {
          const restore = (s: string): string => (opts.afterResponse ? opts.afterResponse(s) : s);
          opts.onTranslated?.(restore(res.text), restore(fixed.trim()));
          res = { ...res, text: fixed.trim() };
        }
      } catch {
        /* left as written: a note in the wrong language beats a turn that fails over it */
      }
    }

    truncated = res.stopReason === "length";
    interrupted = Boolean(res.interrupted);
    if (res.shortenedTo) shortenedTo = res.shortenedTo;
    const answer = opts.afterResponse ? opts.afterResponse(res.text) : res.text;
    if (answer) text = text ? `${text}\n${answer}` : answer;
    if (res.reasoning) reasoning += res.reasoning;

    // ⚠️ Cut off by the output cap with nothing to run: NOT an answer. It was returned as one, so a
    // turn that ended "Here is the plan, then I'll get started:" — the plan or the call it
    // announced lost to
    // the cap — looked finished, and the agent simply stopped. Asked to carry on instead, a bounded
    // number of times, with the one instruction that keeps it from being cut again: smaller pieces.
    //
    // ⚠️ Not when the THINKING ate the budget and there is no text at all: asking again at the same
    // cap would be eaten the same way. That case belongs to the caller, which retries with more room
    // (see "It spent the whole answer on thinking" in the extension) — and this used to pre-empt it.
    const thoughtOnly = !res.text.trim() && Boolean(res.reasoning?.trim());
    if (truncated && !thoughtOnly && !res.toolCalls.length && tools.length && continuations < MAX_CONTINUATIONS) {
      continuations++;
      opts.report?.(t("the reply hit the output limit — asking the model to continue"));
      working.push({ role: "assistant", content: res.text || "(cut off)" });
      working.push({ role: "user", content: CONTINUE_AFTER_CUT });
      continue;
    }
    // ⚠️ The stream was CUT — the connection closed before the model said it was done (a server
    // restarted, a proxy dropped it). "it cuts off in the middle sometimes". What arrived is half
    // an answer that read as a whole one. Asked to carry on, in any mode — continuing a text has no
    // side effect — bounded like the cap above; if the server is really gone the next request
    // fails loudly, which is the honest outcome.
    if (interrupted && !res.toolCalls.length && continuations < MAX_CONTINUATIONS) {
      continuations++;
      opts.report?.(t("the reply was interrupted before it finished — asking the model to continue"));
      working.push({ role: "assistant", content: res.text || "(interrupted)" });
      working.push({ role: "user", content: CONTINUE_AFTER_INTERRUPT });
      continue;
    }

    if (!res.toolCalls.length) {
      // A correction typed while the model was writing its answer: the answer stands as said, and
      // the turn goes on with the correction rather than ending over it.
      const late = opts.steer?.() ?? [];
      if (late.length) {
        working.push({ role: "assistant", content: res.text || "(no answer)" });
        working.push({ role: "user", content: steerMessage(late) });
        continue;
      }
      // The cheap middle between telling the user and escalating to a billed model: ask the same
      // model to finish what it started. It usually can — it forgot, it did not fail.
      const correction = selfChecked ? undefined : opts.selfCheck?.(trace);
      if (correction) {
        selfChecked = true;
        // The premature answer is dropped rather than kept. It said the work was done; the model is
        // about to supersede it, and showing both would read as the assistant contradicting itself
        // two lines apart. What it did is still in the trace, which is where a reviewer looks.
        text = "";
        working.push({ role: "assistant", content: res.text || "(no answer)" });
        working.push({ role: "user", content: correction });
        // Falls through to the next iteration, so it costs a step: this is a real round trip and
        // real money, and a budget that did not count it would be lying about the turn.
        continue;
      }
      return done("answer");
    }

    opts.onStep?.({ step, toolCalls: res.toolCalls });
    // With the thinking that led to these calls: the next step continues it rather than redoing it.
    working.push({ role: "assistant", content: res.text, toolCalls: res.toolCalls, ...(res.reasoning ? { reasoning: res.reasoning } : {}) });

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
      if (parsed.repaired) opts.report?.(t("repaired the arguments of {0}", call.name));
      // Before the schema check, the approval and the tool — see `restoreArgs`. Only placeholders
      // this vault issued are put back; anything else is left exactly as the model sent it.
      const real = opts.restoreArgs ? restoreDeep(parsed.args, opts.restoreArgs) : parsed.args;
      // Checked against the schema before the tool sees them, so a missing field is one corrective
      // sentence rather than an exception from inside a tool that says nothing useful.
      const invalid = validateArgs(tool.schema, real);
      if (invalid) {
        planned.push({ call, settled: invalid, parallel: false });
        continue;
      }
      const args: Record<string, unknown> = coerceArgs(tool.schema, real);

      const needs = tool.approval(args);
      let approved = true;
      if (needs !== false) {
        // A call the runtime did not deliver through the protocol says so, here, where the person
        // deciding can read it. Recognising a call written in a message collapses a separation the
        // protocol maintains — talking about an action cannot be performing one — and the honest
        // compensation is not cleverness, it is telling the user which channel this arrived on.
        // See `providers/textToolCall.ts`.
        const description = call.source === "text" ? `${needs} ${t("(read from the model's message, not from a tool call)")}` : needs;
        approved = opts.approve ? await opts.approve({ tool: call.name, description, args }) : false;
      }
      if (!approved) {
        const result: ToolResult = { content: "The user declined this action.", isError: true };
        trace.push({ call, result, approved: false });
        opts.onToolResult?.({ call, result });
        planned.push({ call, settled: result.content, parallel: false });
        continue;
      }

      const parallel = Boolean(tool.parallel?.(args));
      // The same READ again — see `REPEAT_LIMIT`. Only reads are counted: anything that can change
      // something (a write, an edit, a command such as the test run an agent repeats after each fix)
      // starts the count again, because after it the same read may well say something new.
      if (parallel) {
        const callKey = `${call.name}\u0000${JSON.stringify(args)}`;
        const made = (callCounts.get(callKey) ?? 0) + 1;
        callCounts.set(callKey, made);
        if (made >= REPEAT_LIMIT) {
          repeatNudges++;
          planned.push({ call, settled: REPEATED_CALL, parallel: false });
          continue;
        }
      } else {
        callCounts.clear();
      }
      planned.push({ call, tool, args, parallel });
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
      // Kept whole, whatever happens to it in the window later — see `RunTurnOptions.recall`.
      if (opts.recall && result.content.length > 500) {
        recallIds.set(item.call.id, opts.recall.put(result.content, `${item.call.name} ${(item.call.args ?? "").slice(0, 120)}`.trim()));
      }
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
      if (batch.length > 1) opts.report?.(t("{0} in parallel", batch.length));
      await Promise.all(batch.map(execute));
      i = end;
    }
  }

  return done("max-steps");

  function done(stoppedBecause: TurnResult["stoppedBecause"]): TurnResult {
    return {
      text,
      reasoning,
      steps: trace.length,
      usage,
      trace,
      stoppedBecause,
      truncated,
      ...(interrupted ? { interrupted: true } : {}),
      selfChecked,
      ...(shortenedTo ? { shortenedTo } : {}),
    };
  }
}
