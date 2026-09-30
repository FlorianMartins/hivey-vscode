// What the picker is allowed to offer.
//
// The list had four hundred and fifty-seven rows in it whatever the user had configured, because
// the generated catalogue is shipped with the extension and was appended unconditionally. Every one
// of those rows is reached THROUGH OpenRouter, and so are the three Hivey presets, which are a
// routing over the same catalogue. Without a key there they are not choices. They are a shop
// window.
//
// That is worth showing to somebody who has nothing configured yet — it is the argument for
// connecting a provider at all — and it is noise to somebody whose access is a private gateway with
// four models on it, which is how it was reported: "when a gateway is configured it should offer
// only the models the proxy serves".
//
// So the rule is about reachability rather than about gateways: the picker offers what this
// installation can actually reach, and falls back to the catalogue only when it can reach nothing
// else. Nobody is ever shown a shorter list than the one they can use.

import type { UiModel } from "../../shared/protocol.js";

export interface Reach {
  /** A key is stored for OpenRouter, so the catalogue and the presets are reachable. */
  openrouter: boolean;
  /**
   * The provider currently selected.
   *
   * A gateway settles the question on its own, key or no key elsewhere: somebody working through
   * their own proxy is choosing between the three or four models it serves, and four hundred
   * OpenRouter rows are not a longer list for them — they are the reason they cannot find the
   * short one. Switching away is one click on the composer's provider button, which is where
   * changing provider belongs.
   */
  provider?: string;
}

export function offerable(all: UiModel[], reach: Reach): UiModel[] {
  const throughOpenRouter = (m: UiModel): boolean => m.provider === "openrouter";
  const onTheGateway = reach.provider === "openai-compatible";
  if (reach.openrouter && !onTheGateway) return all;

  // A source of their OWN that they had to configure: a gateway, or a vendor they hold a key for.
  //
  // Keyed on the PROVIDER and not on `local`, and that is not a detail. A gateway is marked local
  // whenever its address is loopback or an RFC1918 network — which is what an internal proxy is —
  // so a rule that asked "is it remote?" would never fire for the very user who reported this.
  // What matters is that somebody went and configured it.
  //
  // A discovered local runtime does not count, and that is the safety of this rule. Somebody
  // running Ollama and nothing else has not chosen where their models come from — they have not
  // chosen to have any but these — and hiding the catalogue would remove the only thing that says
  // what connecting a provider would buy. Somebody who has configured a proxy HAS chosen, and four
  // hundred models they cannot send a question to are in their way.
  const configured = onTheGateway || all.some((m) => m.provider !== "local" && !throughOpenRouter(m));
  if (!configured) return all;

  // The selected model always survives, whatever it is reached through. A picker whose trigger
  // names a model absent from its own list cannot be closed by choosing again.
  return all.filter((m) => !throughOpenRouter(m) || m.current);
}
