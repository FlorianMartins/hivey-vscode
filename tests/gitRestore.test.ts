// Putting back what a command changed, which no checkpoint can hold.
//
// Florian: « il faudrait qu'il fasse un flash du ou des programmes avant la modification pour y
// revenir par la suite ». The snapshot he is asking for already exists and is not ours — a git
// working tree IS the file's previous state. What this decides is which files that applies to.

import { test } from "node:test";
import assert from "node:assert/strict";
import { planGitRestore } from "../src/core/session/gitRestore.js";

test("a file the turn dirtied can be put back", () => {
  const plan = planGitRestore([], ["src/a.ts"]);
  assert.deepEqual(plan.restorable, ["src/a.ts"]);
  assert.deepEqual(plan.keptBecauseYours, []);
});

test("⚠️ a file YOU had already changed is left alone", () => {
  // Discarding its working-tree changes would throw away the user's own work in order to undo ours,
  // which is a worse outcome than not undoing ours. There is no version of "put it back" that keeps
  // both, so the one that cannot be recovered wins.
  const plan = planGitRestore(["src/mine.ts"], ["src/mine.ts", "src/theirs.ts"]);
  assert.deepEqual(plan.restorable, ["src/theirs.ts"]);
  assert.deepEqual(plan.keptBecauseYours, ["src/mine.ts"]);
});

test("a file the checkpoint already holds is not restored twice", () => {
  // Two mechanisms racing to put one file back is how one of them wins by accident — and the
  // checkpoint's copy is the exact pre-edit content, where git's is only the last committed state.
  const plan = planGitRestore([], ["src/a.ts", "src/b.ts"], ["src/a.ts"]);
  assert.deepEqual(plan.restorable, ["src/b.ts"]);
});

test("a turn that changed nothing asks git for nothing", () => {
  assert.deepEqual(planGitRestore(["src/mine.ts"], []), { restorable: [], keptBecauseYours: [] });
});

test("the lists are stable, so the dialog reads the same twice", () => {
  const plan = planGitRestore([], ["z.ts", "a.ts", "m.ts"]);
  assert.deepEqual(plan.restorable, ["a.ts", "m.ts", "z.ts"]);
});

test("a path reported twice is one path", () => {
  // The Git extension reports working-tree and index changes separately, and a staged file edited
  // again appears in both.
  assert.deepEqual(planGitRestore([], ["a.ts", "a.ts"]).restorable, ["a.ts"]);
});
