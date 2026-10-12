// An edit says what it broke (chantier 4.4).
//
// `edit_file` returned "Edited src/app.ts." and nothing else, so the only way for the model to learn
// whether the file still compiled was to CHOOSE to call `get_diagnostics`. The editor knew the whole
// time.

import { test } from "node:test";
import assert from "node:assert/strict";
import { editProblems, MAX_PROBLEMS } from "../src/core/agent/afterEdit.js";

test("errors are listed with their line, and the model is told to fix them", () => {
  const out = editProblems("src/app.ts", [
    { line: 12, message: "';' expected." },
    { line: 40, message: "Cannot find name 'foo'." },
  ]);
  assert.match(out, /reports 2 error\(s\) in src\/app\.ts/);
  assert.match(out, /src\/app\.ts:12 ';' expected\./);
  assert.match(out, /Fix these before you finish\./);
});

test("no errors appends nothing at all", () => {
  // Not "no problems found". A language server debounces, so an empty list milliseconds after an
  // edit means "it has not answered yet" as often as it means "it is fine" — and those are different
  // claims. Silence costs no tokens and asserts nothing.
  assert.equal(editProblems("src/app.ts", []), "");
});

test("it is bounded, and says how much it left out", () => {
  const many = Array.from({ length: 20 }, (_, i) => ({ line: i + 1, message: `problem ${i}` }));
  const out = editProblems("x.ts", many);
  assert.equal(out.split("\n").filter((l) => l.startsWith("  x.ts:")).length, MAX_PROBLEMS);
  assert.match(out, /…and 12 more\./);
  // The count is the real one, not the shown one: a model told "8 errors" would stop at eight.
  assert.match(out, /reports 20 error\(s\)/);
});

test("a message that is a paragraph is cut to a line", () => {
  const out = editProblems("x.ts", [{ line: 1, message: `a\n   b${"c".repeat(400)}` }]);
  const line = out.split("\n").find((l) => l.startsWith("  x.ts:1"))!;
  assert.ok(line.length < 200, "it rides on every edit of a broken file");
  assert.match(line, /…$/);
  assert.ok(!line.includes("\n"));
});

test("both writing tools report what the editor now says", () => {
  // Writing a whole file is at least as likely to break it as replacing a snippet, and the model has
  // even less reason to suspect it did.
  const { readFileSync } = require("node:fs") as typeof import("node:fs");
  const tools = readFileSync("src/extension/tools.ts", "utf8");
  assert.equal(tools.match(/await errorsAfterEdit\(uri\)/g)?.length, 2, "edit_file and write_file");
  // Errors only: a warning is a style opinion, and an edit that printed warnings would be noise on
  // every turn — which is how a signal becomes furniture.
  assert.match(tools, /d\.severity === vscode\.DiagnosticSeverity\.Error/);
  // And the wait is bounded and resolves early, because no wait reports the state from before the
  // edit and a long one makes every edit feel slow.
  assert.match(tools, /onDidChangeDiagnostics/);
  assert.match(tools, /setTimeout\(finish, 400\)/);
});
