import { test } from "node:test";
import assert from "node:assert/strict";
import { withVat } from "./vat.js";

test("the standard rate adds twenty per cent", () => {
  assert.equal(withVat(100), 120);
});

test("the reduced rate adds five and a half", () => {
  assert.equal(withVat(100, "reduced"), 105.5);
});

test("nothing is still nothing", () => {
  assert.equal(withVat(0), 0);
});

test("a negative amount is refused", () => {
  assert.throws(() => withVat(-1), RangeError);
});

test("an unknown rate is refused", () => {
  assert.throws(() => withVat(100, "zero"), RangeError);
});
