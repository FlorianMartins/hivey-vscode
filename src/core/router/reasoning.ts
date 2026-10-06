// Which models accept a thinking budget.
//
// ⚠️ This was a regular expression in `extension/models.ts` naming versions:
//
//     /o[134]|gpt-5|claude|sonnet|opus|haiku|fable|deepseek|qwen3|reason|think|magistral|grok-[34]|gemini-[23]/i
//
// and it rotted the way a version written in source always rots. It matched `gpt-5`; the market moved
// to `gpt-6`. So `openai/gpt-6.1-sol-pro` — the model **both paid presets route their deep work to**
// — was reported as unable to reason, and the control that turns thinking on was **hidden on the
// strongest model in the product**. The invariant the project states for prices and versions applies
// here word for word: nothing names a version in source.
//
// The catalogue answers now, from OpenRouter's own `supported_parameters`, regenerated daily — 327
// of 454 models on the day this was written.
//
// The fallback stays, because the catalogue cannot answer for a model it has never heard of: a local
// runtime serving `qwen3-coder` appears in no gateway's list, and a pure-catalogue answer would turn
// thinking off for every local model at once. But the fallback **names no version** — only vendor
// families, which are stable for years, and the two words that describe the capability itself. A
// fallback that named versions would be this same defect, one layer down.

import { GENERATED_REASONING } from "./catalog.generated.js";

/**
 * Signals that are not versions.
 *
 * Vendor families and capability words only. `deepseek` is a house; `gpt-5` was a release. The first
 * is true next year and the second was false within months — which is the whole lesson here.
 */
export const REASONING_FALLBACK = /claude|sonnet|opus|haiku|fable|deepseek|qwen|magistral|reason|think/i;

/**
 * Whether this model accepts a thinking budget — with "nobody knows" as a real answer.
 *
 * ⚠️⚠️ Three states, not two, and the missing one cost the feature on two whole providers. The
 * catalogue is OpenRouter's; it cannot answer for a model served through somebody's gateway or
 * running on their own machine, because it has never heard of either. Returning `false` there reads
 * as "this model cannot reason" — an assertion nobody made — and the panel hid the control
 * accordingly. Reported as « avec le modèle Gateway on ne peut pas changer le mode de réflexion et
 * ça doit être pareil avec un modèle local ».
 *
 * `unknown` is not a softer `no`. It is the state where the user knows more than the catalogue does,
 * so the control is offered and the effort is sent; a server that objects answers with a 400, which
 * `adaptRequest` already handles by dropping the field it names. Guessing "no" cannot be corrected
 * by anybody; guessing "yes" costs one adapted request.
 */
export type ReasoningSupport = "yes" | "no" | "unknown";

export function reasoningSupport(id: string): ReasoningSupport {
  if (!id) return "unknown";
  if (GENERATED_REASONING.has(id)) return "yes";
  const bare = id.includes("/") ? id.slice(id.indexOf("/") + 1) : id;
  if (GENERATED_REASONING.has(bare)) return "yes";
  if (REASONING_FALLBACK.test(id)) return "yes";
  // A vendor prefix the catalogue carries means the catalogue HAS an opinion about this vendor's
  // models, and this one is not among the reasoning ones. No prefix, or one it has never seen, means
  // the model does not come from a catalogue at all — a gateway, a local runtime, a private
  // deployment — and there is nothing here to know it by.
  return KNOWN_VENDORS.has(id.slice(0, Math.max(0, id.indexOf("/")))) ? "no" : "unknown";
}

/** Vendors the generated catalogue actually lists, so "absent" can mean something for them. */
const KNOWN_VENDORS = new Set(
  [...GENERATED_REASONING].flatMap((id) => (id.includes("/") ? [id.slice(0, id.indexOf("/"))] : [])),
);

/** Does this model accept a thinking budget? Unknown counts as yes — see `reasoningSupport`. */
export function canReason(id: string): boolean {
  return reasoningSupport(id) !== "no";
}
