import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function cli(file) {
  return (...args) => {
    const r = spawnSync(process.execPath, ["todo.js", ...args], {
      encoding: "utf8",
      env: { ...process.env, TODO_FILE: file },
    });
    return { code: r.status, out: r.stdout, err: r.stderr };
  };
}

const fresh = () => cli(join(mkdtempSync(join(tmpdir(), "todo-")), "todo.json"));

test("add then list", () => {
  const todo = fresh();
  assert.equal(todo("add", "Buy", "milk").out, "added 1\n");
  todo("add", "Call", "Bob");
  assert.equal(todo("list").out, "[ ] 1 Buy milk\n[ ] 2 Call Bob\n");
});

test("done marks an item", () => {
  const todo = fresh();
  todo("add", "Buy milk");
  todo("add", "Call Bob");
  todo("done", "2");
  assert.equal(todo("list").out, "[ ] 1 Buy milk\n[x] 2 Call Bob\n");
});

test("an unknown command prints the usage", () => {
  const r = fresh()("frobnicate");
  assert.equal(r.code, 1);
  assert.match(r.err, /usage/);
});

test("ids survive a removal", () => {
  const todo = fresh();
  todo("add", "a");
  todo("add", "b");
  todo("add", "c");
  todo("rm", "1");
  todo("done", "3");
  assert.equal(todo("list").out, "[ ] 2 b\n[x] 3 c\n");
  assert.equal(todo("done", "1").code, 2);
});

test("--due is shown, and an impossible date is refused", () => {
  const todo = fresh();
  todo("add", "Pay rent", "--due", "2026-10-20");
  assert.equal(todo("list").out, "[ ] 1 Pay rent (due 2026-10-20)\n");
  assert.equal(todo("add", "x", "--due", "2026-02-30").code, 2);
});

test("list --overdue uses TODO_TODAY", () => {
  const file = join(mkdtempSync(join(tmpdir(), "todo-")), "todo.json");
  const run = (...args) =>
    spawnSync(process.execPath, ["todo.js", ...args], {
      encoding: "utf8",
      env: { ...process.env, TODO_FILE: file, TODO_TODAY: "2026-10-16" },
    }).stdout;
  run("add", "late", "--due", "2026-10-15");
  run("add", "not yet", "--due", "2026-10-16");
  assert.equal(run("list", "--overdue"), "[ ] 1 late (due 2026-10-15)\n");
});

test("an old array store is upgraded", () => {
  const file = join(mkdtempSync(join(tmpdir(), "todo-")), "todo.json");
  writeFileSync(file, JSON.stringify([{ text: "old", done: false }, { text: "older", done: true }]));
  const todo = cli(file);
  todo("rm", "1");
  assert.equal(todo("list").out, "[x] 2 older\n");
  assert.equal(Array.isArray(JSON.parse(readFileSync(file, "utf8"))), false);
});
