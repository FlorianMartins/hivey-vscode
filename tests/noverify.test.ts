// The family of tasks whose prompt does not ask for a check.
//
// It exists because chantier 4.4 could not be judged. The self-check — "you changed something and
// ran nothing, finish it" — fired **0 times out of 56**, and the reason was measured: 51 of the 56
// tasks changed something, and in all 51 a check ran. The precondition was never met, because every
// task in the bench ASKS for a verifiable outcome, so the model runs a check unprompted.
//
// The defining property of this family is therefore a property of its PROMPTS, and it is the one
// thing nobody would notice breaking: a single "make sure the tests pass" added to one of these
// while tidying up would silently take that task out of the family, and the measurement would drift
// without anybody being wrong about anything.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const DIR = "eval/tasks";

interface Task {
  title: string;
  kind: string;
  prompt: string;
  check: string;
}

function tasks(): Array<{ id: string; task: Task }> {
  return readdirSync(DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => ({ id: d.name, task: JSON.parse(readFileSync(join(DIR, d.name, "task.json"), "utf8")) as Task }));
}

/** Words that tell the model to check. Any of them turns the task into an ordinary one. */
const ASKS_TO_CHECK =
  /\btests?\b|\bverif|\bcheck\b|\bchecks\b|\brun\b|\bcompile|\bpass(es|ing)?\b|\blint|\bbuild\b|\bmake sure\b/i;

test("the family exists and is large enough to measure anything", () => {
  const family = tasks().filter((t) => t.task.kind === "noverify");
  assert.ok(family.length >= 6, `only ${family.length} task(s) in the family`);
});

test("no prompt in the family asks for a check", () => {
  // The whole point. One "and make sure the tests pass" takes a task out of the family, and nothing
  // else in the repository would notice.
  for (const { id, task } of tasks().filter((t) => t.task.kind === "noverify")) {
    const found = ASKS_TO_CHECK.exec(task.prompt);
    assert.equal(found, null, `${id}: the prompt says "${found?.[0]}" — it asks the model to verify`);
  }
});

test("every task in the family still has a check that decides", () => {
  // Not asking for verification is a property of the PROMPT. The task is still scored by a command,
  // and both honesty gates still apply to it — `eval:verify` and `eval:solutions` run in CI.
  for (const { id, task } of tasks().filter((t) => t.task.kind === "noverify")) {
    assert.ok(task.check.trim().length > 0, `${id} has no check`);
  }
});

test("each one traps an edit that looks finished", () => {
  // A task where the naive single-file edit is already correct would fire the self-check and show
  // nothing: the mechanism would run and change no outcome. So each fixture holds a second place the
  // change has to reach — a call site, a duplicated constant, an exhaustive switch, a closed list, a
  // positional insert — and the check is what finds it. Asserted as a shape rather than by running
  // the tasks: that is `eval:verify`'s job, on every commit.
  const family = tasks().filter((t) => t.task.kind === "noverify");
  for (const { id } of family) {
    const files = readdirSync(join(DIR, id, "files"));
    const code = files.filter((f) => !f.endsWith(".json"));
    assert.ok(code.length >= 2, `${id} has ${code.length} file(s): a one-file task cannot trap a partial edit`);
  }
});
