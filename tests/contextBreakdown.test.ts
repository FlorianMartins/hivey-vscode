// What the context is made of.
//
// The panel showed a percentage and nothing about its composition, and the attribution that did
// exist was on the consent card — a screen that appears for a remote provider, once per session.
// These tests pin the three decisions that make a bar honest: nothing invisible, nothing negative,
// and nothing invented when the window is unknown.

import { test } from "node:test";
import assert from "node:assert/strict";
import { contextBreakdown, FLOOR, OTHER } from "../src/core/context/breakdown.js";

test("the parts are ordered, shared against the budget, and the rest is free", () => {
  const b = contextBreakdown(
    [
      { label: "instructions", tokens: 1000 },
      { label: "repository map", tokens: 3000 },
      { label: "the conversation", tokens: 2000 },
    ],
    10_000,
  );
  assert.deepEqual(b.segments.map((s) => s.label), ["repository map", "the conversation", "instructions"]);
  assert.equal(b.used, 6000);
  assert.equal(b.free, 4000);
  assert.equal(b.freeShare, 0.4);
  assert.equal(b.segments[0]!.share, 0.3);
  assert.equal(b.over, false);
});

test("slivers are merged instead of drawn", () => {
  // A bar with twenty slices of a third of a percent is texture, not information — and each slice is
  // a legend line nobody can read.
  const parts = [{ label: "big", tokens: 5000 }, ...Array.from({ length: 20 }, (_, i) => ({ label: `f${i}`, tokens: 30 }))];
  const b = contextBreakdown(parts, 10_000);
  assert.deepEqual(b.segments.map((s) => s.label), ["big", OTHER]);
  assert.equal(b.segments[1]!.tokens, 600);
  // And the floor is the documented one, not an accident of the data.
  assert.ok(30 / 10_000 < FLOOR);
});

test("over budget says so instead of drawing a negative space", () => {
  const b = contextBreakdown([{ label: "x", tokens: 12_000 }], 10_000);
  assert.equal(b.over, true);
  assert.equal(b.free, 0, "free space is never negative");
  assert.equal(b.freeShare, 0);
  // The segment keeps its true size even though it exceeds the bar: the caller clamps the drawing,
  // not the figure.
  assert.equal(b.segments[0]!.tokens, 12_000);
  assert.equal(b.segments[0]!.share, 1.2);
});

test("an unknown budget draws no bar and invents no share", () => {
  // A local endpoint whose window nobody declared. Shares of zero, and the caller shows the count
  // alone — rather than a bar against a number that was made up.
  const b = contextBreakdown([{ label: "a", tokens: 100 }, { label: "b", tokens: 900 }], 0);
  assert.equal(b.budget, 0);
  assert.equal(b.used, 1000);
  for (const s of b.segments) assert.equal(s.share, 0);
  // But the parts are still ranked against each other, so the composition is readable.
  assert.deepEqual(b.segments.map((s) => s.label), ["b", "a"]);
});

test("the same label twice is one line", () => {
  const b = contextBreakdown([{ label: "src/app.ts", tokens: 400 }, { label: "src/app.ts", tokens: 600 }], 10_000);
  assert.equal(b.segments.length, 1);
  assert.equal(b.segments[0]!.tokens, 1000);
});

test("nothing, zero and nonsense produce an empty breakdown rather than NaN", () => {
  for (const parts of [[], [{ label: "x", tokens: 0 }], [{ label: "", tokens: 50 }], [{ label: "y", tokens: NaN }]]) {
    const b = contextBreakdown(parts, 10_000);
    assert.deepEqual(b.segments, []);
    assert.equal(b.used, 0);
    assert.equal(b.free, 10_000);
  }
});
