// How much a model holds, from the generated catalogue.
//
// One lookup, because both halves of the product need the same answer and one of them was answering
// with a constant. `src/extension/models.ts` had this; the terminal client had `contextTokens: 8000`
// written in its defaults, and the `CHANGELOG` records that a fixed figure was precisely the defect
// the panel had — 8 000 tokens is most of a small local model's window and a rounding error on a
// modern one. It became visible the day a "To know" notice started reporting "the context is 100 %
// full" on a model with a million-token window.

import { GENERATED_MODELS } from "./catalog.generated.js";

let cache: Map<string, number> | undefined;

function windows(): Map<string, number> {
  if (cache) return cache;
  const map = new Map<string, number>();
  for (const [id, , , context] of GENERATED_MODELS) map.set(id, context);
  // The bare name too — `claude-opus-5.5` as well as `anthropic/claude-opus-5.5` — because a
  // vendor's own endpoint answers with ids that carry no vendor prefix. Added in a second pass so a
  // fully qualified id always wins over a bare one that happens to collide.
  for (const [id, , , context] of GENERATED_MODELS) {
    const bare = id.includes("/") ? id.slice(id.indexOf("/") + 1) : undefined;
    if (bare && !map.has(bare)) map.set(bare, context);
  }
  return (cache = map);
}

/** The model's window in tokens, or `0` when the catalogue does not know it. */
export function catalogueWindow(id: string): number {
  return windows().get(id) ?? 0;
}
