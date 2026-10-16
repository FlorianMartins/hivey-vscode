import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function setup(today) {
  const file = join(mkdtempSync(join(tmpdir(), "todo-hidden-")), "todo.json");
  const run = (...args) => {
    const env = { ...process.env, TODO_FILE: file };
    delete env.TODO_TODAY;
    if (today) env.TODO_TODAY = today;
    const r = spawnSync(process.execPath, ["todo.js", ...args], { encoding: "utf8", env });
    return { code: r.status, out: r.stdout, err: r.stderr };
  };
  const stored = () => (existsSync(file) ? readFileSync(file, "utf8") : null);
  return { file, run, stored };
}

test("ids stay stable after a removal", () => {
  const { run } = setup();
  run("add", "a");
  run("add", "b");
  run("add", "c");
  assert.equal(run("rm", "1").code, 0);
  assert.equal(run("list").out, "[ ] 2 b\n[ ] 3 c\n");
  assert.equal(run("done", "3").code, 0);
  assert.equal(run("list").out, "[ ] 2 b\n[x] 3 c\n");
  assert.equal(run("add", "d").out, "added 4\n");
  assert.equal(run("list").out, "[ ] 2 b\n[x] 3 c\n[ ] 4 d\n");
});

test("an unknown id is an error, not a crash, and changes nothing", () => {
  const { run, stored } = setup();
  run("add", "a");
  const before = stored();
  for (const args of [["done", "9"], ["rm", "9"], ["done", "abc"], ["done"]]) {
    const r = run(...args);
    assert.equal(r.code, 2, `${args.join(" ")} → exit ${r.code}: ${r.err}`);
    assert.ok(r.err.trim().length > 0, `${args.join(" ")} says nothing on stderr`);
    assert.doesNotMatch(r.err, /TypeError|at .*todo\.js/, "a stack trace is a crash, not an error message");
  }
  assert.equal(stored(), before);
});

test("--due is stored and shown", () => {
  const { run } = setup();
  assert.equal(run("add", "Pay", "rent", "--due", "2026-10-20").out, "added 1\n");
  assert.equal(run("add", "--due", "2026-11-01", "File", "taxes").out, "added 2\n");
  run("add", "No", "date");
  assert.equal(run("list").out, "[ ] 1 Pay rent (due 2026-10-20)\n[ ] 2 File taxes (due 2026-11-01)\n[ ] 3 No date\n");
});

test("an invalid due date is refused with exit code 2 and nothing is saved", () => {
  const { run, stored } = setup();
  run("add", "first");
  const before = stored();
  for (const due of ["2026-02-30", "2026-13-01", "tomorrow", "2026-1-5", "20261020", "2026-10-20T10:00"]) {
    const r = run("add", "x", "--due", due);
    assert.equal(r.code, 2, `--due ${due} → exit ${r.code}`);
  }
  assert.equal(run("add", "x", "--due").code, 2, "--due with no date");
  assert.equal(stored(), before);
  assert.equal(run("add", "leap", "--due", "2028-02-29").code, 0);
});

test("list --overdue shows the open items due before today", () => {
  const { run } = setup("2026-10-16");
  run("add", "late", "--due", "2026-10-15");
  run("add", "today", "--due", "2026-10-16");
  run("add", "late but done", "--due", "2026-10-10");
  run("done", "3");
  run("add", "no date");
  run("add", "very late", "--due", "2026-09-01");
  run("add", "next year", "--due", "2027-01-01");
  assert.equal(run("list", "--overdue").out, "[ ] 1 late (due 2026-10-15)\n[ ] 5 very late (due 2026-09-01)\n");
  assert.equal(run("list").out.split("\n").filter(Boolean).length, 6);
});

test("TODO_TODAY really is today", () => {
  const a = setup("2026-10-14");
  a.run("add", "x", "--due", "2026-10-15");
  assert.equal(a.run("list", "--overdue").out, "");
  const b = setup("2026-10-16");
  b.run("add", "x", "--due", "2026-10-15");
  assert.equal(b.run("list", "--overdue").out, "[ ] 1 x (due 2026-10-15)\n");
});

test("an existing todo file in the old format still works and keeps working", () => {
  const { file, run, stored } = setup();
  writeFileSync(
    file,
    JSON.stringify([
      { text: "old one", done: true },
      { text: "old two", done: false },
      { text: "old three", done: false },
    ]),
  );
  assert.equal(run("list").out, "[x] 1 old one\n[ ] 2 old two\n[ ] 3 old three\n");
  assert.equal(run("rm", "1").code, 0);
  assert.equal(run("list").out, "[ ] 2 old two\n[ ] 3 old three\n");
  assert.equal(run("done", "3").code, 0);
  assert.equal(run("add", "new", "--due", "2026-12-24").out, "added 4\n");
  assert.equal(run("list").out, "[ ] 2 old two\n[x] 3 old three\n[ ] 4 new (due 2026-12-24)\n");
  assert.notEqual(stored(), null);
});
