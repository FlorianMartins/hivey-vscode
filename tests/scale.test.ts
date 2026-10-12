// Caps that grow with the model in use, and a model's own output limit learned from its refusal.
//
// "remove every context or token limit, even for cloud models — adapt to the models' own limits".

import { test } from "node:test";
import assert from "node:assert/strict";
import { scaledChars, scaledTokens, setActiveWindow, getActiveWindow } from "../src/core/context/scale.js";
import { maxOutputFromRefusal } from "../src/core/providers/anthropic.js";

test("a cap is a share of the selected model's window, never below its old figure", () => {
  setActiveWindow(0);
  assert.equal(scaledChars(24_000, 0.25), 24_000, "an unknown window keeps the old figure");
  setActiveWindow(139_264);
  assert.equal(scaledChars(24_000, 0.25), 139_264, "a quarter of 139k tokens, in characters");
  setActiveWindow(1_000_000);
  assert.equal(scaledTokens(1200, 0.05), 50_000, "a 1M window reads 50k tokens of house rules, not 1 200");
  setActiveWindow(8000);
  assert.equal(scaledTokens(5000, 0.15), 5000, "a small window never goes below the old figure");
  setActiveWindow(Number.NaN);
  assert.equal(getActiveWindow(), 0);
});

test("the output limit is read from the API's own refusal", () => {
  assert.equal(
    maxOutputFromRefusal("max_tokens: 64000 > 32000, which is the maximum allowed number of output tokens for claude-opus-4-20250514"),
    32000,
  );
  assert.equal(maxOutputFromRefusal("overloaded_error: Overloaded"), 0, "any other refusal is not one");
});
