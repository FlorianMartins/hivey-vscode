// Correcting course while the agent works — without stopping it.
//
// « si l'utilisateur s'aperçoit que l'IA ne prend pas le bon sens, prendre en considération sa
// requête pour rectifier le tir sans avoir à Stop et refaire une nouvelle requête ».

import { test } from "node:test";
import assert from "node:assert/strict";
import { runTurn, type Tool } from "../src/core/agent/loop.js";
import { steerMessage } from "../src/core/prompts.js";
import type { ChatRequest, ChatResult, Provider } from "../src/core/providers/types.js";

const usage = { promptTokens: 1, completionTokens: 1, cachedTokens: 0 };
const call = (id: string): ChatResult => ({ text: "", reasoning: "", toolCalls: [{ id, name: "read_file", args: `{"n":"${id}"}` }], usage, stopReason: "tool_calls" });
const answer = (text: string): ChatResult => ({ text, reasoning: "", toolCalls: [], usage, stopReason: "stop" });

function scripted(replies: ChatResult[], onAsk?: (n: number) => void): { provider: Provider; seen: ChatRequest[] } {
  const seen: ChatRequest[] = [];
  const provider: Provider = {
    id: "fake",
    baseUrl: "http://127.0.0.1:11434/v1",
    isLocal: true,
    async chat(req) {
      seen.push({ ...req, messages: req.messages.map((m) => ({ ...m })) });
      onAsk?.(seen.length);
      return replies[Math.min(seen.length - 1, replies.length - 1)]!;
    },
    async listModels() {
      return [];
    },
  };
  return { provider, seen };
}

const read: Tool = {
  schema: { name: "read_file", description: "", parameters: { type: "object", properties: {} } },
  approval: () => false,
  run: async () => ({ content: "file" }),
} as Tool;

test("a message typed during a step is read at the next one, after the tool results, and the turn goes on", async () => {
  const queue: string[] = [];
  // Typed while the first request is out: the model is busy choosing its first action.
  const { provider, seen } = scripted([call("a"), answer("Fait, en TypeScript.")], (n) => {
    if (n === 1) queue.push("Non, pas en JavaScript : en TypeScript.");
  });
  const r = await runTurn({
    provider,
    model: "m",
    messages: [{ role: "system", content: "sys" }, { role: "user", content: "Écris le module." }],
    tools: [read],
    steer: () => queue.splice(0),
  });
  assert.equal(r.stoppedBecause, "answer");
  assert.equal(seen.length, 2, "one turn, not a new one");
  const second = seen[1]!.messages;
  const last = second[second.length - 1]!;
  assert.equal(last.role, "user");
  assert.match(last.content, /while you were working/);
  assert.match(last.content, /pas en JavaScript : en TypeScript/);
  assert.equal(second[second.length - 2]!.role, "tool", "after the tool result it answers, never between a call and its result");
  assert.equal(queue.length, 0, "handed over once");
});

test("a correction typed while the model writes its final answer reopens the turn instead of being lost", async () => {
  const queue: string[] = [];
  const { provider, seen } = scripted([answer("Voici la version JavaScript."), answer("D'accord, voici la version TypeScript.")], (n) => {
    if (n === 1) queue.push("En TypeScript plutôt.");
  });
  const r = await runTurn({
    provider,
    model: "m",
    messages: [{ role: "system", content: "sys" }, { role: "user", content: "Écris le module." }],
    tools: [],
    steer: () => queue.splice(0),
  });
  assert.equal(seen.length, 2);
  const second = seen[1]!.messages;
  assert.equal(second[second.length - 2]!.role, "assistant", "the first answer stays in what the model reads");
  assert.match(second[second.length - 1]!.content, /En TypeScript plutôt/);
  assert.match(r.text, /version TypeScript/);
});

test("nothing typed, nothing changes: the requests are exactly those of a turn without steering", async () => {
  const a = scripted([call("a"), answer("ok")]);
  const b = scripted([call("a"), answer("ok")]);
  const base = { model: "m", messages: [{ role: "system" as const, content: "sys" }, { role: "user" as const, content: "q" }], tools: [read] };
  await runTurn({ ...base, provider: a.provider });
  await runTurn({ ...base, provider: b.provider, steer: () => [] });
  assert.deepEqual(
    b.seen.map((r) => r.messages),
    a.seen.map((r) => r.messages),
  );
});

test("several messages typed between two steps arrive together, in order", () => {
  const m = steerMessage(["d'abord ceci", "et aussi cela"]);
  assert.ok(m.indexOf("d'abord ceci") < m.indexOf("et aussi cela"));
});

test("an image attached to a message typed during the turn rides beside it, as on a question", async () => {
  const queue: Array<{ text: string; images: Array<{ mediaType: string; data: string }> }> = [];
  const { provider, seen } = scripted([call("a"), answer("ok")], (n) => {
    if (n === 1) queue.push({ text: "Make it look like this.", images: [{ mediaType: "image/png", data: "iVBORw0KGgo=" }] });
  });
  await runTurn({
    provider,
    model: "m",
    messages: [{ role: "system", content: "sys" }, { role: "user", content: "Style the page." }],
    tools: [read],
    steer: () => queue.splice(0),
  });
  const last = seen[1]!.messages[seen[1]!.messages.length - 1]!;
  assert.match(last.content, /Make it look like this\./);
  assert.equal(last.images?.length, 1);
  assert.equal(last.images?.[0]?.mediaType, "image/png");
});
