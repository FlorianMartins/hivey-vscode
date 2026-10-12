// Running RPG unit tests, and refusing to pretend.
//
// The expensive mistake this file exists to prevent is not a wrong count. It is a GREEN light: a
// parser that does not recognise the output reporting "0 tests, 0 failures" on a partition where
// the suite never ran, or where RPGUnit is not installed at all. Every test below is really about
// that one sentence never being said.
//
// ⚠️ The outputs are CONSTRUCTED. What is known first-hand is RUCALLTST's contract — it takes the
// test program and ends in error when a test fails — not the exact text it prints. So the design is
// built so that not knowing the text is safe, and these tests check that property rather than
// checking a layout.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  NOT_INSTALLED,
  formatTestRun,
  parseTestOutput,
  presenceSql,
  readPresence,
  testCommand,
} from "../src/core/ibmi/rpgunit.js";
import { cell } from "../src/core/ibmi/sql.js";
import { verifyTurn } from "../src/core/router/outcome.js";
import { BUILTIN_SKILLS } from "../src/core/session/skills.js";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// ── Is it there at all ───────────────────────────────────────────────────────────────────────────

test("presence is asked of the object catalogue, not of the command", () => {
  // Running RUCALLTST to see whether it exists raises CPF0006, and "the command does not exist" is
  // indistinguishable from "a test failed" to anything reading an exit status.
  const sql = presenceSql();
  assert.match(sql, /OBJECT_STATISTICS/);
  assert.match(sql, /'\*CMD'/);
  assert.match(sql, /RUCALLTST/);
});

test("RPGUnit is found, with the library it lives in", () => {
  const found = readPresence([{ OBJLIB: "RPGUNIT", OBJNAME: "RUCALLTST" }], cell);
  assert.deepEqual(found, { installed: true, library: "RPGUNIT" });
});

test("an empty catalogue answer means not installed, and the message refuses to say tests passed", () => {
  assert.deepEqual(readPresence([], cell), { installed: false });
  // Another command in the same library is not RPGUnit.
  assert.deepEqual(readPresence([{ OBJLIB: "RPGUNIT", OBJNAME: "RUCRTTST" }], cell), { installed: false });
  assert.match(NOT_INSTALLED, /not on this partition/);
  assert.match(NOT_INSTALLED, /not going to report that none failed/);
  assert.equal(/passed/.test(NOT_INSTALLED.replace("none failed", "")), false, "it must not contain a pass claim");
});

// ── The command ──────────────────────────────────────────────────────────────────────────────────

test("the command names the test program, qualified", () => {
  const out = testCommand({ library: "TSTCFC", program: "CUSTRPT_T" });
  assert.ok("command" in out);
  assert.equal(out.command, "RUCALLTST TSTPGM(TSTCFC/CUSTRPT_T)");
});

test("one test case, and the detail report, are asked for by name", () => {
  const one = testCommand({ library: "TSTCFC", program: "CUSTRPT_T", testCase: "testAddsVat", detail: true });
  assert.ok("command" in one);
  assert.match(one.command, /TSTPRC\(TESTADDSVAT\)/);
  assert.match(one.command, /RPTDTL\(\*ALL\)/);
});

test("a name that is not an IBM i name is refused here too", () => {
  for (const program of ["CUSTRPT_T) DLTLIB LIB(PROD", "A B", "TOOLONGNAMEXX", ""]) {
    const out = testCommand({ library: "TSTCFC", program });
    assert.ok("refused" in out, `accepted “${program}”`);
  }
  assert.ok("refused" in testCommand({ library: "TST CFC", program: "CUSTRPT_T" }));
  assert.ok("refused" in testCommand({ library: "TSTCFC", program: "CUSTRPT_T", testCase: "a)b" }));
});

// ── Reading the output ───────────────────────────────────────────────────────────────────────────

