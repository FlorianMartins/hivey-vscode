// The Hivey presets: three pseudo-models that are a routing rather than a model.
//
// The idea comes from the two sibling products — the browser sidebar and the web HiveyCode — where
// it is the default way to choose: instead of picking one model and paying its price for everything
// you do, you pick a BUDGET, and each kind of work is sent to the model that suits it. A commit
// message does not need the model that reasons about an architecture, and the model that writes a
// good commit message cannot drive an agent loop.
//
// Two things are deliberately different here, and both come from being in an editor rather than in
// a browser:
//
//   • NO DISPATCHER CALL. The sidebar asks a small model to classify the request before answering
//     it — an extra round trip before the first word, on every turn. This extension does not need
//     to ask: it already knows whether it is completing a line, writing a commit message, answering
//     a question or running an agent, and it already grades the hard questions with the router's
//     own classifier, which is free and instant. The routing is read from what is happening.
//   • NOTHING IS NAMED. The table these functions read is generated daily from the catalogue by
//     rule — budget, capability, vendor family, recency — so no model version is written anywhere
//     in this repository. That is the rule the sibling projects arrived at the expensive way: a
//     hard-coded id is correct the day it is written and 404s a few weeks later, silently.

import { t } from "../../shared/i18n.js";
import { HIVEY_ROUTING, HIVEY_GENERATED_AT } from "./hivey.generated.js";
import type { Complexity, TaskKind } from "./route.js";

export { HIVEY_GENERATED_AT };

/**
 * The preset ids.
 *
 * Spelled exactly as the sibling products spell them, so that a habit — and a settings file copied
 * from one to the other — carries over. `hivey` with no suffix is the middle one; that is historical
 * and kept on purpose, because it is what is already stored in people's configurations.
 */
export type HiveyVariant = "hivey/free" | "hivey" | "hivey/smart";

/** What kind of work a request is, from this routing's point of view. */
export type HiveyRole = "chore" | "everyday" | "deep" | "completion";

export const HIVEY_VARIANTS: Array<{ id: HiveyVariant; label: string; hint: string }> = [
  {
    id: "hivey/free",
    label: "Hivey Free",
    hint: t("Free endpoints only. Costs nothing, and is rate-limited like everything free."),
  },
  {
    id: "hivey",
    label: "Hivey Smart",
    hint: t("A strong model where you feel it, a cheap one for the plumbing."),
  },
  {
    id: "hivey/smart",
    label: "Hivey Pro",
    hint: t("The best of the catalogue on the hard work, without paying it to write commit messages."),
  },
];

export function isHivey(model: string): boolean {
  return model === "hivey" || model.startsWith("hivey/");
}

/**
 * The preset a stored id means.
 *
 * An id that is no longer a preset — one renamed since, or typed by hand — resolves to Free rather
 * than being sent as it stands. The alternative is what the sibling project shipped for a while: the
 * literal string `hivey/balanced` in an API request, and a 400 saying it is not a valid model id.
 */
export function hiveyVariant(model: string): HiveyVariant {
  if (model === "hivey" || model === "hivey/smart" || model === "hivey/free") return model;
  return "hivey/free";
}

export function hiveyLabel(model: string): string {
  return HIVEY_VARIANTS.find((v) => v.id === hiveyVariant(model))?.label ?? "Hivey";
}

/**
 * Which role a task belongs to.
 *
 * The mapping is the extension's own vocabulary, not a new one: `aux` is already what this codebase
 * calls the small chores, `completion` is already the inline one, and the chat/agent split plus the
 * router's complexity grade is already how a hard question is told from an ordinary one. Adding a
 * classifier here would be paying a model to tell us what the call site knows for certain.
 */
export function hiveyRole(kind: TaskKind, level?: Complexity): HiveyRole {
  if (kind === "completion") return "completion";
  if (kind === "aux" || kind === "embed") return "chore";
  if (kind === "agent") return "deep";
  return level === "hard" ? "deep" : "everyday";
}

/**
 * The model a preset uses for a role — or the preset id unchanged when it is not a preset at all.
 *
 * Never returns a `hivey/…` string for a preset: whatever happens, what comes out of here is
 * something a provider has heard of. A role missing from the generated table falls back along the
 * roles that are present, which is only reachable if a provider retires a whole class of model
 * between two refreshes of the catalogue.
 */
export function hiveyModel(model: string, role: HiveyRole): string {
  if (!isHivey(model)) return model;
  const table = HIVEY_ROUTING[hiveyVariant(model)] ?? {};
  const order: HiveyRole[] = [role, "everyday", "deep", "chore", "completion"];
  for (const candidate of order) {
    const found = table[candidate];
    if (found) return found;
  }
  // Nothing in the table at all. Rather than send a string no provider knows, hand back the free
  // preset's everyday model if there is one, and otherwise let the caller's own error surface.
  return HIVEY_ROUTING["hivey/free"]?.everyday ?? model;
}

/** Every model a preset can reach, for the parts of the interface that price or explain it. */
export function hiveyModels(model: string): string[] {
  const table = HIVEY_ROUTING[hiveyVariant(model)] ?? {};
  return [...new Set(Object.values(table))];
}
