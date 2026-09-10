// Escalating on what happened rather than on what the question looked like.
//
// Every test here is a bill. A verdict of "failed" spends money on a remote model; a verdict of
// "fine" leaves a broken repository. The two mistakes are not symmetrical, which is why the
// interesting cases below are the ones where a naive reading of the trace gets it wrong.

import { test } from "node:test";
import assert from "node:assert/strict";
import { handoverNote, turnChangedSomething, verifyTurn, type TurnStep } from "../src/core/router/outcome.js";

const ok = (tool: string, call?: string, summary = "fine"): TurnStep => ({ tool, ok: true, summary, ...(call ? { call } : {}) });
const bad = (tool: string, call?: string, summary = "boom"): TurnStep => ({ tool, ok: false, summary, ...(call ? { call } : {}) });

test("a turn that fixed what it broke is not a failure", () => {
  // THE case. An agent that runs the tests, sees them fail, fixes them and runs them again has a
  // failing step in its trace and a working repository. Escalating on "any failing step" would pay
  // a remote model to redo work that is already done — on most successful agent turns, because
  // seeing a failure and fixing it is what the loop is FOR.
  const verdict = verifyTurn([
    ok("read_file", "src/totals.ts"),
    bad("run_command", "npm test", "exit code 1"),
    ok("edit_file", "src/totals.ts"),
    ok("run_command", "npm test", "exit code 0"),
  ]);
  assert.equal(verdict.kind, "none", verdict.why);
});

test("a turn that ended on a failing check is a failure", () => {
  const verdict = verifyTurn([
    ok("edit_file", "src/totals.ts"),
    ok("run_command", "npm test", "exit code 0"),
    bad("get_diagnostics", "src/totals.ts", "2 errors"),
  ]);
  assert.equal(verdict.kind, "verification");
  assert.match(verdict.why, /get_diagnostics|src\/totals\.ts/);
  assert.equal(verdict.evidence.length, 1);
});

test("each kind of check is judged on its own last word", () => {
  // Tests passing does not repair a type error, and a clean type-check does not make a failing
  // test pass. Taking only the last verification step of the whole turn would let whichever ran
  // last speak for both.
  const verdict = verifyTurn([
    bad("run_command", "npm test", "exit code 1"),
    ok("get_diagnostics", "src/app.ts", "no problems"),
  ]);
  assert.equal(verdict.kind, "verification");
  assert.equal(verdict.evidence[0]!.call, "npm test");
});

test("a read that failed is not evidence about the outcome", () => {
  // A model guessing a path, being told the file is not there, and looking it up properly is a
  // model working correctly. Only tools that pass judgement on the work count as verification.
  const verdict = verifyTurn([bad("read_file", "src/nope.ts", "no such file"), ok("read_file", "src/app.ts")]);
  assert.equal(verdict.kind, "none", verdict.why);
});

test("a turn that verified nothing is not accused of anything", () => {
  // Plenty of good answers run nothing: a question about the code, a refactor the user will check
  // themselves. Absence of proof is not proof of failure, and escalating on it would turn every
  // conversational turn into a paid one.
  assert.equal(verifyTurn([ok("read_file", "a.ts"), ok("search_text", "total")]).kind, "none");
  assert.equal(verifyTurn([]).kind, "none");
});

test("the same call failing over and over is its own kind of failure", () => {
  // Invisible to any check of the final state — nothing was verified, so nothing failed — and the
  // clearest signal there is that a small model is out of its depth.
  const verdict = verifyTurn([
    bad("edit_file", "src/app.ts", "that snippet does not appear"),
    bad("edit_file", "src/app.ts", "that snippet does not appear"),
    bad("edit_file", "src/app.ts", "that snippet does not appear"),
  ]);
  assert.equal(verdict.kind, "stuck");
  assert.match(verdict.why, /3 times/);
});

test("three failures spread across different calls are not being stuck", () => {
  const verdict = verifyTurn([
    bad("edit_file", "src/a.ts"),
    bad("edit_file", "src/b.ts"),
    bad("edit_file", "src/c.ts"),
  ]);
  assert.equal(verdict.kind, "none", verdict.why);
});

test("whether anything was actually changed is a separate question", () => {
  assert.equal(turnChangedSomething([ok("read_file", "a.ts")]), false);
  assert.equal(turnChangedSomething([bad("edit_file", "a.ts")]), false, "a refused edit changed nothing");
  assert.equal(turnChangedSomething([ok("edit_file", "a.ts")]), true);
});

test("the hand-over note carries the failure, the diff, and the warning that the change is on disk", () => {
  // The failure mode this guards against: a remote model that starts over, writes the original
  // file again and reports success, because nobody told it the first attempt is still on disk.
  const note = handoverNote({
    verdict: verifyTurn([bad("run_command", "npm test", "exit code 1")]),
    detail: "Expected 6, received 5",
    diffs: ["--- a/src/totals.ts\n+++ b/src/totals.ts\n@@ -1,1 +1,1 @@\n-a + b\n+a + b + 1"],
  });
  assert.match(note, /npm test/);
  assert.match(note, /Expected 6/);
  assert.match(note, /\+a \+ b \+ 1/);
  assert.match(note, /still on disk/);
  assert.match(note, /rather than start over/);
});
