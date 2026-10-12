import { test } from "node:test";
import assert from "node:assert/strict";
import { schedule } from "./schedule.js";

test("the instalments total the principal", () => {
  for (const principal of [100_000, 99_999, 1, 7, 123_457, 250_000]) {
    for (const count of [1, 2, 3, 7, 12, 13]) {
      const parts = schedule(principal, count);
      assert.equal(parts.length, count, `${principal} over ${count}`);
      assert.equal(
        parts.reduce((a, b) => a + b, 0),
        principal,
        `${principal} over ${count} came to ${parts.reduce((a, b) => a + b, 0)}`,
      );
    }
  }
});

test("every instalment is a whole number of cents", () => {
  for (const part of schedule(100, 3)) assert.equal(Number.isInteger(part), true);
});

test("the instalments differ by at most one cent", () => {
  const parts = schedule(100_000, 7);
  assert.ok(Math.max(...parts) - Math.min(...parts) <= 1, `spread too wide: ${parts.join(", ")}`);
});

test("a non-positive number of instalments is refused", () => {
  assert.throws(() => schedule(1000, 0));
});
