// Predicting the edit that follows the one just made.
//
// The governing rule, and the reason most of these tests are rejections: a suggestion the user has
// to read and dismiss costs them more attention than the feature saves. So anything that does not
// check out exactly against the file is discarded silently, and the tests that matter are the ones
// that prove it is discarded.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildNextEditPrompt,
  checkNextEdit,
  describeRecentWork,
  parseNextEdit,
  recentEdits,
  summarise,
  RECENT_MS,
} from "../src/core/completion/nextEdit.js";

const NOW = 1_700_000_000_000;

test("only what was done recently counts as what is being done now", () => {
  const events = [
    { path: "a.ts", at: NOW - RECENT_MS - 1000, before: "old", after: "older" },
    { path: "a.ts", at: NOW - 5_000, before: "one", after: "two" },
  ];
  const recent = recentEdits(events, NOW);
  assert.equal(recent.length, 1);
  assert.equal(recent[0]!.after, "two");
});

test("a hundred keystrokes describe one change, not a hundred", () => {
  // An edit journal records every change. Handing a model "t, to, tot, tota, total" describes
  // typing; what is worth telling it about is the intent.
  const events = [
    { path: "a.ts", at: NOW - 3000, before: "const x = 1;\n", after: "const t = 1;\n" },
    { path: "a.ts", at: NOW - 2000, before: "const t = 1;\n", after: "const to = 1;\n" },
    { path: "a.ts", at: NOW - 1000, before: "const to = 1;\n", after: "const total = 1;\n" },
  ];
  const work = describeRecentWork(events, NOW);
  assert.equal((work.match(/^--- a/gm) ?? []).length, 1, "one diff per file, not one per keystroke");
  assert.match(work, /^-const x = 1;$/m, "the diff should start from where the burst started");
  assert.match(work, /^\+const total = 1;$/m, "and end where it ended");
  assert.equal(work.includes("const to = 1"), false, "the intermediate states are not intent");
});

test("nothing recent means nothing to say", () => {
  assert.equal(describeRecentWork([], NOW), "");
  assert.equal(describeRecentWork([{ path: "a.ts", at: NOW - 60_000, before: "a", after: "b" }], NOW), "");
});

test("the prompt names the line the model must stay away from", () => {
  const prompt = buildNextEditPrompt({
    path: "src/app.ts",
    text: "const a = 1;\n",
    cursorLine: 11,
    recentWork: "--- a/src/app.ts",
    languageId: "typescript",
  });
  assert.match(prompt, /line 12/, "the prompt should be one-based where a human reads it");
  assert.match(prompt, /exactly once/);
  assert.match(prompt, /answer with the single word NONE/);
});

test("a well-formed answer is read", () => {
  const edit = parseNextEdit("FIND\nconst a = old();\nREPLACE\nconst a = renamed();\nEND");
  assert.deepEqual(edit, { find: "const a = old();", replace: "const a = renamed();" });
});

test("a fenced answer is read too, because models fence things", () => {
  const edit = parseNextEdit("```\nFIND\nfoo()\nREPLACE\nbar()\nEND\n```");
  assert.deepEqual(edit, { find: "foo()", replace: "bar()" });
});

test("NONE means the model looked and found nothing", () => {
  assert.equal(parseNextEdit("NONE"), undefined);
  assert.equal(parseNextEdit("NONE — everything else already uses the new name."), undefined);
});

test("prose that is not a proposal is not turned into one", () => {
  assert.equal(parseNextEdit("I think you should rename the other call sites too."), undefined);
  assert.equal(parseNextEdit(""), undefined);
  assert.equal(parseNextEdit("FIND\n\nREPLACE\nsomething\nEND"), undefined, "an empty FIND would match everywhere");
});

const file = ["function total(a, b) {", "  return a + b;", "}", "", "const x = total(1, 2);", "const y = other(3);"].join("\n");

test("a proposal that matches exactly once, away from the cursor, is accepted", () => {
  const check = checkNextEdit({ find: "const y = other(3);", replace: "const y = renamed(3);" }, file, 1);
  assert.equal(check.ok, true, check.why);
  assert.equal(file.slice(check.offset!, check.offset! + 6), "const ");
});

test("a snippet that is not in the file is refused", () => {
  // The most common failure of a small model: it reconstructs the line from memory, slightly wrong.
  const check = checkNextEdit({ find: "const y = other(4);", replace: "x" }, file, 0);
  assert.equal(check.ok, false);
  assert.equal(check.why, "not-found");
});

test("a snippet that appears twice is refused, because there is no way to know which", () => {
  const twice = "a();\nb();\na();\n";
  const check = checkNextEdit({ find: "a();", replace: "c();" }, twice, 10);
  assert.equal(check.ok, false);
  assert.equal(check.why, "ambiguous");
});

test("a proposal on the line being typed is refused", () => {
  // Completion owns that line. Two features suggesting different things in the same place is a
  // fight the user has to referee.
  const check = checkNextEdit({ find: "  return a + b;", replace: "  return a - b;" }, file, 1);
  assert.equal(check.ok, false);
  assert.equal(check.why, "at-cursor");
  // And the line either side of it, because a suggestion touching the line above where you are
  // typing moves the code under your cursor while you type.
  assert.equal(checkNextEdit({ find: "  return a + b;", replace: "  return a - b;" }, file, 2).why, "at-cursor");
});

test("a rewrite of the whole file is not a suggestion", () => {
  const big = { find: Array.from({ length: 20 }, (_, i) => `line ${i}`).join("\n"), replace: "one line" };
  assert.equal(checkNextEdit(big, big.find, 500).why, "too-large");
});

test("a proposal that changes nothing is refused", () => {
  assert.equal(checkNextEdit({ find: "a();", replace: "a();" }, "a();", 9).why, "unchanged");
});

test("the hint says what would happen, in one line", () => {
  assert.equal(summarise({ find: "const a = old();", replace: "const a = new();" }), "const a = old(); → const a = new();");
  assert.match(summarise({ find: "import { unused } from './x.js';", replace: "" }), /^remove import/);
});
