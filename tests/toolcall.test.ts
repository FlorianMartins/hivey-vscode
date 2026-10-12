// Tool calls from a model that is not GPT-5.
//
// Every broken input below is a real shape a 7B coder model produces. The rule the whole file is
// built on: repair what has exactly ONE plausible reading, refuse everything else. A repair that
// guesses is worse than a refusal — a wrongly repaired `write_file` writes the wrong thing to disk
// and never reports an error.

import { test } from "node:test";
import assert from "node:assert/strict";
import { coerceArgs, parseToolArgs, unknownToolMessage, validateArgs } from "../src/core/agent/toolcall.js";
import type { ToolSchema } from "../src/core/providers/types.js";

const writeFile: ToolSchema = {
  name: "write_file",
  description: "",
  parameters: {
    type: "object",
    properties: { path: { type: "string" }, content: { type: "string" }, mode: { type: "number" } },
    required: ["path", "content"],
  },
};

test("valid JSON is passed through untouched, and never marked repaired", () => {
  const r = parseToolArgs('{"path":"a.ts","content":"x"}');
  assert.equal(r.ok, true);
  assert.deepEqual(r.args, { path: "a.ts", content: "x" });
  assert.equal(r.repaired, undefined, "a clean call must not go through any repair");
});

test("an empty argument string is an empty object, not a failure", () => {
  // Tools with no required arguments are called with "" by several providers.
  assert.deepEqual(parseToolArgs("").args, {});
  assert.deepEqual(parseToolArgs("{}").args, {});
});

test("a markdown fence around the object comes off", () => {
  const r = parseToolArgs('```json\n{"path": "a.ts", "content": "x"}\n```');
  assert.equal(r.ok, true);
  assert.equal(r.repaired, true);
  assert.deepEqual(r.args, { path: "a.ts", content: "x" });
});

test("prose on either side of the object is discarded", () => {
  const r = parseToolArgs('Here is the call: {"path": "a.ts", "content": "x"} — let me know.');
  assert.deepEqual(r.args, { path: "a.ts", content: "x" });
});

test("a trailing comma is dropped", () => {
  assert.deepEqual(parseToolArgs('{"path": "a.ts", "content": "x",}').args, { path: "a.ts", content: "x" });
});

test("Python's literals are translated", () => {
  // A model that has read far more Python than JSON.
  assert.deepEqual(parseToolArgs('{"path": "a.ts", "recursive": True, "limit": None}').args, {
    path: "a.ts",
    recursive: true,
    limit: null,
  });
});

test("real newlines inside a string are escaped rather than refused", () => {
  // THE important one. A model writing a multi-line file puts real newlines in `content`; the
  // object is otherwise perfect and the content is exactly what the user wants written. Refusing it
  // makes the model try again with a shorter file.
  const raw = '{"path": "a.ts", "content": "line one\nline two\n\tindented"}';
  const r = parseToolArgs(raw);
  assert.equal(r.ok, true, r.error);
  assert.equal(r.args!["content"], "line one\nline two\n\tindented", "the file's own shape must survive the repair");
});

test("an object encoded twice is unwrapped once", () => {
  const r = parseToolArgs(JSON.stringify(JSON.stringify({ path: "a.ts", content: "x" })));
  assert.deepEqual(r.args, { path: "a.ts", content: "x" });
});

test("what cannot be read is refused, and the refusal says how to send it", () => {
  const r = parseToolArgs("path = a.ts; content = hello");
  assert.equal(r.ok, false);
  assert.match(r.error!, /single JSON object/);
  assert.match(r.error!, /\\n for newlines/, "the message must say how to write a newline, since that is the usual cause");
});

test("a bare array is not silently treated as arguments", () => {
  // Guessing which element is which would be exactly the kind of repair this module refuses.
  assert.equal(parseToolArgs('["a.ts", "hello"]').ok, false);
});

test("a missing required field is named", () => {
  const problem = validateArgs(writeFile, { path: "a.ts" });
  assert.match(problem!, /"content" is missing/);
  assert.match(problem!, /must be a string/);
});

test("an empty string counts as missing, because it always is", () => {
  assert.match(validateArgs(writeFile, { path: "", content: "x" })!, /"path" is missing/);
});

test("a wrong type is named with both types", () => {
  const problem = validateArgs(writeFile, { path: ["a.ts"], content: "x" });
  assert.match(problem!, /"path" is a array; it must be a string/);
});

test("an extra field the schema never mentioned is allowed", () => {
  // Models add `reason` and `explanation` constantly. They cost nothing, and rejecting them turns
  // a working call into a failed one.
  assert.equal(validateArgs(writeFile, { path: "a.ts", content: "x", reason: "because" }), undefined);
});

test("a number written as a string is accepted and converted", () => {
  assert.equal(validateArgs(writeFile, { path: "a.ts", content: "x", mode: "420" }), undefined);
  assert.deepEqual(coerceArgs(writeFile, { path: "a.ts", content: "x", mode: "420" }), {
    path: "a.ts",
    content: "x",
    mode: 420,
  });
  // But something that is not a number at all is still wrong.
  assert.match(validateArgs(writeFile, { path: "a.ts", content: "x", mode: "soon" })!, /"mode" is a string/);
});

test("an unknown tool is answered with the nearest real one", () => {
  const tools = ["read_file", "write_file", "search_text", "get_diagnostics"];
  assert.match(unknownToolMessage("read_files", tools), /Did you mean "read_file"/);
  assert.match(unknownToolMessage("readFile", tools), /Did you mean "read_file"/);
  // And something genuinely unrelated gets the list rather than a misleading suggestion.
  const far = unknownToolMessage("send_email", tools);
  assert.equal(/Did you mean/.test(far), false, far);
  assert.match(far, /read_file, write_file/);
});
