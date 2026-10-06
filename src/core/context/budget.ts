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
 * What the window must keep back for the answer and for the steps after the first.
 *
 * ⚠️⚠️ THIS REPLACED A 32,000-TOKEN CEILING, and the reason that ceiling existed is worth keeping in
 * view: it was never technical, it was about money. "An unbounded budget on a million-token window
 * would turn every question into a bill."
 *
 * That argument is sound and it was being made in the wrong place. The product already has caps that
 * watch spending — `budget.perRequestUsd`, `budget.dailyUsd`, `budget.perRequestTokens` — and those
 * ASK before sending. The context ceiling did the same job by silently withholding the model's own
 * window, which is the version the user cannot see, cannot answer, and cannot weigh. Florian asked
 * for the obvious thing: « j'aimerais que par défaut la fenêtre de contexte soit sur la valeur la
 * plus élevée du modèle sélectionné (si le modèle propose 1M, prendre le 1M plutôt que 64k) ».
 *
 * So the money question moves entirely to the caps that ask it out loud, and the budget becomes what
 * it should always have been: the window, less what the turn still needs.
 *
 * The reserve is not a preference. A prompt filling the whole window leaves nothing for the reply,
 * and in agent mode nothing for the tool results of the steps that follow — the turn would truncate
 * on its first answer. A fifth of the window, and never less than room for three answers.
 */
export const RESERVE_SHARE = 0.2;
export const RESERVE_ANSWERS = 3;

/**
 * The budget for this turn.
 *
 * @param configured what the user set, or `undefined` when they never touched the setting. An
 *   explicit figure is obeyed exactly — including one smaller than the floor, because someone who
 *   types 4000 into a setting called "max tokens" means 4000.
 * @param modelWindow the selected model's own context window, 0 when it is not known.
 */
export function contextBudget(
  configured: number | undefined,
  modelWindow: number,
  answerTokens = 4000,
): number {
  if (typeof configured === "number" && configured > 0) return configured;
  if (!Number.isFinite(modelWindow) || modelWindow <= 0) return CONTEXT_FLOOR_TOKENS;
  const reserve = Math.max(Math.floor(modelWindow * RESERVE_SHARE), answerTokens * RESERVE_ANSWERS);
  // A small window can be mostly reserve; the floor is what keeps such a model usable at all.
  return Math.max(CONTEXT_FLOOR_TOKENS, modelWindow - reserve);
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
