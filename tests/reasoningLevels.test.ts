// The thinking levels a self-hosted model really has, read from its own template's refusal.
//
// « le mode de réflexion doit correspondre aux modes de raisonnement des modèles utilisés ».

import { test } from "node:test";
import assert from "node:assert/strict";
import { choicesFor, levelsFromRefusal } from "../src/core/router/reasoningLevels.js";

const QWEN =
  '{"error":{"code":500,"message":"…raise_exception(\'Unexpected reasoning effort \' ~ reason…\\nError: Jinja Exception: Unexpected reasoning effort hivey-probe. Supported types are xhigh (default), medium, and low.","type":"server_error"}}';

test("Qwen3.8's template lists its levels and its default in its refusal", () => {
  assert.deepEqual(levelsFromRefusal(QWEN), { levels: ["xhigh", "medium", "low"], defaultLevel: "xhigh" });
  assert.equal(levelsFromRefusal("model not found"), undefined, "any other error says nothing about levels");
});

test("the menu is thinking off and the model's own levels, weakest first, by their own names", () => {
  assert.deepEqual(choicesFor(levelsFromRefusal(QWEN)!), [
    { id: "none", native: "none" },
    { id: "low", native: "low" },
    { id: "medium", native: "medium" },
    { id: "high", native: "xhigh", isDefault: true },
  ]);
  // A model with fewer levels offers fewer.
  assert.deepEqual(
    choicesFor({ levels: ["low", "high"], defaultLevel: "high" }).map((c) => c.id),
    ["none", "low", "high"],
  );
  // "high" and "xhigh" are one effort to the panel: the stronger name is the one the template runs.
  assert.equal(choicesFor({ levels: ["high", "xhigh"] }).find((c) => c.id === "high")?.native, "xhigh");
});
