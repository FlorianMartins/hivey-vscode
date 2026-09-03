// Matching an object name against what somebody typed into a search box.

import { test } from "node:test";
import assert from "node:assert/strict";
import { cell, matchesName } from "../src/core/ibmi/sql.js";

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

test("a column is read whatever case the driver used", () => {
  // Reading `row["TABLE_NAME"]` when the driver said `table_name` returns undefined for every row,
  // and a list of blank rows looks exactly like a query that found nothing.
  assert.equal(cell({ TABLE_NAME: "QRPGLESRC" }, "TABLE_NAME"), "QRPGLESRC");
  assert.equal(cell({ table_name: "QRPGLESRC" }, "TABLE_NAME"), "QRPGLESRC");
  assert.equal(cell({ Table_Name: "QRPGLESRC" }, "table_name"), "QRPGLESRC");
});

test("several names are tried, and the value is trimmed", () => {
  // Db2 pads CHAR columns; a member called "CUST      " is not the member the next call asks for.
  assert.equal(cell({ OBJNAME: "CUSTMAINT   " }, "NAME", "OBJNAME"), "CUSTMAINT");
  assert.equal(cell({}, "MISSING"), "");
  assert.equal(cell({ X: null }, "X"), "");
});
