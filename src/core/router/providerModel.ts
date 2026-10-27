// The model that goes with a provider, when the provider is switched.
//
// ⚠️ « quand on change de mode (OpenRouter, fournisseur, local ou gateway) … changer de modèle pour
// éviter les erreurs HTTP 404 ». Switching the provider changed only the provider: the model stayed
// what it was, so the gateway's `qwen-27b` was sent to OpenRouter — which has no such model — and the
// next question failed with a 404 nobody connected to the switch.

/** A model as the picker lists it: its id and the provider that serves it. */
export interface ListedModel {
  id: string;
  provider: string;
}

/**
 * The model to use once `provider` is chosen, or `undefined` to leave the model as it is (nothing is
 * known about that provider yet — no list, no model used with it before).
 *
 * In order: the model last used with that provider, while it is still served (or when its list has
 * not come in); the current model, if that provider serves it too; the first model that provider lists.
 */
export function modelForProvider(
  provider: string,
  current: string,
  remembered: Readonly<Record<string, string>>,
  models: readonly ListedModel[],
): string | undefined {
  const served = models.filter((m) => m.provider === provider);
  const last = remembered[provider];
  // Its list unknown: the model it last answered with, rather than another provider's model.
  if (!served.length) return last;
  if (last && served.some((m) => m.id === last)) return last;
  if (served.some((m) => m.id === current)) return current;
  return served[0]!.id;
}
