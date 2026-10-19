// Reading what is needed rather than everything — see core/fs/outline.ts and `unchangedNotice`.

import { test } from "node:test";
import assert from "node:assert/strict";
import { OUTLINE_ABOVE_LINES, outlineOf, readWhole } from "../src/core/fs/outline.js";
import { unnumbered } from "../src/core/text/findText.js";
import { runTurn, sameEarlierResult, staleFileOutputs, type Tool } from "../src/core/agent/loop.js";
import type { ChatMessage, ChatRequest, ChatResult, Provider } from "../src/core/providers/types.js";

/** A source file of the usual shape: functions of a dozen lines, an export at the end. */
const body = (i: number): string[] => [
  `function bouton${i}(x) {`,
  `  const a = x + ${i};`,
  "  const b = a * 2;",
  "  if (b > 10) {",
  "    // a comment about the edge case",
  "    return b;",
  "  }",
  "  const c = [a, b].map((v) => v + 1);",
  "  return c.reduce((s, v) => s + v, 0);",
  "}",
  "",
];
const lines = ["'use strict';", "const { boutonFermer } = require('./ui');", ...Array.from({ length: 90 }, (_, i) => body(i)).flat(), "module.exports = { bouton1 };"];
const big = lines.join("\n");
/** 1-based line of a function's opening line. */
const lineOf = (i: number): number => 3 + i * body(0).length;

test("a large file asked for whole gets its plan, its head and how to read on", () => {
  assert.ok(lines.length > OUTLINE_ABOVE_LINES);
  const out = readWhole(big, "src/menu.js", undefined, undefined, 24_000);
  assert.ok(out.startsWith(`src/menu.js has ${lines.length} lines — too many to read whole usefully. Its plan`));
  assert.ok(out.includes(`\n${String(lineOf(0)).padStart(5)}  function bouton0(x) {\n`));
  assert.ok(out.includes(`\n${String(lines.length).padStart(5)}  module.exports = { bouton1 };`));
  assert.match(out, /Its first 100 lines:\n {5}1\t'use strict';/);
  assert.match(out, /read_file\(\{ path: "src\/menu\.js", from: <line>, to: <line> \}\)/);
  assert.ok(out.length < big.length / 2, `the plan (${out.length}) is much smaller than the file (${big.length})`);
});

test("a small file, or a range asked for, reads whole — each line with its number, as Claude Code's Read", () => {
  assert.equal(readWhole("a\nb\nc", "x.js", undefined, undefined, 24_000), "     1\ta\n     2\tb\n     3\tc");
  const part = readWhole(big, "src/menu.js", lineOf(1), lineOf(1) + 1, 24_000);
  const n = String(lineOf(1)).padStart(6);
  assert.ok(part.startsWith(`${n}\tfunction bouton1(x) {\n${String(lineOf(1) + 1).padStart(6)}\t  const a = x + 1;`), part.slice(0, 80));
  assert.deepEqual(outlineOf("const a = 1;\nconst f = (x) => x;\nclass A {}\n"), ["    2  const f = (x) => x;", "    3  class A {}"]);
});

test("another part of the same file is not an older copy of the first", () => {
  const call = (id: string, name: string, args: object): ChatMessage => ({ role: "assistant", content: "", toolCalls: [{ id, name, args: JSON.stringify(args) }] });
  const msgs = [call("1", "read_file", { path: "a.js", from: 1, to: 50 }), call("2", "read_file", { path: "a.js", from: 51, to: 99 }), call("3", "read_file", { path: "a.js", from: 1, to: 50 })];
  assert.deepEqual([...staleFileOutputs(msgs)], ["1"]);
  assert.deepEqual([...staleFileOutputs([...msgs, call("4", "edit_file", { path: "a.js" })])].sort(), ["1", "2", "3"]);
});

test("a repeated call with the same result points to the copy already there; a changed result is kept", async () => {
  const long = "line\n".repeat(200);
  let content = long;
  const read: Tool = {
    parallel: () => true,
    schema: { name: "read_file", description: "", parameters: { type: "object", properties: {} } },
    approval: () => false,
    run: async () => ({ content }),
  } as Tool;
  const script: ChatResult[] = [1, 2, 3].map((i) => ({
    text: "",
    reasoning: "",
    toolCalls: [{ id: `c${i}`, name: "read_file", args: '{"path":"src/ui.js"}' }],
    usage: { promptTokens: 1, completionTokens: 1, cachedTokens: 0 },
    stopReason: "tool_calls" as const,
  }));
  script.push({ text: "ok", reasoning: "", toolCalls: [], usage: { promptTokens: 1, completionTokens: 1, cachedTokens: 0 }, stopReason: "stop" });
  const seen: ChatRequest[] = [];
  const provider: Provider = {
    id: "local",
    baseUrl: "http://127.0.0.1:1/v1",
    isLocal: true,
    async chat(req) {
      seen.push({ ...req, messages: req.messages.map((m) => ({ ...m })) });
      return script[seen.length - 1]!;
    },
    async listModels() {
      return [];
    },
  };
  await runTurn({ provider, model: "m", messages: [{ role: "user", content: "x" }], tools: [read] });
  const tools = seen[2]!.messages.filter((m) => m.role === "tool").map((m) => m.content);
  assert.equal(tools[0], long, "the first copy is never touched: the server's cache of it stays whole");
  assert.match(tools[1]!, /^\[Unchanged: exactly the same result as your earlier read_file call/);
  // A different result for the same call is new information: kept whole. (A third identical call
  // is refused by the repeat guard before it runs, so this is checked on the rule itself.)
  const call = { id: "c9", name: "read_file", args: '{"path":"src/ui.js"}' };
  const before = seen[2]!.messages;
  assert.equal(sameEarlierResult(before, call, long), true);
  assert.equal(sameEarlierResult(before, call, long + "changed\n"), false);
  assert.equal(sameEarlierResult(before, { ...call, args: '{"path":"src/menu.js"}' }, long), false, "another file is another call");
  assert.equal(sameEarlierResult([], { id: "x", name: "read_file", args: "{}" }, "short"), false);
});

test("an edit that copied the line numbers is understood without them — on both sides", () => {
  const file = "const a = 1;\nconst b = 2;\n";
  const r = unnumbered(file, "     1\tconst a = 1;\n     2\tconst b = 2;", "     1\tconst a = 10;\n     2\tconst b = 2;");
  assert.deepEqual(r, { oldText: "const a = 1;\nconst b = 2;", newText: "const a = 10;\nconst b = 2;" });
  // `new` without numbers stays as written.
  assert.equal(unnumbered(file, "     1\tconst a = 1;", "const a = 10;").newText, "const a = 10;");
  // A snippet without numbers, or one that IS in the file as given, is left exactly as sent.
  assert.deepEqual(unnumbered(file, "const a = 1;", "x"), { oldText: "const a = 1;", newText: "x" });
  const tsv = "id\tname\n12\tbob\n";
  assert.deepEqual(unnumbered(tsv, "12\tbob", "12\talice"), { oldText: "12\tbob", newText: "12\talice" });
});
