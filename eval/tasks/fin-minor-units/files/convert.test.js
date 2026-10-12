import { test } from "node:test";
import assert from "node:assert/strict";
import { convert } from "./convert.js";

test("euros to euros keeps two decimals", () => {
  // 12.34 EUR at 1.0 → 12.34 EUR → 1234 minor units
  assert.equal(convert(1234, "EUR", "EUR", 1), 1234);
});

test("euros to yen has no minor units at all", () => {
  // 10.00 EUR at 170.25 → 1702.5 JPY, and the yen has no subdivision: 1703 minor units, which
  // IS 1703 yen. Rounded half away from zero.
  assert.equal(convert(1000, "EUR", "JPY", 170.25), 1703);
});

test("yen to euros reads the source currency without decimals too", () => {
  // 1000 JPY (= 1000 minor units) at 0.00587 → 5.87 EUR → 587 minor units
  assert.equal(convert(1000, "JPY", "EUR", 0.00587), 587);
});

test("a currency with three minor units keeps all three", () => {
  // 10.00 EUR at 3.4125 → 34.125 TND → 34125 minor units
  assert.equal(convert(1000, "EUR", "TND", 3.4125), 34125);
});

test("an unknown currency is refused rather than assumed", () => {
  assert.throws(() => convert(1000, "EUR", "ZZZ", 1));
});
