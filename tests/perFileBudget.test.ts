// How much of one attached file is kept, which follows the context budget rather than a constant.

import { test } from "node:test";
import assert from "node:assert/strict";
import { perFileBudget } from "../src/core/util/tokens.js";

const withBudget = (maxTokens: number) => maxTokens;

test("the old flat cap is the floor, not the rule", () => {
  // 4 000 was right when the budget was 8 000 — half the budget on one file is already generous.
  assert.equal(perFileBudget(withBudget(8_000)), 4_000);
  assert.equal(perFileBudget(withBudget(1_000)), 4_000, "a tiny budget still allows a usable file");
});

test("a model-sized budget keeps model-sized files", () => {
  // The complaint that prompted this: every file attached from the editor came back "(truncated)",
  // because a 4 000-token cap survived into a window two hundred times its size.
  assert.equal(perFileBudget(withBudget(200_000)), 80_000);
  assert.equal(perFileBudget(withBudget(1_000_000)), 400_000);
});

test("one attachment never takes the whole budget", () => {
  // The question and the answer have to fit beside it.
  for (const budget of [8_000, 50_000, 200_000, 1_000_000]) {
    assert.ok(perFileBudget(withBudget(budget)) < budget || budget <= 10_000);
  }
});
