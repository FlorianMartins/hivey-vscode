// Who does the thinking: the provider, or the prompt.
//
// Florian's instruction, and it is the right default: *« pour le mode de raisonnement je veux
// utiliser celui du fournisseur par défaut et pas forcer celui de deepseek sur tous, le mode de
// reflexion deepseek doit etre uniquement sur les modeles par defaut sans raisonnement »*.
//
// So there are two mechanisms and they are mutually exclusive:
//
//   • NATIVE — the model has its own thinking, and the provider is told how much of it to do
//     (`reasoning: {effort}` on OpenRouter, `reasoning_effort` elsewhere, a token budget on
//     Anthropic). The model's own thinking is better than anything a prompt can ask for: it is
//     trained, it is separated from the answer by the protocol, and it is not charged twice.
//
//   • PROMPTED — the model has no native thinking, so it is ASKED to work through the problem in a
//     delimited block before answering. This is the DeepSeek-style harness, and it belongs here and
//     nowhere else. Sending it to a model that already reasons natively is worse than useless: the
//     model thinks twice, pays for both, and the prompted block competes with the real one for the
//     answer budget — which is the failure `loop.ts` already documents as "it only does the
//     reasoning and gives no answer".
//
// ⚠️ And there is a third state that was a live defect: an effort sent to a model that cannot use
// it. The reasoning control is hidden when `canReason` is false, but the stored preference survives
// a model change, so switching from a reasoning model to a plain one kept sending `effort: "high"`
// to an endpoint with no idea what to do with it. Hidden in the UI is not the same as not sent.

import { reasoningSupport } from "./reasoning.js";
import type { ReasoningEffort } from "../providers/types.js";

export type ThinkingMode = "native" | "prompted" | "off";

/**
 * Which mechanism answers this turn.
 *
 * @param model the model id actually being called.
 * @param effort what the user asked for. `none` means they asked for no thinking, and that is final:
 *   neither mechanism runs. A prompted block the user did not ask for would spend their answer
 *   budget on deliberation they turned off.
 */
export function thinkingMode(model: string, effort: ReasoningEffort): ThinkingMode {
  if (!effort || effort === "none") return "off";
  // ⚠️ "unknown" takes the NATIVE path, not the prompted one, and the asymmetry is deliberate.
  //
  // The two wrong guesses do not cost the same. Sending a prompted block to a model that reasons
  // natively makes it think twice and spend its answer budget on the second think — the failure this
  // file's header calls "it only does the reasoning and gives no answer". Sending a native effort to
  // a model that cannot use it costs a field the server ignores, or a 400 that `adaptRequest`
  // already knows how to drop.
  //
  // So a model nobody can vouch for gets the cheap mistake rather than the expensive one.
  return reasoningSupport(model) === "no" ? "prompted" : "native";
}

/**
 * The effort to put in the request, which is nothing at all unless the model can use it.
 *
 * Separated from `thinkingMode` so the provider call site cannot get it wrong by forgetting the
 * capability check — the question "what do I send" has one answer and this is it.
 */
export function effortToSend(model: string, effort: ReasoningEffort): ReasoningEffort {
  return thinkingMode(model, effort) === "native" ? effort : "none";
}

/** The delimiters. Chosen to be something a model will not produce by accident in prose or code. */
export const THINK_OPEN = "<<<THINKING>>>";
export const THINK_CLOSE = "<<<ANSWER>>>";

/**
 * What to add to the system prompt when the model has to do its own deliberating.
 *
 * Three properties it needs, and each one is there because the obvious version fails:
 *
 *   • A HARD DELIMITER, not "think step by step". The block has to be machine-separable from the
 *     answer, or the user reads the deliberation as the reply — which is exactly what a local model
 *     writing a tool call into its message did ([ADR-0026]).
 *   • A LENGTH THAT SCALES WITH THE EFFORT, because the whole cost of prompted thinking is answer
 *     budget. "Think as long as you like" on a small context window produces a turn that reasons and
 *     never answers.
 *   • AN EXPLICIT PERMISSION TO SKIP IT. Most turns do not need deliberation, and a model obliged to
 *     deliberate about "rename this variable" burns tokens to reach the obvious.
 */
