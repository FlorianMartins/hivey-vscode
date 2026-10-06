// Which models accept a thinking budget (chantier 4.5).
//
// It was a regular expression naming versions, and it rotted the way a version in source always
// rots: it matched `gpt-5` and the market moved to `gpt-6`. So `openai/gpt-6.1-sol-pro` — the model
// BOTH paid presets route their deep work to — was reported as unable to reason, and the control
// that turns thinking on was hidden on the strongest model in the product.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { canReason, REASONING_FALLBACK, reasoningSupport } from "../src/core/router/reasoning.js";
import { GENERATED_REASONING } from "../src/core/router/catalog.generated.js";
import { HIVEY_ROUTING } from "../src/core/router/hivey.generated.js";

test("the catalogue answers, so a new generation is recognised the day it ships", () => {
  assert.ok(canReason("openai/gpt-6.1-sol-pro"), "the model the presets use for deep work");
  assert.ok(canReason("anthropic/claude-opus-5.5"));
  // And the bare id too: a native API calls it `gpt-6.1-sol-pro` where a gateway calls it
  // `openai/gpt-6.1-sol-pro`, and a prefix must not decide whether a model can think.
  assert.ok(canReason("gpt-6.1-sol-pro"));
});

test("every model the paid presets route to can reason", () => {
  // The defect, stated as the thing it broke. If a preset sends deep work to a model the product
  // believes cannot think, the thinking control is hidden exactly where it matters most.
  for (const variant of ["hivey", "hivey/smart"]) {
    const deep = HIVEY_ROUTING[variant]?.["deep"];
    assert.ok(deep, `${variant} has no deep model`);
    assert.ok(canReason(deep!), `${variant}'s deep model ${deep} is reported as unable to reason`);
  }
});

test("the fallback names no version, because that was the defect one layer down", () => {
  // Vendor families and capability words only. `deepseek` is a house and is true next year; `gpt-5`
  // was a release and was false within months.
  const source = REASONING_FALLBACK.source;
  assert.ok(!/\d/.test(source), `the fallback contains a version number: ${source}`);
  // And it still answers for a local model no gateway lists.
  assert.ok(canReason("qwen3-coder:30b"));
  assert.ok(canReason("deepseek-r1:7b"));
  assert.ok(canReason("some-thinking-model"));
});

test("a model the catalogue has never heard of is UNKNOWN, not refused", () => {
  // ⚠️⚠️ This test used to assert `!canReason("llama2:7b")` — a confident "no" about a model nothing
  // in this repository knows anything about. The catalogue is OpenRouter's: it cannot answer for a
  // model served through somebody's gateway or running on their own machine, and answering "no"
  // there hid the thinking control on two entire providers. Reported as « avec le modèle Gateway on
  // ne peut pas changer le mode de réflexion et ça doit être pareil avec un modèle local ».
  //
  // Guessing "no" cannot be corrected by anybody — the control is simply not there. Guessing "yes"
  // costs one request that the server answers with a 400, which `adaptRequest` already handles.
  assert.equal(reasoningSupport("llama2:7b"), "unknown");
  assert.equal(reasoningSupport("my-companys-model"), "unknown");
  assert.equal(reasoningSupport("mistral-small"), "unknown");
  // Nothing chosen yet is also not a refusal.
  assert.equal(reasoningSupport(""), "unknown");
});

test("a catalogued vendor's non-reasoning model is a real NO", () => {
  // The one case where absence means something: the catalogue lists this vendor, so it has an
  // opinion about this vendor's models, and this one is not among the reasoning ones.
  const vendor = [...GENERATED_REASONING].find((id) => id.includes("/"))!.split("/")[0]!;
  assert.equal(reasoningSupport(`${vendor}/a-model-that-does-not-exist`), "no");
  assert.equal(canReason(`${vendor}/a-model-that-does-not-exist`), false);
});

test("the capability is generated, not written by hand", () => {
  assert.ok(GENERATED_REASONING.size > 100, "the catalogue should know hundreds of them");
  // The generator reads OpenRouter's own `supported_parameters`; nothing in the repository decides it.
  const script = readFileSync("scripts/update-models.mjs", "utf8");
  assert.match(script, /supported_parameters \?\? \[\]\)\.includes\("reasoning"\)/);
  // And the old expression is gone from the extension.
  const models = readFileSync("src/extension/models.ts", "utf8");
  assert.ok(!/gpt-5\|claude/.test(models), "the version-naming regex is back");
  assert.match(models, /return canReason\(id\);/);
});
