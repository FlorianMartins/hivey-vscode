// What a step line says the agent did.

import { test } from "node:test";
import assert from "node:assert/strict";
import { callSignature } from "../src/core/agent/callSignature.js";

test("a command is the command, not the tool's own reply", () => {
  // `run_command` answers "The command was started in the user's terminal" every time, so six
  // commands in a row used to be six identical lines naming none of them.
  assert.equal(callSignature("run_command", { command: "npm test", why: "check it still passes" }), "npm test");
});

test("the argument that matters is the one shown", () => {
  assert.equal(callSignature("read_file", { path: "src/app.ts" }), "src/app.ts");
  assert.equal(callSignature("search_text", { pattern: "TODO", glob: "**/*.ts" }), "TODO");
  assert.equal(callSignature("ibmi_sql", { sql: "SELECT * FROM QSYS2.SYSSCHEMAS" }), "SELECT * FROM QSYS2.SYSSCHEMAS");
});

test("an unknown tool still says something", () => {
  // Every MCP tool a user plugs in arrives here unknown, and a blank line beside its name would be
  // the exact defect this exists to fix.
  const line = callSignature("some_mcp_tool", { flag: true, target: "the quarterly ledger" });
  assert.match(line, /quarterly ledger/);
});

test("a tool with nothing to say says nothing", () => {
  // Rather than "(no arguments)", which is a word about the interface rather than about the work.
  assert.equal(callSignature("ibmi_library_list", {}), "");
});

test("long arguments are cut, not wrapped", () => {
  const long = callSignature("run_command", { command: "x".repeat(400) });
  assert.ok(long.length <= 120, `${long.length} characters on one row`);
  assert.ok(long.endsWith("…"));
});

test("a multi-line argument becomes one line", () => {
  // A step row is one line high. A newline in it does not wrap, it breaks the row.
  const sql = callSignature("ibmi_sql", { sql: "SELECT *\n  FROM QSYS2.SYSSCHEMAS\n  WHERE X = 1" });
  assert.ok(!sql.includes("\n"), sql);
});
