// The Index Advisor, and the discipline of not turning it into bad advice.
//
// This view is the easiest thing in the product to misuse: it is a list of indexes the optimizer
// wished for, and read as a to-do list it produces a table with fourteen indexes where every insert
// pays for all fourteen. So the tests below are mostly about what the report refuses to say.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ADVICE_LIMITS,
  formatAdvice,
  indexAdviceSql,
  readAdvice,
  readStats,
  tableStatsSql,
} from "../src/core/ibmi/db2advice.js";
import { cell, isReadOnlySql } from "../src/core/ibmi/sql.js";
import { refuseChange } from "../src/core/ibmi/guard.js";
import { toolsForMode } from "../src/core/session/modes.js";
import { BUILTIN_SKILLS } from "../src/core/session/skills.js";
import type { Tool } from "../src/core/agent/loop.js";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// ── The queries ──────────────────────────────────────────────────────────────────────────────────

test("the advice is ordered by how often the optimizer asked, not by what it costs to build", () => {
  // The question is "which of these is real", and an index asked for four thousand times is real
  // whatever it costs to create.
  const sql = indexAdviceSql("DEVCFC", "CUSTMAST");
  assert.match(sql, /QSYS2\.SYSIXADV/);
  assert.match(sql, /TABLE_SCHEMA = 'DEVCFC'/);
  assert.match(sql, /TABLE_NAME = 'CUSTMAST'/);
  assert.match(sql, /ORDER BY TIMES_ADVISED DESC/);
  assert.match(sql, /FETCH FIRST 25 ROWS ONLY/);
});

test("a whole schema can be asked about, and the table clause simply goes away", () => {
  const sql = indexAdviceSql("DEVCFC", undefined, 5);
  assert.equal(/TABLE_NAME/.test(sql), false);
  assert.match(sql, /FETCH FIRST 5 ROWS ONLY/);
});