export function promptedThinking(effort: ReasoningEffort): string {
  if (effort === "none") return "";
  const room = { low: "two or three sentences", medium: "a short paragraph", high: "as long as it takes" }[
    effort
  ];
  return [
    `Before answering a question that needs it, work the problem out first inside a block that starts with ${THINK_OPEN} and ends with ${THINK_CLOSE}.`,
    `Keep it to ${room}. Nothing in that block is shown as your answer, so do not put the answer there — put the thinking that gets you to it: what you know, what you are unsure of, what you would check.`,
    `Then write the answer after ${THINK_CLOSE}.`,
    `If the question does not need working out, skip the block entirely and just answer. Most do not.`,
  ].join(" ");
}

/**
 * Pull the prompted block out of a stream, routing it to the reasoning channel.
 *
 * Stateful and chunk-safe: a delimiter arrives split across two deltas often enough that handling it
 * is the whole job. The rule is to hold back only as much as could still be the start of a
 * delimiter, so text flows to the screen with at most a few characters of lag.
 *
 * Mirrors `streamingRestorer`, which solves the same shape of problem for pseudonymisation markers.
 */
export function thinkingSplitter(): {
  push: (chunk: string) => { text?: string; reasoning?: string };
  flush: () => { text?: string; reasoning?: string };
} {
  let held = "";
  let inside = false;
  /** Could `tail` still become `token`? Then it has to wait. */
  const partial = (tail: string, token: string): boolean => {
    const start = Math.max(0, tail.length - token.length + 1);
    for (let i = start; i < tail.length; i++) if (token.startsWith(tail.slice(i))) return true;
    return false;
  };

  function take(): { text?: string; reasoning?: string } {
    let text = "";
    let reasoning = "";
    for (;;) {
      const token = inside ? THINK_CLOSE : THINK_OPEN;
      const at = held.indexOf(token);
      if (at >= 0) {
        const before = held.slice(0, at);
        if (inside) reasoning += before;
        else text += before;
        held = held.slice(at + token.length);
        inside = !inside;
        continue;
      }
      // Nothing to emit beyond what cannot be the start of the next delimiter.
      let keep = 0;
      for (let i = 1; i < Math.min(token.length, held.length + 1); i++) {
        if (partial(held.slice(held.length - i), token)) keep = i;
      }
      const ready = held.slice(0, held.length - keep);
      held = held.slice(held.length - keep);
      if (inside) reasoning += ready;
      else text += ready;
      break;
    }
    return { ...(text ? { text } : {}), ...(reasoning ? { reasoning } : {}) };
  }

  return {
    push(chunk) {
      held += chunk;
      return take();
    },
    flush() {
      // ⚠️ An unterminated block goes to REASONING, not to the answer. A model that opened the block
      // and ran out of budget produced deliberation; showing it as the reply would present working-out
      // as a conclusion, which is the one outcome worse than showing nothing.
      const rest = held;
      held = "";
      if (!rest) return {};
      return inside ? { reasoning: rest } : { text: rest };
    },
  };
}

/**
 * Split a whole, already-accumulated reply.
 *
 * The streaming path has `thinkingSplitter`; this is for the text the provider hands back at the end,
 * which is the RAW reply and still carries the block. Needed because the saved answer is taken from
 * that field rather than from what was streamed — so without this, the deliberation was stripped from
 * the screen and written back into the transcript.
 */
export function splitThinkingText(text: string): { text: string; reasoning: string } {
  const s = thinkingSplitter();
  const a = s.push(text);
  const b = s.flush();
  return {
    text: (a.text ?? "") + (b.text ?? ""),
    reasoning: (a.reasoning ?? "") + (b.reasoning ?? ""),
  };
}
