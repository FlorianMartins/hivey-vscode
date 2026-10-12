import { test } from "node:test";
import assert from "node:assert/strict";
import { settles } from "./settlement.js";

test("T+2 over a plain week", () => {
  // Monday 2026-10-05 → Wednesday
  assert.equal(settles("2026-10-05", 2), "2026-10-07");
});

test("T+2 across a weekend", () => {
  // Thursday 2026-10-08 → Friday, then Monday 2026-10-12. Saturday is not a day.
  assert.equal(settles("2026-10-08", 2), "2026-10-12");
});

test("a trade on a Friday", () => {
  // Friday 2026-10-09 → Monday, Tuesday
  assert.equal(settles("2026-10-09", 2), "2026-10-13");
});

test("the holidays the caller supplies are skipped", () => {
  // Wednesday 2026-12-23 → the 24th, then the 25th is a holiday, so the 28th (the 26th and 27th
  // being the weekend).
  assert.equal(settles("2026-12-23", 2, ["2026-12-25"]), "2026-12-28");
});

test("a holiday that is already a weekend costs nothing extra", () => {
  assert.equal(settles("2026-10-08", 2, ["2026-10-10"]), "2026-10-12");
});

test("T+1 and T+0", () => {
  assert.equal(settles("2026-10-09", 1), "2026-10-12");
  assert.equal(settles("2026-10-09", 0), "2026-10-09");
  // T+0 on a non-business day moves to the next one: nothing settles on a Sunday.
  assert.equal(settles("2026-10-10", 0), "2026-10-12");
});
