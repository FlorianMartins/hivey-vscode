// Not reading again what the conversation already holds — see `alreadyRead` in core/agent/loop.ts.
//
// « il ne devrait pas avoir à lire ce qu'il a déjà lu (sauf si c'est autre chose qu'il cherche) ».

import { test } from "node:test";
import assert from "node:assert/strict";
import { alreadyRead } from "../src/core/agent/loop.js";
import type { ChatMessage, ToolCall } from "../src/core/providers/types.js";

const call = (id: string, name: string, args: object): ToolCall => ({ id, name, args: JSON.stringify(args) });
const step = (c: ToolCall, out: string): ChatMessage[] => [
  { role: "assistant", content: "", toolCalls: [c] },
  { role: "tool", toolCallId: c.id, content: out },
];
const file = Array.from({ length: 300 }, (_, i) => `line ${i + 1}`).join("\n");

test("lines a whole read already holds, unchanged since, are not read again", () => {
  const msgs = step(call("1", "read_file", { path: "src/ui.js" }), file);
  assert.match(alreadyRead(msgs, call("2", "read_file", { path: "src/ui.js", from: 40, to: 80 }))!, /^\[Already in this conversation: your read_file of src\/ui\.js above holds these lines/);
  assert.ok(alreadyRead(msgs, call("3", "read_file", { path: "./src/ui.js" })), "the same file, written another way");
  // A search or a plan update in between changes nothing on disk.
  const more = [...msgs, ...step(call("4", "search_text", { pattern: "x" }), "src/ui.js:3: x"), ...step(call("5", "update_plan", {}), "ok")];
  assert.ok(alreadyRead(more, call("6", "read_file", { path: "src/ui.js", from: 10, to: 20 })));
});

test("a range inside a range read before is held; lines outside it are read", () => {
  const msgs = step(call("1", "read_file", { path: "a.js", from: 100, to: 200 }), "…\n\n[lines 100-200 of 900. Read on with read_file({ path: \"a.js\", from: 201 }).]");
  assert.ok(alreadyRead(msgs, call("2", "read_file", { path: "a.js", from: 120, to: 150 })));
  assert.equal(alreadyRead(msgs, call("3", "read_file", { path: "a.js", from: 190, to: 260 })), undefined, "another part: read it");
  assert.equal(alreadyRead(msgs, call("4", "read_file", { path: "a.js" })), undefined, "the whole file was never read");
});

test("changed since, or not what it was: read again", () => {
  const base = step(call("1", "read_file", { path: "a.js" }), file);
  const want = call("9", "read_file", { path: "a.js", from: 1, to: 10 });
  assert.equal(alreadyRead([...base, ...step(call("2", "edit_file", { path: "a.js" }), "Edited.")], want), undefined, "edited");
  assert.equal(alreadyRead([...base, ...step(call("2", "run_command", { command: "npx prettier -w ." }), "exit code 0")], want), undefined, "a command may have changed it");
  assert.equal(alreadyRead(step(call("1", "read_file", { path: "a.js" }), "line 1\n[… 40000 more characters of this output were removed to fit …]"), want), undefined, "shortened");
  assert.equal(alreadyRead(step(call("1", "read_file", { path: "a.js" }), "a.js has 920 lines — too many to read whole usefully. Its plan …"), want), undefined, "only its plan was read");
  assert.equal(alreadyRead(base, call("9", "read_file", { path: "b.js" })), undefined, "another file");
});
