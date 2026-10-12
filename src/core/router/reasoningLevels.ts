// The thinking levels a self-hosted model really has.
//
// ⚠️ « le mode de réflexion doit correspondre aux modes de raisonnement des modèles utilisés ». The
// panel offered the same four efforts for every model, and on Qwen3.8 they did not line up: its
// chat template knows "low", "medium" and "xhigh" — its DEFAULT, and the one an empty request got —
// and turns "high" into "xhigh". Nothing told the user which was which.
//
// The template says so itself. Asked for an effort it does not know, it refuses before generating
// anything — in milliseconds — with the list: "Unexpected reasoning effort x. Supported types are
// xhigh (default), medium, and low." That refusal is read here. A template that says nothing (it
// ignores the field, or the model does not think) leaves the panel's usual menu in place.

import type { ReasoningEffort } from "../providers/types.js";

export interface ModelReasoning {
  /** The model's own level names, as its template spells them, in the order it gave them. */
  levels: string[];
  /** The one it uses when nothing is asked. */
  defaultLevel?: string;
}

/** The effort sent to make a template list its levels: one no template knows. */
export const PROBE_EFFORT = "hivey-probe";

export function levelsFromRefusal(message: string): ModelReasoning | undefined {
  // The list ends at the sentence's full stop — or at the quote closing the JSON string it sits in.
  const m = /supported (?:types|values|levels|efforts?|options)\s*(?:are|:)\s*([^.\n"\\]+)/i.exec(message);
  if (!m) return undefined;
  const list = m[1]!.replace(/['`]/g, "");
  const levels: string[] = [];
  let defaultLevel: string | undefined;
  for (const raw of list.split(/,|\band\b|\bor\b/)) {
    const item = raw.trim();
    const name = /^[a-z][a-z0-9_-]*/i.exec(item)?.[0]?.toLowerCase();
    if (!name || levels.includes(name)) continue;
    levels.push(name);
    if (/\(default\)/i.test(item)) defaultLevel = name;
  }
  if (!levels.length) return undefined;
  return { levels, ...(defaultLevel ? { defaultLevel } : {}) };
}

/** Which of the panel's four efforts a model level is. */
function effortOf(level: string): Exclude<ReasoningEffort, "none"> | undefined {
  if (/^(minimal|min|low|lite|brief)$/.test(level)) return "low";
  if (/^(medium|med|default|normal|standard)$/.test(level)) return "medium";
  if (/^(high|xhigh|max|maximum|deep)$/.test(level)) return "high";
  return undefined;
}

export interface ReasoningChoice {
  id: ReasoningEffort;
  /** The model's own name for it; "none" for thinking off. */
  native: string;
  isDefault?: boolean;
}

/**
 * The menu for this model: thinking off, then each of its levels, weakest first — and only those.
 * Two levels that are the same effort to the panel (Qwen's "high" is its "xhigh") keep the stronger
 * name, which is the one the template actually runs.
 */
export function choicesFor(r: ModelReasoning): ReasoningChoice[] {
  const byEffort = new Map<Exclude<ReasoningEffort, "none">, ReasoningChoice>();
  for (const level of r.levels) {
    const id = effortOf(level);
    if (!id) continue;
    const prev = byEffort.get(id);
    if (prev && !(id === "high" && level.length > prev.native.length)) continue;
    byEffort.set(id, { id, native: level, ...(level === r.defaultLevel ? { isDefault: true } : {}) });
  }
  const order: Array<Exclude<ReasoningEffort, "none">> = ["low", "medium", "high"];
  return [{ id: "none", native: "none" }, ...order.flatMap((id) => (byEffort.has(id) ? [byEffort.get(id)!] : []))];
}
