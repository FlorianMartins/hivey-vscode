// Turning a transcript into something shorter than itself.
//
// Two features need this and they are the same operation aimed at different conversations:
//
//   COMPACT      the conversation you are in has grown past what is worth re-sending every turn.
//                What replaces it is a summary the model writes, and the exchanges it replaces stay
//                on screen — muted, not deleted. That is this product's existing idea (the
//                transcript is not the prompt) applied to the oldest half of a conversation.
//
//   AS CONTEXT   a conversation you had last week answers a question you are asking now. It comes
//                in as an attachment on the next turn, not as a new screen: "what did we decide
//                about the invoices" is a question about the CURRENT work.
//
// Both are pure text handling, so both live here rather than in the extension, and both are
// testable without an editor or a model.

import type { Entry, SessionData } from "./session.js";
import { estimateTokens } from "../util/tokens.js";

/** How the two roles are written into a digest. Short, because they repeat on every exchange. */
function roleLabel(role: Entry["role"], you: string, assistant: string): string {
  return role === "user" ? you : assistant;
}

export interface DigestOptions {
  /** What to call the user's turns, translated by the caller. */
  you: string;
  /** What to call the assistant's turns. */
  assistant: string;
  /** Ceiling for the whole digest. */
  maxTokens: number;
  /** Told to the reader when exchanges were left out, translated and taking one number. */
  omittedNote: (count: number) => string;
}

/**
 * A conversation rendered as plain text, newest exchanges kept.
 *
 * Trimming from the FRONT rather than the back, and per exchange rather than per character: the
 * end of a conversation is the part that carries the conclusion, and half a sentence of an old
 * exchange is worse than no exchange at all — it reads as something the participants said and
 * stops where the meaning was.
 *
 * Errors and muted exchanges are skipped. A failed turn is not something anyone said, and an
 * exchange the user muted is one they have already declared irrelevant; carrying either into a new
 * context would undo a decision they made deliberately.
 */
export function digestEntries(entries: Entry[], opts: DigestOptions): string {
  const usable = entries.filter((e) => e.included && !e.error && e.text.trim());
  const rendered = usable.map((e) => `${roleLabel(e.role, opts.you, opts.assistant)}: ${e.text.trim()}`);

  const kept: string[] = [];
  let budget = opts.maxTokens;
  let omitted = 0;
  for (let i = rendered.length - 1; i >= 0; i--) {
    const cost = estimateTokens(rendered[i]!) + 4;
    if (cost <= budget) {
      budget -= cost;
      kept.unshift(rendered[i]!);
    } else {
      omitted = i + 1;
      break;
    }
  }

  // An empty result from a non-empty conversation would be a silent failure. One exchange, cut, is
  // still an answer to "what was this about"; nothing at all is not.
  if (!kept.length && rendered.length) {
    const last = rendered[rendered.length - 1]!;
    kept.push(last.slice(0, Math.max(200, Math.floor(opts.maxTokens * 3.2))));
    omitted = rendered.length - 1;
  }

  const body = kept.join("\n\n");
  return omitted > 0 ? `${opts.omittedNote(omitted)}\n\n${body}` : body;
}

/**
 * An earlier conversation, ready to attach to the current one.
 *
 * Marked untrusted, and that is not paranoia about the user's own history. A transcript contains
 * whatever the assistant read while it was running — a file, a dependency, a web page, a log — and
 * the untrusted fence is what keeps "the user asked this" and "this text was found somewhere"
 * apart. Attaching a transcript would otherwise be a way to smuggle text written by someone else
 * into the channel that carries instructions.
 */
export function sessionAsContext(
  data: SessionData,
  opts: DigestOptions & { label: (title: string) => string },
): { kind: string; label: string; body: string; untrusted: true } {
  const title = data.title.trim() || opts.label("");
  return {
    kind: "conversation",
    label: opts.label(title),
    body: digestEntries(data.entries, opts),
    untrusted: true,
  };
}

/**
 * When compacting is worth offering.
 *
 * A suggestion that appears too early is noise, and one that appears at the limit is too late —
 * by then the conversation has already been trimmed silently and the user is paying for a context
 * they are about to lose anyway. Two thirds is the point where a long conversation is measurably
 * expensive and still entirely intact.
 *
 * Under a floor of a few thousand tokens it never fires whatever the ratio: on a tiny budget, four
 * exchanges cross two thirds, and nobody wants to be asked to summarise four exchanges.
 */
export const COMPACT_RATIO = 0.66;
export const COMPACT_FLOOR_TOKENS = 6000;

export function shouldSuggestCompact(contextTokens: number, budgetTokens: number, exchanges: number): boolean {
  if (budgetTokens <= 0) return false;
  if (contextTokens < COMPACT_FLOOR_TOKENS) return false;
  // Two exchanges cannot be summarised into fewer than two exchanges worth reading.
  if (exchanges < 4) return false;
  return contextTokens / budgetTokens >= COMPACT_RATIO;
}

/**
 * What the model is asked to produce when compacting.
 *
 * Written as a brief rather than as "summarise this": a summary optimised for prose is the wrong
 * artefact here. What the next turn needs is the state of the work — decisions taken, paths tried
 * and rejected, files touched, what is still open — because the summary REPLACES the transcript as
 * the thing the model reasons from. A digest that reads beautifully and omits the file being
 * edited has lost the conversation.
 */
export function compactBrief(): string {
  return [
    "Summarise this conversation so it can replace the transcript in your own context.",
    "Write it for yourself, not for the user: it is the only record you will have of what came before.",
    "Cover, as sections and in this order:",
    "1. What the user is trying to achieve, in their terms.",
    "2. Decisions already taken, and the reasoning that settled them.",
    "3. Approaches tried and rejected, with why — so they are not tried again.",
    "4. Files, symbols and commands touched, by exact name.",
    "5. What is still open, and the immediate next step.",
    "Keep every identifier verbatim. Prefer omitting a pleasantry to omitting a fact.",
    "Do not address the user, do not apologise, and do not describe the conversation as a conversation.",
    // The whole point of compacting is the space it frees, so the budget is stated rather than
    // hoped for. Without it a model asked to "summarise" will happily return something two thirds
    // the length of what it was given, which buys nothing and costs a request.
    "Be dense. Use short lines and fragments, not paragraphs. Aim for under 400 words, and never",
    "exceed a fifth of the length of what you were given. Drop anything the next step does not need.",
  ].join("\n");
}
