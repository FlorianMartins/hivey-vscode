// Learning what a token is, from the only authority on the question: the provider that bills for
// them. Every test here is about not trusting that authority blindly — one absurd sample must not
// be able to move the budget somewhere useless.

import { test } from "node:test";
import assert from "node:assert/strict";
import { calibrate, describeCalibration, factorFor, observe, prune, MAX_FACTOR, MIN_FACTOR } from "../src/core/util/calibrate.js";

test("an unmeasured model is left exactly as estimated", () => {
  assert.equal(factorFor({}, "qwen"), 1);
  assert.equal(calibrate({}, "qwen", 1234), 1234);
});

test("one measurement is enough to start correcting", () => {
  const table = observe({}, "qwen", { estimated: 1000, actual: 1200 });
  assert.equal(factorFor(table, "qwen"), 1.2);
  assert.equal(calibrate(table, "qwen", 1000), 1200);
});

test("ten measurements converge on the truth", () => {
  // The claim in the module's own comment, checked rather than asserted: after about ten requests
  // the factor is within a few per cent.
  let table = {};
  for (let i = 0; i < 10; i++) table = observe(table, "qwen", { estimated: 1000, actual: 1300 });
  assert.ok(Math.abs(factorFor(table, "qwen") - 1.3) < 0.04, `factor is ${factorFor(table, "qwen")}`);
});

test("it follows a change instead of being outvoted by history", () => {
  // Someone who spends a month on prose and then opens a monorepo of minified JavaScript.
  let table = {};
  for (let i = 0; i < 30; i++) table = observe(table, "qwen", { estimated: 1000, actual: 1000 });
  for (let i = 0; i < 12; i++) table = observe(table, "qwen", { estimated: 1000, actual: 1600 });
  assert.ok(factorFor(table, "qwen") > 1.3, `a plain average would still be near 1: ${factorFor(table, "qwen")}`);
});

test("each model learns its own tokenizer", () => {
  let table = observe({}, "qwen", { estimated: 1000, actual: 1400 });
  table = observe(table, "claude", { estimated: 1000, actual: 900 });
  assert.equal(factorFor(table, "qwen"), 1.4);
  assert.equal(factorFor(table, "claude"), 0.9);
});

test("an absurd sample is discarded, not clamped", () => {
  // A provider reporting usage for a cached prefix, or a gateway injecting its own system prompt.
  // Clamping would let a stream of nonsense drag the factor to the edge and pin it there.
  const good = observe({}, "qwen", { estimated: 1000, actual: 1100 });
  const after = observe(good, "qwen", { estimated: 1000, actual: 90_000 });
  assert.equal(factorFor(after, "qwen"), factorFor(good, "qwen"), "nonsense moved the factor");
  assert.equal(observe(good, "qwen", { estimated: 1000, actual: 10 }), good, "a near-zero count is not evidence either");
});

test("a tiny request is not a measurement", () => {
  // Under a couple of hundred tokens the per-message framing dominates and the ratio is noise.
  assert.deepEqual(observe({}, "qwen", { estimated: 30, actual: 60 }), {});
});

test("nothing that is not a number gets in", () => {
  assert.deepEqual(observe({}, "qwen", { estimated: NaN, actual: 500 }), {});
  assert.deepEqual(observe({}, "qwen", { estimated: 500, actual: Infinity }), {});
  assert.deepEqual(observe({}, "", { estimated: 500, actual: 600 }), {});
});

test("the factor can never leave the band, whatever happens", () => {
  let table = {};
  for (let i = 0; i < 200; i++) table = observe(table, "qwen", { estimated: 1000, actual: 2400 });
  assert.ok(factorFor(table, "qwen") <= MAX_FACTOR);
  let low = {};
  for (let i = 0; i < 200; i++) low = observe(low, "qwen", { estimated: 1000, actual: 450 });
  assert.ok(factorFor(low, "qwen") >= MIN_FACTOR);
});

test("an unchanged table is returned as the same object, so nothing is written for nothing", () => {
  const table = observe({}, "qwen", { estimated: 1000, actual: 1100 });
  assert.equal(observe(table, "qwen", { estimated: 5, actual: 5 }), table);
});

test("the label says nothing until it knows something", () => {
  let table = observe({}, "qwen", { estimated: 1000, actual: 1300 });
  assert.equal(describeCalibration(table, "qwen"), undefined, "one sample is not a claim");
  for (let i = 0; i < 5; i++) table = observe(table, "qwen", { estimated: 1000, actual: 1300 });
  assert.match(describeCalibration(table, "qwen")!, /calibrated on 6 requests/);
  assert.match(describeCalibration(table, "qwen")!, /\+30%/, "six identical samples of 1.3 should read as exactly +30%");
});

test("the table cannot grow for ever", () => {
  let table = {};
  for (let i = 0; i < 60; i++) table = observe(table, `model-${i}`, { estimated: 1000, actual: 1100 });
  assert.equal(Object.keys(prune(table, 40)).length, 40);
});
