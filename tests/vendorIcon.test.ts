// Which mark stands for which house.
//
// A mapping is the easiest thing in an interface to get subtly wrong and the hardest to notice: a
// model wearing the wrong maker's mark looks like a working feature. So the table is checked against
// the catalogue it exists to decorate, in both directions.

import { test } from "node:test";
import assert from "node:assert/strict";
import { vendorSlug } from "../src/core/router/vendorIcon.js";
import { VENDOR_PATHS } from "../src/webview/vendorPaths.generated.js";
import { GENERATED_MODELS } from "../src/core/router/catalog.generated.js";

test("a model id carries its vendor, and the vendor carries the mark", () => {
  assert.equal(vendorSlug("openai/gpt-6.1-sol-pro"), "openai");
  assert.equal(vendorSlug("anthropic/claude-5"), "anthropic");
  assert.equal(vendorSlug("x-ai/grok-4.7"), "xai");
  assert.equal(vendorSlug("qwen/qwen3.7-flash"), "qwen");
  assert.equal(vendorSlug("meta-llama/llama-4"), "meta");
  // A bare vendor name, which is what the model list hands over when it has one.
  assert.equal(vendorSlug("mistralai"), "mistral");
});

test("⚠️ a vendor's own endpoint wears the same face as its reseller's", () => {
  // The catalogue marks a vendor's direct endpoint with a tilde. The company is the same one, and two
  // faces for one company in a single list is exactly the confusion these marks exist to remove.
  assert.equal(vendorSlug("~openai/gpt-6.1"), vendorSlug("openai/gpt-6.1"));
  assert.equal(vendorSlug("~anthropic"), vendorSlug("anthropic"));
});

test("an unknown vendor looks like a model, not like a missing image", () => {
  // `undefined` rather than a slug, and the caller draws the chip this control wore before any of
  // these existed. A question mark, or an empty box, would turn "we have no mark for this house" into
  // "something failed to load".
  assert.equal(vendorSlug("inclusionai/some-model"), undefined);
  assert.equal(vendorSlug("hivey/smart"), undefined, "a preset is not one vendor's model");
  assert.equal(vendorSlug(""), undefined);
  assert.equal(vendorSlug("qwen2.5-coder:7b"), undefined, "a local model has no vendor prefix to read");
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
    if (vendorSlug(vendor)) covered += n;
  }
  assert.ok(total > 100, `only ${total} models in the catalogue — did its shape change?`);
  assert.ok(
    covered / total > 0.6,
    `only ${Math.round((100 * covered) / total)} % of catalogue models have a maker's mark; the set has drifted from what the catalogue holds`,
  );
});

test("⚠️ every slug the lookup can return is one the panel can actually draw", () => {
  // The two halves are written in different files — the mapping in `core`, the paths generated into
  // the webview — and they would drift apart in silence. A slug with no path is the worst of the
  // three states: the lookup says "I know this vendor" and nothing appears, which reads as a broken
  // image rather than as a missing mark.
  const vendors = [
    "openai", "~openai", "anthropic", "google", "qwen", "alibaba", "mistralai", "deepseek",
    "meta-llama", "x-ai", "cohere", "amazon", "nvidia", "z-ai", "minimax", "moonshotai",
    "perplexity", "ollama", "lmstudio",
  ];
  const orphans = vendors.map((v) => vendorSlug(v)).filter((slug): slug is string => Boolean(slug) && !VENDOR_PATHS[slug!]);
  assert.deepEqual(orphans, [], `these resolve to a mark with no drawing: ${orphans.join(", ")}`);
});

test("the marks are the real ones, on the grid they were drawn for", () => {
  // Fetched from lobehub/lobe-icons (MIT) rather than drawn by hand — « est ce que tu peux prendre les
  // vraies icones ». Hand-made approximations of a logo are a different logo, and the difference is
  // exactly what somebody recognising a vendor at a glance is using.
  assert.ok(Object.keys(VENDOR_PATHS).length >= 15, "the generated set has shrunk");
  for (const [slug, paths] of Object.entries(VENDOR_PATHS)) {
    assert.ok(Array.isArray(paths) && paths.length >= 1, `${slug} has no path`);
    // A real mark is detailed; a placeholder is not. Thirty characters is a triangle.
    assert.ok(paths.join("").length > 60, `${slug} is too simple to be the real mark`);
  }
});
