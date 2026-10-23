// What the terminal client reads from its environment: the measurement knobs the evaluation sets.

import { test } from "node:test";
import assert from "node:assert/strict";
import { ENV, contextFromEnv, reasoningFromEnv, temperatureFromEnv } from "../src/cli/env.js";

test("the evaluation knobs change nothing unless they are set to something valid", () => {
  assert.equal(reasoningFromEnv(undefined), undefined);
  assert.equal(reasoningFromEnv("deep"), undefined, "an unknown level is ignored, not guessed");
  assert.equal(reasoningFromEnv(" High "), "high");
  assert.equal(temperatureFromEnv(undefined), undefined);
  assert.equal(temperatureFromEnv(""), undefined);
  assert.equal(temperatureFromEnv("abc"), undefined);
  assert.equal(temperatureFromEnv("3"), undefined, "out of range");
  assert.equal(temperatureFromEnv("0.6"), 0.6);
  assert.equal(temperatureFromEnv("0"), 0);
});

test("a context window asked for a measurement: a whole number of tokens, 4096 at least — or nothing", () => {
  assert.equal(ENV.context, "HIVEY_CODE_CONTEXT");
  assert.equal(contextFromEnv("16384"), 16384);
  assert.equal(contextFromEnv(" 20000 "), 20000);
  assert.equal(contextFromEnv(undefined), undefined, "unset: the window is what it always was");
  assert.equal(contextFromEnv("1000"), undefined, "too small to hold a system prompt");
  assert.equal(contextFromEnv("16k"), undefined);
});
