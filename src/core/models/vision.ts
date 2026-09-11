// Which models will actually look at a pasted screenshot.
//
// Answered from the generated catalogue, which reads it from the provider, for exactly the reason
// no model version is written by hand in this repository: a heuristic over names is wrong the week
// after it is written. `gpt-5` reads images and `gpt-oss-120b` does not; `qwen3-vl` does and
// `qwen3-coder` does not; and the list changes every few days.
//
// The answer matters because the failure it prevents is a bad one. A model that cannot see an image
// does not say so — the good case is a request rejected with a confusing error, the bad case is an
// answer confidently written about an image nobody looked at.

import { GENERATED_VISION } from "../router/catalog.generated.js";
import { hiveyModel, isHivey } from "../router/hivey.js";

/**
 * True when this model has been seen to accept images.
 *
 * A model absent from the catalogue — anything served by a local runtime, a private gateway — is
 * reported as NOT accepting them. False rather than unknown, deliberately: the two are different
 * facts and only one of them is safe to act on, and the caller's job here is to decide whether to
 * warn somebody before they attach a screenshot their model will ignore.
 */
export function acceptsImages(model: string): boolean {
  if (!model) return false;
  // A preset is a routing, and the model that answers an ordinary question is the one that would
  // receive the image.
  if (isHivey(model)) return GENERATED_VISION.has(hiveyModel(model, "everyday"));
  return GENERATED_VISION.has(model);
}

/**
 * What an image costs, in tokens, for a budget that has to decide before sending.
 *
 * Every provider prices images differently and most of them by tile, so there is no number that is
 * right. This one is a deliberate over-estimate of the common case (a screenshot at around a
 * thousand pixels on the long side, which OpenAI bills at roughly 750 tokens and Anthropic at
 * roughly 1 100): a budget that refuses slightly too early costs a click, and one that lets a
 * request through because it under-counted costs money.
 */
export const IMAGE_TOKENS = 1300;
