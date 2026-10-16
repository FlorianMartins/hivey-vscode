import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
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