test("per-test lines are read in the shapes that clearly are results", () => {
  const { cases, unread } = parseTestOutput(
    [
      "testAddsVat . . . . . . : passed",
      "testRoundsHalfUp ... FAILED expected 1203 but was 1202",
      "ERROR: testReadsMaster",
    ].join("\n"),
  );
  assert.deepEqual(
    cases.map((c) => [c.name, c.status]),
    [
      ["testAddsVat", "passed"],
      ["testRoundsHalfUp", "failed"],
      ["testReadsMaster", "error"],
    ],
  );
  assert.equal(cases[1]?.message, "expected 1203 but was 1202");
  assert.equal(unread, 0);
});

test("the counts are read only from a line that really is a summary", () => {
  const summary = parseTestOutput("Tests: 7, Failures: 1, Errors: 0");
  assert.deepEqual(summary.reported, { tests: 7, failures: 1, errors: 0 });
  // A sentence that merely contains a number is not a summary.
  const prose = parseTestOutput("The suite found 3 errors in the customer master.");
  assert.equal(prose.reported, undefined, "a sentence was read as a summary");
});

test("output in a shape nobody recognises is counted as unread, never coerced into a pass", () => {
  // THE case. A parser that shrugs and returns an empty case list has, in effect, said "nothing
  // failed" — on output it did not understand.
  const { cases, reported, unread } = parseTestOutput(
    ["5770SS1 V7R5M0  RPGUNIT", "  *** some layout from a release nobody here has ***", "  <<<< ???? >>>>"].join("\n"),
  );
  assert.deepEqual(cases, []);
  assert.equal(reported, undefined, "no counts may be invented");
  assert.equal(unread, 3, "every line that was not understood must be counted as such");
});

test("the word alone is not a test name", () => {
  const { cases } = parseTestOutput("passed\nfailed\nFAILURE");
  assert.deepEqual(cases, [], `invented tests: ${JSON.stringify(cases)}`);
});

// ── The result the model reads ───────────────────────────────────────────────────────────────────

const run = {
  command: "RUCALLTST TSTPGM(TSTCFC/CUSTRPT_T)",
  output: "testRoundsHalfUp ... FAILED expected 1203 but was 1202",
};

test("a failing run says what failed and hands over what the partition printed", () => {
  const text = formatTestRun({
    ...run,
    ok: false,
    cases: [{ name: "testRoundsHalfUp", status: "failed", message: "expected 1203 but was 1202" }],
    reported: { tests: 7, failures: 1, errors: 0 },
    unread: 0,
  });
  assert.match(text, /FAILED/);
  assert.match(text, /7 test\(s\), 1 failure\(s\)/);
  assert.match(text, /FAILED testRoundsHalfUp — expected 1203 but was 1202/);
  assert.match(text, /What it printed:/);
});

