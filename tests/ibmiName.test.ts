// Matching an object name against what somebody typed into a search box.

import { test } from "node:test";
import assert from "node:assert/strict";
import { matchesName } from "../src/core/ibmi/sql.js";

test("the platform's own generic name", () => {
  assert.ok(matchesName("CUSTMAINT", "CUST*"));
  assert.ok(!matchesName("ORDMAINT", "CUST*"));
});

test("a star in the middle says what IBM i cannot", () => {
  // The system has no "contains". This is the search the user asked for by name: *531*.
  assert.ok(matchesName("PGM531A", "*531*"));
  assert.ok(matchesName("A531", "*531*"));
  assert.ok(!matchesName("PGM532", "*531*"));
});

test("no star means contains, not exactly", () => {
  // Typing 531 into a search box and being told nothing exists — because no member is CALLED 531 —
  // is how a search comes to feel broken.
  assert.ok(matchesName("PGM531A", "531"));
  assert.ok(matchesName("CUSTMAINT", "cust"));
});

test("empty and * are everything", () => {
  assert.ok(matchesName("ANY", ""));
  assert.ok(matchesName("ANY", "  "));
  assert.ok(matchesName("ANY", "*"));
});

test("case does not matter, on either side", () => {
  assert.ok(matchesName("custmaint", "CUST*"));
  assert.ok(matchesName("CUSTMAINT", "cust*"));
});

test("a name is not a regular expression", () => {
  // `$` and `#` and `.` are legal in IBM i names; a pattern carrying one must not be compiled as an
  // anchor or a wildcard.
  assert.ok(matchesName("PGM$A", "PGM$A"));
  assert.ok(matchesName("A.B", "A.B"));
  assert.ok(!matchesName("AXB", "A.B"));
});
