// Which mark stands for which house.
//
// A mapping is the easiest thing in an interface to get subtly wrong and the hardest to notice: a
// model wearing the wrong maker's mark looks like a working feature. So the table is checked against
// the catalogue it exists to decorate, in both directions.

import { test } from "node:test";
import assert from "node:assert/strict";
import { vendorMark } from "../src/core/router/vendorIcon.js";
import { GENERATED_MODELS } from "../src/core/router/catalog.generated.js";

test("a model id carries its vendor, and the vendor carries the mark", () => {
  assert.equal(vendorMark("openai/gpt-6.1-sol-pro"), "vOpenai");
  assert.equal(vendorMark("anthropic/claude-5"), "vAnthropic");
  assert.equal(vendorMark("x-ai/grok-4.7"), "vXai");
  assert.equal(vendorMark("qwen/qwen3.7-flash"), "vQwen");
  assert.equal(vendorMark("meta-llama/llama-4"), "vMeta");
  // A bare vendor name, which is what the model list hands over when it has one.
  assert.equal(vendorMark("mistralai"), "vMistral");
});

test("⚠️ a vendor's own endpoint wears the same face as its reseller's", () => {
  // The catalogue marks a vendor's direct endpoint with a tilde. The company is the same one, and two
  // faces for one company in a single list is exactly the confusion these marks exist to remove.
  assert.equal(vendorMark("~openai/gpt-6.1"), vendorMark("openai/gpt-6.1"));
  assert.equal(vendorMark("~anthropic"), vendorMark("anthropic"));
});

test("an unknown vendor looks like a model, not like a missing image", () => {
  // The fallback is the glyph this control wore before any of these existed. A question mark, or an
  // empty box, would turn "we have no mark for this house" into "something failed to load".
  assert.equal(vendorMark("inclusionai/some-model"), "chip");
  assert.equal(vendorMark("hivey/smart"), "chip", "a preset is not one vendor's model");
  assert.equal(vendorMark(""), "chip");
  assert.equal(vendorMark("qwen2.5-coder:7b"), "chip", "a local model has no vendor prefix to read");
});

test("the marks cover what the catalogue is actually made of", () => {
  // ⚠️ Not "every vendor", which would be a list nobody maintains — the catalogue carries dozens, most
  // of them one model each. What matters is that the HOUSES PEOPLE MEET are recognisable: if the
  // covered vendors ever stop accounting for most of the catalogue, the marks have become decoration
  // on a handful of rows and this should say so.
  const counts = new Map<string, number>();
  for (const [id, , vendor] of GENERATED_MODELS) {
    const key = String(vendor || id);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  let covered = 0;
  let total = 0;
  for (const [vendor, n] of counts) {
    total += n;
    if (vendorMark(vendor) !== "chip") covered += n;
  }
  assert.ok(total > 100, `only ${total} models in the catalogue — did its shape change?`);
  assert.ok(
    covered / total > 0.6,
    `only ${Math.round((100 * covered) / total)} % of catalogue models have a maker's mark; the set has drifted from what the catalogue holds`,
  );
});
