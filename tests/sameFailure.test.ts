// The same failure again and again — see `failureSignature` and `SAME_FAILURE_LIMIT` in core/agent/loop.ts.

import { test } from "node:test";
import assert from "node:assert/strict";
import { failureSignature, runTurn, type Tool } from "../src/core/agent/loop.js";
import type { ChatRequest, ChatResult, Provider } from "../src/core/providers/types.js";

const usage = { promptTokens: 1, completionTokens: 1, cachedTokens: 0 };

function run(outputs: string[]) {
  let i = 0;
  const command: Tool = {
    schema: { name: "run_command", description: "d", parameters: { type: "object", properties: { command: { type: "string" } } } },
    approval: () => false,
    run: async () => ({ content: outputs[Math.min(i++, outputs.length - 1)]!, isError: true }),
  };
  const edit: Tool = {
    schema: { name: "edit_file", description: "d", parameters: { type: "object", properties: { path: { type: "string" } } } },
    approval: () => false,
    run: async () => ({ content: "Edited." }),
  };
  const seen: ChatRequest[] = [];
  let step = 0;
  const provider: Provider = {
    id: "local",
    baseUrl: "http://127.0.0.1:1/v1",
    isLocal: true,
    async chat(req): Promise<ChatResult> {
      seen.push(req);
      step++;
      // edit, test, edit, test, edit, test, then answer
      if (step > 6) return { text: "Je change d'approche.", reasoning: "", toolCalls: [], usage, stopReason: "stop" };
      const call = step % 2 ? { id: String(step), name: "edit_file", args: `{"path":"a${step}.ts"}` } : { id: String(step), name: "run_command", args: '{"command":"npm test"}' };
      return { text: "", reasoning: "", toolCalls: [call], usage, stopReason: "tool_calls" };
    },
    async listModels() {
      return [];
    },
  };
  return { command, edit, seen, provider };
}

const failing = (ms: number, line: number) => `exit code 1\n✖ the total is rounded to the cent (${ms}ms)\n  AssertionError: 19.99 !== 20\n    at test/total.test.js:${line}:5`;

test("the same failure three times, a different fix each time: the model is told to change approach — once", async () => {
  const { command, edit, seen, provider } = run([failing(12, 41), failing(9, 41), failing(15, 43)]);
  const r = await runTurn({ provider, model: "m", messages: [{ role: "user", content: "fix it" }], tools: [command, edit] });
  assert.equal(r.text, "Je change d'approche.");
  const notes = seen.flatMap((q) => q.messages).filter((m) => m.role === "user" && /same failure has now come back/.test(m.content));
  assert.ok(notes.length >= 1, "told");
  assert.equal(new Set(notes.map((m) => m.content)).size, 1, "once");
  assert.match(notes[0]!.content, /19\.99 !== 20/, "with the failure itself");
});

test("different failures: nothing said", async () => {
  const { command, edit, seen, provider } = run([failing(12, 41), "exit code 1\nTypeError: cannot read properties of undefined (reading 'total')", "exit code 2\nerror TS2322: Type 'string' is not assignable to type 'number'."]);
  await runTurn({ provider, model: "m", messages: [{ role: "user", content: "fix it" }], tools: [command, edit] });
  assert.equal(seen.flatMap((q) => q.messages).filter((m) => /same failure has now come back/.test(m.content)).length, 0);
});

test("what moves from one run to the next does not make it another failure", () => {
  assert.equal(failureSignature(failing(12, 41)), failureSignature(failing(907, 43)));
  assert.notEqual(failureSignature(failing(12, 41)), failureSignature("exit code 1\nTypeError: x is not a function at src/a.ts:3:1"));
  assert.equal(failureSignature("exit code 1\nfail"), undefined, "too little to tell");
});
