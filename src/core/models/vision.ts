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

import { GENERATED_MODELS, GENERATED_VISION } from "../router/catalog.generated.js";
import { hiveyModel, isHivey } from "../router/hivey.js";

/**
 * Whether the catalogue knows this model at all — and therefore whether `acceptsImages` returning
 * false is a FACT ("this model is listed, without vision") or only an absence. A model on a
 * self-hosted server is never listed, and saying it "does not read images" was untrue for a
 * llama.cpp server given its `--mmproj`. For those, the server's own refusal decides — see
 * `isImageRefusal`.
 */
export function isCatalogued(model: string): boolean {
  if (!model) return false;
  if (isHivey(model)) return true;
  return CATALOGUED.has(model);
}

const CATALOGUED: ReadonlySet<string> = (() => {
  const set = new Set<string>();
  for (const [id] of GENERATED_MODELS) {
    set.add(id);
    if (id.includes("/")) set.add(id.slice(id.indexOf("/") + 1));
  }
  return set;
})();

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

/**
 * Whether a provider's error says it cannot take images — as opposed to anything else going wrong.
 *
 * ⚠️ The catalogue cannot know a self-hosted model: llama.cpp started without its `--mmproj` answers
 * "HTTP 500 Internal Server Error: image input is not supported - hint: if this is unexpected, you
 * may need to provide the mmproj". That broke the whole turn, and every later turn too, since the
 * image stays in the conversation. Read here so the caller can resend without the images.
 */
export function isImageRefusal(message: string): boolean {
  return /image input is not supported|mmproj|does not support (image|vision)|images? (are|is) not supported|vision is not supported|not a (vision|multimodal) model|image_url.*(not supported|unsupported)/i.test(
    message,
  );
}

/**
 * The same messages with the images taken out — and SAID to be taken out, in the message they were
 * attached to, so the model does not answer as though it had looked at them.
 */
export function withoutImages<M extends { content: string; images?: unknown[] }>(messages: M[]): M[] {
  return messages.map((m) => {
    const n = m.images?.length ?? 0;
    if (!n) return m;
    const { images: _dropped, ...rest } = m;
    const note = `[${n} image(s) attached by the user were removed: this model cannot read images. Say so if the question depends on them.]`;
    return { ...rest, content: m.content ? `${m.content}\n\n${note}` : note } as M;
  });
}