test("a name with a quote in it cannot end the literal", () => {
  const sql = indexAdviceSql("DEV'CFC", "A'B");
  assert.match(sql, /'DEV''CFC'/);
  assert.match(sql, /'A''B'/);
  assert.equal(/'DEV'CFC'/.test(sql), false);
});

test("the statistics are asked for the same table", () => {
  assert.match(tableStatsSql("devcfc", "custmast"), /QSYS2\.SYSTABLESTAT.*'DEVCFC'.*'CUSTMAST'/s);
});

// ── Reading the rows ─────────────────────────────────────────────────────────────────────────────

test("the advice is read, including the signal that matters most", () => {
  const rows = [
    {
      TABLE_SCHEMA: "DEVCFC",
      TABLE_NAME: "CUSTMAST",
      KEY_COLUMNS_ADVISED: "CUSTNO, BRANCH",
      LEADING_COLUMN_KEYS: 1,
      TIMES_ADVISED: 4812,
      LAST_ADVISED: "2026-09-30",
      MTI_USED: 12,
      REASON_ADVISED: "Ordering",
    },
  ];
  const advice = readAdvice(rows, cell);
  assert.equal(advice.length, 1);
  assert.equal(advice[0]?.keys, "CUSTNO, BRANCH");
  assert.equal(advice[0]?.times, 4812);
  assert.equal(advice[0]?.leading, 1);
  // A temporary index the system actually built and used is the strongest evidence in the file.
  assert.equal(advice[0]?.temporaryUsed, true);
});

test("“YES” and a count both mean a temporary index was used", () => {
  const yes = readAdvice([{ KEY_COLUMNS_ADVISED: "A", MTI_USED: "YES" }], cell);
  const none = readAdvice([{ KEY_COLUMNS_ADVISED: "A", MTI_USED: "NO" }], cell);
  const zero = readAdvice([{ KEY_COLUMNS_ADVISED: "A", MTI_USED: 0 }], cell);
  assert.equal(yes[0]?.temporaryUsed, true);
  assert.equal(none[0]?.temporaryUsed, false);
  assert.equal(zero[0]?.temporaryUsed, false);
});

test("a row with no advised key is not advice", () => {
  assert.deepEqual(readAdvice([{ TABLE_NAME: "CUSTMAST", TIMES_ADVISED: 9 }], cell), []);
});

test("the statistics are read under several spellings, and an absent figure stays absent", () => {
  const full = readStats([{ TABLE_SCHEMA: "DEVCFC", TABLE_NAME: "CUSTMAST", NUMBER_ROWS: 2_100_000, DATA_SIZE: 1_048_576, NUMBER_INDEXES: 3 }], cell);
  assert.equal(full?.rows, 2_100_000);
  assert.equal(full?.indexes, 3);
  const thin = readStats([{ TABLE_SCHEMA: "DEVCFC", TABLE_NAME: "CUSTMAST" }], cell);
  assert.equal(thin?.rows, undefined, "a missing row count must not become 0");
  assert.equal(readStats([], cell), undefined);
});

// ── What the report refuses to say ───────────────────────────────────────────────────────────────

const advice = readAdvice(
  [{ TABLE_SCHEMA: "DEVCFC", TABLE_NAME: "CUSTMAST", KEY_COLUMNS_ADVISED: "CUSTNO, BRANCH", TIMES_ADVISED: 4812, MTI_USED: 4 }],
  cell,
);
const stats = readStats([{ TABLE_SCHEMA: "DEVCFC", TABLE_NAME: "CUSTMAST", NUMBER_ROWS: 2_100_000, NUMBER_INDEXES: 3 }], cell);

test("the size comes before the advice, because it is what makes the advice mean anything", () => {
  const text = formatAdvice({ schema: "DEVCFC", table: "CUSTMAST" }, advice, stats);
  const sizeAt = text.indexOf("2,100,000");
  const adviceAt = text.indexOf("CUSTNO, BRANCH");
  assert.ok(sizeAt > 0 && sizeAt < adviceAt, "the same advice over 400 rows and over 4 million is not the same proposal");
  assert.match(text, /3 index\(es\) already/);
});

test("no advice is never reported as “the indexes are right”", () => {
  const text = formatAdvice({ schema: "DEVCFC", table: "CUSTMAST" }, [], stats);
  assert.match(text, /has not asked for any index/);
  assert.match(text, /cleared by an IPL/);
  assert.equal(/indexes are right”?\./.test(text.replace(/“the indexes are\s+right”/s, "")), false);
});

test("every answer carries what the advisor does not mean", () => {
  const text = formatAdvice({ schema: "DEVCFC", table: "CUSTMAST" }, advice, stats);
  assert.match(text, /WISH LIST, not a design/);
  assert.match(text, /every insert, update and delete then pays for all of them/);
  assert.match(text, /advised once or twice is noise/);
  assert.match(text, /key ORDER is the index/);
  assert.equal(ADVICE_LIMITS.length, 5);
});

test("the answer says that creating the index is a change, and bounded like one", () => {
  const text = formatAdvice({ schema: "DEVCFC", table: "CUSTMAST" }, advice, stats);
  assert.match(text, /Creating an index is a CHANGE/);
  assert.match(text, /writableLibraries/);
  assert.match(text, /slows every write/);
});

test("missing statistics are said, not silently omitted", () => {
  const text = formatAdvice({ schema: "DEVCFC", table: "CUSTMAST" }, advice, undefined, ["SYSTABLESTAT did not answer"]);
  assert.match(text, /no statistics came back/i);
  assert.match(text, /What I could not read: SYSTABLESTAT did not answer/);
});

// ── And the gate, which the criterion is about ───────────────────────────────────────────────────

test("creating an index is a write, and the gate is consulted", () => {
  // The criterion of this chantier. Reading the advisor is free; acting on it is not.
  const create = "CREATE INDEX DEVCFC.CUSTMAST_IX1 ON DEVCFC.CUSTMAST (CUSTNO, BRANCH)";
  assert.equal(isReadOnlySql(create), false, "a CREATE INDEX that read as read-only would skip the gate entirely");
  const refused = refuseChange(create, true, { writable: ["TSTCFC"] });
  assert.equal(refused?.reason, "outside");
  // And it is allowed where the user allows it.
  assert.equal(refuseChange(create, true, { writable: ["DEVCFC"] }), undefined);
  // Reading the advisor is a SELECT and needs no permission at all.
  assert.equal(isReadOnlySql(indexAdviceSql("DEVCFC", "CUSTMAST")), true);
  assert.equal(isReadOnlySql(tableStatsSql("DEVCFC", "CUSTMAST")), true);
});

// ── Where it sits, and who uses it ───────────────────────────────────────────────────────────────

test("reading the advice is available in plan mode; creating the index is not", () => {
  const tools = ["ibmi_index_advice", "ibmi_sql", "ibmi_compile"].map(
    (name): Tool => ({
      schema: { name, description: name, parameters: { type: "object", properties: {} } },
      approval: () => false,
      run: async () => ({ content: "ok" }),
    }),
  );
  const planned = toolsForMode(tools, "plan").map((t) => t.schema.name);
  assert.ok(planned.includes("ibmi_index_advice"), "asking why a query is slow changes nothing");
  assert.equal(planned.includes("ibmi_sql"), false, "and the index it suggests goes through ibmi_sql");
});

test("the tool is wired, and the SQL skill will not propose an index without it", () => {
  const source = readFileSync(join("src", "extension", "integrations", "ibmi.ts"), "utf8");
  assert.match(source, /name: "ibmi_index_advice"/);
  assert.match(source, /return \[[^\]]*\bdb2Advice\b[^\]]*\]/, "declared but never returned");

  const sqlSkill = BUILTIN_SKILLS.find((s) => s.name === "/sql");
  assert.ok(sqlSkill);
  assert.match(sqlSkill.prompt ?? "", /ibmi_index_advice FIRST/);
  assert.match(sqlSkill.prompt ?? "", /Do not propose an index without it/);
});
