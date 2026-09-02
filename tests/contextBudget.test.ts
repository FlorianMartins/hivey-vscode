// What the context-budget menu may offer, for a given model.

import { test } from "node:test";
import assert from "node:assert/strict";
import { contextBudgets } from "../src/webview/chat.js";

test("never offers more than the model can hold", () => {
  // The whole point: a step past the window is a promise the run cannot keep, and the failure would
  // arrive a question later as a truncation nobody asked for.
  for (const window of [4_096, 8_192, 32_768, 128_000, 200_000, 1_000_000]) {
    for (const offered of contextBudgets(window)) {
      assert.ok(offered <= window, `${offered} offered for a ${window}-token model`);
    }
  }
});

test("leaves room for the answer", () => {
  // A budget equal to the window fills it with the question alone.
  for (const window of [8_192, 128_000]) {
    for (const offered of contextBudgets(window)) assert.ok(offered <= window * 0.75);
  }
});

test("a tiny window still gets one usable choice", () => {
  // Every fixed step is already past 4k here, so the list would otherwise be empty and the menu a
  // heading with nothing under it.
  const offered = contextBudgets(4_096);
  assert.equal(offered.length, 1);
  assert.ok(offered[0]! > 0 && offered[0]! <= 4_096 * 0.75);
});

test("a large window is reachable, not stopped at the largest fixed step", () => {
  // 200k models were offering 128k as their maximum, leaving a quarter of the window unusable.
  const offered = contextBudgets(1_000_000);
  assert.ok(offered[offered.length - 1]! > 200_000, `largest offered: ${offered[offered.length - 1]}`);
});

test("an unknown window falls back to fixed steps rather than inventing a ceiling", () => {
  const offered = contextBudgets(0);
  assert.deepEqual(offered, [4_000, 8_000, 16_000, 32_000, 64_000]);
  assert.deepEqual(contextBudgets(-1), offered, "a nonsense window is treated as unknown");
});

test("the steps are ordered and free of duplicates", () => {
  for (const window of [0, 8_192, 32_768, 128_000, 200_000]) {
    const offered = contextBudgets(window);
    assert.deepEqual([...offered].sort((a, b) => a - b), offered, `unordered for ${window}`);
    assert.equal(new Set(offered).size, offered.length, `duplicates for ${window}`);
  }
});
