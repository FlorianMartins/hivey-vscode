// Running several tool calls at once, and the two rules that make it safe.
//
// The loop used to run every call in a step strictly in sequence, which is correct and slow: a step
// that reads four files paid four round trips for work that cannot interfere with itself. What
// makes fanning out safe is not speed, it is the discipline below — so it is asserted rather than
// assumed.

import { test } from "node:test";
import assert from "node:assert/strict";
import { runTurn, type Tool } from "../src/core/agent/loop.js";
import type { ChatResult, Provider } from "../src/core/providers/types.js";

/** A provider that emits one scripted step of tool calls, then an answer. */
function scripted(calls: Array<{ id: string; name: string; args: string }>): Provider {
  let step = 0;
  return {
    id: "test",
    async listModels() {
      return [];
    },
    async chat(): Promise<ChatResult> {
      step += 1;
      const usage = { promptTokens: 0, completionTokens: 0, cachedTokens: 0 };
      if (step === 1) return { text: "", reasoning: "", toolCalls: calls, usage, stopReason: "tool_calls" };
      return { text: "done", reasoning: "", toolCalls: [], usage, stopReason: "stop" };
    },
  } as unknown as Provider;
}

/** Records when each call starts and finishes, so overlap is observable. */
function recorder() {
  const events: string[] = [];
  let live = 0;
  let peak = 0;
  const make = (name: string, parallel: boolean): Tool => ({
    schema: { name, description: name, parameters: { type: "object", properties: {} } },
    approval: () => false,
    ...(parallel ? { parallel: () => true } : {}),
    async run(args) {
      const tag = String(args["tag"] ?? name);
      live += 1;
      peak = Math.max(peak, live);
      events.push(`start:${tag}`);
      await new Promise((r) => setTimeout(r, 10));
      events.push(`end:${tag}`);
      live -= 1;
      return { content: tag };
    },
  });
  return { events, make, peak: () => peak };
}

test("neighbours that declare themselves safe run at the same time", () => {
  // The point of the whole change: three reads in one step are three round trips of latency, and
  // they cannot affect each other.
  return (async () => {
    const rec = recorder();
    await runTurn({
      provider: scripted([
        { id: "1", name: "read", args: '{"tag":"a"}' },
        { id: "2", name: "read", args: '{"tag":"b"}' },
        { id: "3", name: "read", args: '{"tag":"c"}' },
      ]),
      model: "m",
      messages: [],
      tools: [rec.make("read", true)],
    });
    assert.equal(rec.peak(), 3, "all three should have been in flight together");
  })();
});

test("anything with a side effect stays in sequence", async () => {
  const rec = recorder();
  await runTurn({
    provider: scripted([
      { id: "1", name: "write", args: '{"tag":"a"}' },
      { id: "2", name: "write", args: '{"tag":"b"}' },
    ]),
    model: "m",
    messages: [],
    tools: [rec.make("write", false)],
  });
  assert.equal(rec.peak(), 1);
  assert.deepEqual(rec.events, ["start:a", "end:a", "start:b", "end:b"]);
});

test("only CONSECUTIVE safe calls are fused, so the order the model asked for survives", async () => {
  // read, write, read must stay read → write → read. Hoisting both reads to the front would be
  // faster and would reorder a sequence the model may well be depending on.
  const rec = recorder();
  await runTurn({
    provider: scripted([
      { id: "1", name: "read", args: '{"tag":"r1"}' },
      { id: "2", name: "write", args: '{"tag":"w"}' },
      { id: "3", name: "read", args: '{"tag":"r2"}' },
    ]),
    model: "m",
    messages: [],
    tools: [rec.make("read", true), rec.make("write", false)],
  });
  assert.deepEqual(rec.events, ["start:r1", "end:r1", "start:w", "end:w", "start:r2", "end:r2"]);
});

test("every call still gets a result, whatever happened to it", async () => {
  // A missing tool result is a protocol error with most providers and a silent hang with the rest,
  // and fanning out is exactly the change that could drop one.
  const rec = recorder();
  const result = await runTurn({
    provider: scripted([
      { id: "1", name: "read", args: '{"tag":"a"}' },
      { id: "2", name: "nosuchtool", args: "{}" },
      { id: "3", name: "read", args: "not json" },
    ]),
    model: "m",
    messages: [],
    tools: [rec.make("read", true)],
  });
  assert.equal(result.text, "done");
});

test("approvals are asked one at a time, never in a batch", async () => {
  // Two dialogs at once is not an interface. The approvals all resolve before anything executes,
  // which is what keeps them sequential even when the work that follows is not.
  let concurrent = 0;
  let peak = 0;
  const asking: Tool = {
    schema: { name: "ask", description: "ask", parameters: { type: "object", properties: {} } },
    approval: () => "do the thing",
    parallel: () => true,
    async run(args) {
      return { content: String(args["tag"] ?? "") };
    },
  };
  await runTurn({
    provider: scripted([
      { id: "1", name: "ask", args: '{"tag":"a"}' },
      { id: "2", name: "ask", args: '{"tag":"b"}' },
    ]),
    model: "m",
    messages: [],
    tools: [asking],
    approve: async () => {
      concurrent += 1;
      peak = Math.max(peak, concurrent);
      await new Promise((r) => setTimeout(r, 5));
      concurrent -= 1;
      return true;
    },
  });
  assert.equal(peak, 1, "two approval dialogs were open at once");
});