test("a run whose output could not be read never reports that nothing failed", () => {
  const unreadable = formatTestRun({ ...run, ok: true, cases: [], unread: 12, output: "???" });
  assert.match(unreadable, /could not read any individual test/);
  assert.match(unreadable, /the command's verdict and not a count of mine/);
  assert.equal(/0 failure/.test(unreadable), false, "a count was invented");
  assert.match(unreadable, /12 line\(s\) of the output were not in a shape I recognise/);

  const failed = formatTestRun({ ...run, ok: false, cases: [], unread: 3, output: "boom" });
  assert.match(failed, /The run failed; read what it printed/);
  assert.match(failed, /What it printed:/);
});

test("the verdict is the command's, even when the counts disagree with it", () => {
  // RPGUnit said zero failures and the command ended in error. The command wins: a framework whose
  // summary we half-read is not a better authority than the partition's own status.
  const text = formatTestRun({
    ...run,
    ok: false,
    cases: [{ name: "testAddsVat", status: "passed" }],
    reported: { tests: 1, failures: 0, errors: 0 },
    unread: 0,
  });
  assert.match(text, /FAILED/);
  assert.equal(/all tests passed/.test(text), false);
  assert.match(text, /What it printed:/, "a disagreement must hand over the raw output");
});

// ── Where it sits in the turn ────────────────────────────────────────────────────────────────────

test("a failing test suite is a verdict on the turn, and a fixed one is not", () => {
  const step = (tool: string, ok: boolean, call: string, summary = ok ? "fine" : "boom") => ({ tool, ok, call, summary });
  const fixed = verifyTurn([
    step("ibmi_compile", true, "CRTBNDRPG TSTCFC/CUSTRPT"),
    step("ibmi_test", false, "RUCALLTST TSTPGM(TSTCFC/CUSTRPT_T)", "1 failure"),
    step("edit_file", true, "DEVCFC/QRPGLESRC(CUSTRPT)"),
    step("ibmi_compile", true, "CRTBNDRPG TSTCFC/CUSTRPT"),
    step("ibmi_test", true, "RUCALLTST TSTPGM(TSTCFC/CUSTRPT_T)"),
  ]);
  assert.equal(fixed.kind, "none", fixed.why);

  const broken = verifyTurn([
    step("edit_file", true, "DEVCFC/QRPGLESRC(CUSTRPT)"),
    step("ibmi_compile", true, "CRTBNDRPG TSTCFC/CUSTRPT"),
    step("ibmi_test", false, "RUCALLTST TSTPGM(TSTCFC/CUSTRPT_T)", "1 failure"),
  ]);
  assert.equal(broken.kind, "verification", "a program that compiles and fails its tests is not finished");
  assert.match(broken.why, /RUCALLTST/);
});

test("a compile that passes and a test that fails are two separate verdicts", () => {
  // `lastByTool` is keyed per tool, which is what makes this work: the compile's success must not
  // cover for the test's failure, and a later compile must not reopen a settled test result.
  const steps = [
    { tool: "ibmi_test", ok: false, call: "RUCALLTST TSTPGM(TSTCFC/CUSTRPT_T)", summary: "1 failure" },
    { tool: "ibmi_compile", ok: true, call: "CRTBNDRPG TSTCFC/CUSTRPT", summary: "fine" },
  ];
  const verdict = verifyTurn(steps);
  assert.equal(verdict.kind, "verification");
  assert.deepEqual(verdict.evidence.map((e) => e.tool), ["ibmi_test"]);
});

test("the test tool is wired, and refuses to be reassuring when RPGUnit is missing", () => {
  const source = readFileSync(join("src", "extension", "integrations", "ibmi.ts"), "utf8");
  assert.match(source, /name: "ibmi_test"/, "the tool is not declared");
  assert.match(source, /return \[[^\]]*\brunTests\b[^\]]*\]/, "the tool is declared but never returned");
  assert.match(source, /if \(!presence\.installed\) return \{ content: NOT_INSTALLED, isError: true \}/, "a missing RPGUnit is not refused");
  // And the catalogue being unreadable is its own case: "I could not ask" is not "not installed".
  assert.match(source, /could not ask the object catalogue/);

  const outcome = readFileSync(join("src", "core", "router", "outcome.ts"), "utf8");
  assert.match(outcome, /VERIFIERS = new Set\(\[[^\]]*"ibmi_test"/, "a test run is not counted as a verification");
});

test("the skill that writes the tests ends on running them", () => {
  // A model asked to "write tests" writes tests and declares victory. On this platform a test
  // source that was never compiled is not a test, it is a text file in QRPGLESRC.
  const rpgtest = BUILTIN_SKILLS.find((s) => s.name === "/rpgtest");
  assert.ok(rpgtest, "/rpgtest is not in the skill list");
  assert.equal(rpgtest.group, "rpg");
  assert.match(rpgtest.prompt ?? "", /ibmi_compile/, "the skill never compiles the tests it wrote");
  assert.match(rpgtest.prompt ?? "", /ibmi_test/, "the skill never runs them");
  assert.match(rpgtest.prompt ?? "", /do not claim the tests pass/i);

  // And /compile now uses the tool rather than telling the model to build a CRT… command by hand.
  const compile = BUILTIN_SKILLS.find((s) => s.name === "/compile");
  assert.ok(compile);
  assert.match(compile.prompt ?? "", /ibmi_compile/);
  assert.equal(/Run it with ibmi_command/.test(compile.prompt ?? ""), false, "it still invents the command");
});
