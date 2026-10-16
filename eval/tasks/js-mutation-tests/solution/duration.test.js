import { test } from "node:test";
import assert from "node:assert/strict";
import { parseDuration } from "./duration.js";

test("each unit on its own", () => {
  assert.equal(parseDuration("1d"), 86_400_000);
  assert.equal(parseDuration("1h"), 3_600_000);
  assert.equal(parseDuration("1m"), 60_000);
  assert.equal(parseDuration("1s"), 1_000);
  assert.equal(parseDuration("1ms"), 1);
  assert.equal(parseDuration("500ms"), 500);
});

test("parts combine", () => {
  assert.equal(parseDuration("1h30m"), 5_400_000);
  assert.equal(parseDuration("2d3h4m5s6ms"), 2 * 86_400_000 + 3 * 3_600_000 + 4 * 60_000 + 5 * 1_000 + 6);
  assert.equal(parseDuration("1m5s"), 65_000);
});

test("spaces between parts and around the whole are allowed", () => {
  assert.equal(parseDuration("1h 30m"), 5_400_000);
  assert.equal(parseDuration("  1h   30m  "), 5_400_000);
});

test("decimals", () => {
  assert.equal(parseDuration("1.5h"), 5_400_000);
  assert.equal(parseDuration("0.5s"), 500);
});

test("the result is rounded to the nearest millisecond", () => {
  assert.equal(parseDuration("1.5ms"), 2);
  assert.equal(parseDuration("0.0004s"), 0);
  assert.equal(parseDuration("2.6ms"), 3);
});

const refused = (input) =>
  assert.throws(
    () => parseDuration(input),
    (error) => error instanceof RangeError && error.message.includes(JSON.stringify(input)),
    `${JSON.stringify(input)} should be a RangeError naming it`,
  );

test("parts must go from the largest unit to the smallest", () => {
  refused("30m1h");
  refused("1s1m");
});

test("a unit may appear only once", () => {
  refused("1h1h");
  refused("1m 2m");
});

test("a number without a unit, a negative number, an unknown unit, an empty string", () => {
  refused("90");
  refused("-5s");
  refused("5w");
  refused("1H");
  refused("1M");
  refused("");
  refused("   ");
  refused("h");
});
