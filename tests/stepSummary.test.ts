// What a folded turn says about itself.
//
// A finished agent turn is mostly a list of things that already worked — twelve rows of tool steps
// sitting above the answer the reader came for, permanently. Folding them is only an improvement if
// the header says enough to leave the fold shut, and "7 steps" does not: it says how long the list
// is, not whether it is worth opening.

import { test } from "node:test";
import assert from "node:assert/strict";
import { stepSummary } from "../src/webview/chat.js";

const step = (tool: string, ok = true) => ({ tool, ok });

test("the summary says what kind of work was done, not only how much", () => {
  const said = stepSummary([
    step("read_file"),
    step("read_file"),
    step("edit_file"),
    step("run_command"),
    step("run_command"),
  ]);
  assert.match(said, /5 steps/);
  assert.match(said, /1 edits/);
  assert.match(said, /2 commands/);
});

test("writes and edits are counted as one thing", () => {
  // ⚠️ `write_file` and `edit_file` are one thing to somebody deciding whether to open the list, and
  // "1 write, 2 edits" is a distinction they did not ask for.
  const said = stepSummary([step("write_file"), step("edit_file"), step("edit_file")]);
  assert.match(said, /3 edits/);
  assert.equal(/write/i.test(said), false);
});

test("a turn that only looked around says so", () => {
  // Reads are mentioned ONLY when nothing was changed or run: on a turn that edited something, "9
  // reads" is the least interesting true thing that could be said about it.
  assert.match(stepSummary([step("read_file"), step("search_text"), step("list_files")]), /3 reads/);
  assert.equal(/reads/.test(stepSummary([step("read_file"), step("edit_file")])), false);
});

test("the count is every step, including the ones with no category", () => {
  // `update_plan` and `note_aside` are steps that belong to none of the three groups, and a total
  // that silently skipped them would not match the list the fold opens onto.
  const said = stepSummary([step("update_plan"), step("note_aside"), step("read_file")]);
  assert.match(said, /3 steps/);
});
