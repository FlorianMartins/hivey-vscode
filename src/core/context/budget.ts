// How much of a conversation is allowed to reach the model.
//
// The setting used to be a flat 8000 tokens, and that number is from the era when the only model
// this extension could talk to ran on the user's laptop. The models it routes to now have windows of
// 200 000 to a million. Against a budget of 8000 the effect was not subtlety, it was amnesia: the
// offer to compact fires at two thirds of the budget, so a conversation was being replaced by a
// summary of itself after two or three exchanges. From then on the model was not reasoning about
// what had been said — it was reasoning about a digest of it, and the answers got vaguer with every
// turn for a reason nobody could see. "Three messages and I have used almost the whole context."
//
// So the budget is derived from the window of the model actually in use, and the user's own figure
// still wins whenever they have set one. Three bounds make the derivation safe:
//
//   • a FLOOR, so a model whose window the catalogue does not know behaves as it always did;
//   • a CEILING, because the budget is also what the per-request spending cap is measured against —
//     an unbounded budget on a million-token window would turn every question into a bill;
//   • a FRACTION well under 1, because the window has to hold the answer and, in agent mode, the
//     tool results of every step after the first.

/** What the old flat default was, and what is still used when nothing is known about the model. */
export const CONTEXT_FLOOR_TOKENS = 8000;

/**
 * As far as the derivation will go on its own.
 *
 * Not a technical limit — it is a spending one. At the shipped caps a prompt this size on the
 * dearest model the product routes to is still well inside the per-request cap, so the derivation
 * cannot by itself produce a question the budget has to ask about. Anyone who wants more sets
 * `hiveyCode.context.maxTokens` and owns the consequence.
 */
export const CONTEXT_CEILING_TOKENS = 32_000;

/** Of the model's window. The rest is the answer, and the tool results of the steps that follow. */
const SHARE_OF_WINDOW = 0.4;

/**
 * The budget for this turn.
 *
 * @param configured what the user set, or `undefined` when they never touched the setting. An
 *   explicit figure is obeyed exactly — including one smaller than the floor, because someone who
 *   types 4000 into a setting called "max tokens" means 4000.
 * @param modelWindow the selected model's own context window, 0 when it is not known.
 */
export function contextBudget(configured: number | undefined, modelWindow: number): number {
  if (typeof configured === "number" && configured > 0) return configured;
  if (!Number.isFinite(modelWindow) || modelWindow <= 0) return CONTEXT_FLOOR_TOKENS;
  const share = Math.floor(modelWindow * SHARE_OF_WINDOW);
  return Math.min(CONTEXT_CEILING_TOKENS, Math.max(CONTEXT_FLOOR_TOKENS, share));
}

/**
 * What the repository map may take of it.
 *
 * A share of the budget, capped in absolute terms. The map is a list of paths and symbols: past a
 * few thousand tokens it stops adding knowledge and starts adding haystack, and it sits in the
 * cacheable prefix, so every token of it is paid for on every turn of the conversation. Without the
 * cap, raising the budget would have quietly quadrupled the map as well.
 */
export function repoMapBudget(contextTokens: number): number {
  return Math.min(12_000, Math.floor(contextTokens * 0.4));
}
