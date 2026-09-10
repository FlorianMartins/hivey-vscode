import { test } from "node:test";
import assert from "node:assert/strict";
import { isValidSiret } from "./siret.js";

test("a real SIRET passes", () => {
  assert.equal(isValidSiret("73282932000074"), true);
});

test("one wrong digit fails", () => {
  assert.equal(isValidSiret("73282932000075"), false);
});

test("the wrong length fails", () => {
  assert.equal(isValidSiret("7328293200007"), false);
  assert.equal(isValidSiret("732829320000745"), false);
});

test("anything that is not digits fails, without throwing", () => {
  assert.equal(isValidSiret("7328293200007a"), false);
  assert.equal(isValidSiret(""), false);
  assert.equal(isValidSiret(null), false);
  assert.equal(isValidSiret(undefined), false);
});
