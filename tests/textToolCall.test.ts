// A tool call written in the message, and everything that must not be read as one.
//
// This exists because agent mode on a local model did nothing at all: Ollama returns
// `qwen2.5-coder:7b`'s tool call as text in `content` with `tool_calls: null`, so the client saw an
// ordinary answer and changed no files. Every agent task in the evaluation scored zero, and that zero
// was about to be published as the model's quality.
//
// The rules are narrow on purpose. Turning model prose into executed actions is the one change in
// this file that could do harm, so the tests for what is REFUSED outnumber the tests for what works.

import { test } from "node:test";
import assert from "node:assert/strict";
import { toolCallsFromText } from "../src/core/providers/textToolCall.js";

const OFFERED = ["read_file", "edit_file", "run_command"];

test("a message that is nothing but a fenced tool call is a tool call", () => {
  // Reduced from a real run: the model got the edit exactly right and the client threw it away.
  const text = '```json\n{"name":"edit_file","arguments":{"path":"count.js","old":"a","new":"b"}}\n```';
  const [call] = toolCallsFromText(text, OFFERED);
  assert.equal(call?.name, "edit_file");
  assert.deepEqual(JSON.parse(call!.args), { path: "count.js", old: "a", new: "b" });
});

test("an unfenced object, and the template's own wrapper, are both recognised", () => {
  assert.equal(toolCallsFromText('{"name":"read_file","arguments":{"path":"x"}}', OFFERED).length, 1);
  assert.equal(toolCallsFromText('<tool_call>{"name":"read_file","arguments":{"path":"x"}}</tool_call>', OFFERED).length, 1);
  // Several blocks in one message are several calls.
  const two = '<tool_call>{"name":"read_file","arguments":{"path":"a"}}</tool_call>\n<tool_call>{"name":"read_file","arguments":{"path":"b"}}</tool_call>';
  assert.equal(toolCallsFromText(two, OFFERED).length, 2);
});

test("`parameters` is accepted, because that is the word the schema uses", () => {
  const [call] = toolCallsFromText('{"name":"read_file","parameters":{"path":"x"}}', OFFERED);
  assert.deepEqual(JSON.parse(call!.args), { path: "x" });
});

test("narration before the call does not stop it being a call", () => {
  // The case that forced this rule to be loosened. These models narrate first — this is a real
  // message, and under a rule that demanded the call be the whole message, local agent mode did
  // nothing at all: the model explained itself and the client printed the explanation.
  const narrated = 'Before making any changes, I will check that count.js exists.\n\n```sh\n{"name":"read_file","arguments":{"path":"count.js"}}\n```';
  const [call] = toolCallsFromText(narrated, OFFERED);
  assert.equal(call?.name, "read_file");
  assert.equal(call?.source, "text", "a call read out of the text says so, because the user is told");
});

test("a call the model is talking ABOUT is not a call", () => {
  // The rule that is kept, and the reason the loosening above is bounded by "nothing may follow".
  // "Show me the JSON you would send" is a reasonable question, and answering it must not be a way to
  // make the model act.
  const explained = 'You could call it like this:\n\n```json\n{"name":"run_command","arguments":{"command":"rm -rf /"}}\n```\n\nThat would delete everything.';
  assert.deepEqual(toolCallsFromText(explained, OFFERED), []);
  const trailing = '{"name":"run_command","arguments":{"command":"ls"}}\n\nLet me know if you want me to run it.';
  assert.deepEqual(toolCallsFromText(trailing, OFFERED), []);
  const aroundBlocks = 'First:\n<tool_call>{"name":"read_file","arguments":{"path":"a"}}</tool_call>\nthen we will see.';
  assert.deepEqual(toolCallsFromText(aroundBlocks, OFFERED), []);
  // And a bare object inside prose, where there is no delimiter to tell a call from a quotation.
  const bare = 'Maybe {"name":"read_file","arguments":{"path":"x"}} would work?';
  assert.deepEqual(toolCallsFromText(bare, OFFERED), []);
});

test("a name nobody offered is not a call", () => {
  // A model inventing an API is a model inventing an API, not an instruction.
  assert.deepEqual(toolCallsFromText('{"name":"delete_repository","arguments":{}}', OFFERED), []);
  assert.deepEqual(toolCallsFromText('{"name":"read_file","arguments":{"path":"x"}}', []), []);
});

test("anything that is not one object of arguments stays text", () => {
  for (const text of [
    "",
    "   ",
    "Sure, I can do that.",
    "{not json}",
    '[{"name":"read_file","arguments":{"path":"x"}}]', // a bare array is not a shape anyone emits
    '{"arguments":{"path":"x"}}', // no name
    '{"name":"read_file","arguments":[1,2]}', // arguments that are not arguments
    '{"name":42,"arguments":{}}',
    '```json\n{"name":"read_file"}\n```\nand a second thought',
    "```{\"name\":\"read_file\"}```", // an inline span is not a block
  ]) {
    assert.deepEqual(toolCallsFromText(text, OFFERED), [], JSON.stringify(text));
  }
});

test("a call with no arguments at all is still a call", () => {
  // `get_diagnostics` takes none, and a model that omits the field has not made a mistake.
  const [call] = toolCallsFromText('{"name":"read_file"}', OFFERED);
  assert.equal(call?.args, "{}");
});
