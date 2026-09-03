// What the context-budget menu may offer, for a given model.

import { test } from "node:test";
import assert from "node:assert/strict";
import { contextBudgets } from "../src/webview/chat.js";

// The windows that actually turn up: a small local model, a mid one, the usual gateway sizes, and
// the very large ones. Powers of two included on purpose — 131 072 is what a catalogue reports.
const WINDOWS = [4_096, 8_192, 32_768, 128_000, 131_072, 200_000, 1_000_000];

test("never offers more than the model can hold", () => {
  // A step past the window is a promise the run cannot keep, and the failure would arrive a
  // question later as a truncation nobody asked for.
  for (const window of WINDOWS) {
    for (const offered of contextBudgets(window)) {
      assert.ok(offered <= window, `${offered} offered for a ${window}-token model`);
    }
  }
});

test("the whole window is on the list", () => {
  // It was capped at three quarters, on the reasoning that the answer needs room too. That is true
  // and it is not this setting's decision: a model with a million tokens has a million, and a menu
  // that will not say so argues with the number printed beside it.
  for (const window of WINDOWS) {
    const offered = contextBudgets(window);
    assert.equal(offered[offered.length - 1], window, `the window itself is missing for ${window}`);
  }
});

test("and there is still a smaller option for people paying per token", () => {
  // The full window as the ONLY offer would be a different mistake: on a paid model the budget is
  // the bill, and most questions do not need the whole thing.
  for (const window of WINDOWS) {
    const offered = contextBudgets(window);
    assert.ok(offered.length >= 2, `only ${offered.length} option for ${window}`);
    assert.ok(offered[0]! <= window * 0.2, `the smallest option for ${window} is ${offered[0]}`);
  }
});

test("every option is worth choosing for the model it belongs to", () => {
  // The complaint that prompted this: 4 000 tokens offered on Claude. The options were an absolute
  // ladder filtered by the window, so the small end of the ladder followed every model around, and
  // on a large one the first offer was a fraction of a percent of what it could hold.
  for (const window of WINDOWS) {
    const offered = contextBudgets(window);
    assert.ok(offered[0]! >= window * 0.1, `${offered[0]} is nothing on a ${window}-token model`);
  }
});

test("most of a large window is reachable", () => {
  // The ladder stopped at 200k however big the model was, so three quarters of a 200k window and
  // most of a million-token one could not be chosen at all.
  for (const window of [200_000, 1_000_000]) {
    const offered = contextBudgets(window);
    assert.ok(
      offered[offered.length - 1]! >= window * 0.7,
      `largest offered for ${window}: ${offered[offered.length - 1]}`,
    );
  }
});

test("the numbers are ones a person would say", () => {
  // An eighth of 131 072 is 16 384. Offering that is offering arithmetic, not a choice. The window
  // itself is the exception and has to be: rounding it up would offer more than the model holds,
  // and rounding it down would print a number nobody recognises as their model's size.
  for (const window of WINDOWS) {
    for (const offered of contextBudgets(window)) {
      if (offered === window) continue;
      const step = offered < 1000 ? 100 : offered < 10_000 ? 500 : offered < 100_000 ? 1000 : 5000;
      assert.equal(offered % step, 0, `${offered} is not a round number at its size`);
    }
  }
});

test("a short list, and never an empty one", () => {
  for (const window of WINDOWS) {
    const offered = contextBudgets(window);
    assert.ok(offered.length >= 1 && offered.length <= 6, `${offered.length} options for ${window}`);
  }
});

test("an unknown window falls back to fixed steps rather than inventing a ceiling", () => {
  const offered = contextBudgets(0);
  assert.deepEqual(offered, [4_000, 8_000, 16_000, 32_000, 64_000]);
  assert.deepEqual(contextBudgets(-1), offered, "a nonsense window is treated as unknown");
});

test("the steps are ordered and free of duplicates", () => {
  // Rounding can collapse two fractions of a small window onto the same number.
  for (const window of [0, ...WINDOWS]) {
    const offered = contextBudgets(window);
    assert.deepEqual([...offered].sort((a, b) => a - b), offered, `unordered for ${window}`);
    assert.equal(new Set(offered).size, offered.length, `duplicates for ${window}`);
  }
});
