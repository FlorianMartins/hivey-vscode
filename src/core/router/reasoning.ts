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

/** Does this model accept a thinking budget? The catalogue first, then the family. */
export function canReason(id: string): boolean {
  if (!id) return false;
  if (GENERATED_REASONING.has(id)) return true;
  const bare = id.includes("/") ? id.slice(id.indexOf("/") + 1) : id;
  if (GENERATED_REASONING.has(bare)) return true;
  return REASONING_FALLBACK.test(id);
}
