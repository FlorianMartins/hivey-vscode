// The turn summarized in the middle of the work when its context window is full — see `compactLive`
// in core/agent/loop.ts.
//
// « il faut faire du compactage en live pendant une réponse s'il atteint le context max, comme
// Claude Code le fait » : the turn used to stop; the summary made afterwards, then "Continue", is
// what finished the task.

import { test } from "node:test";
import assert from "node:assert/strict";
import { runTurn, stablePrefixLength, transcriptForSummary } from "../src/core/agent/loop.js";
import type { ChatMessage, ChatRequest, ChatResult, Provider } from "../src/core/providers/types.js";

const usage = { promptTokens: 100, completionTokens: 10, cachedTokens: 0 };

test("the server says it does not fit and nothing is left to shorten: summarized, and the turn goes on to its answer", async () => {
  const seen: ChatRequest[] = [];
  const provider: Provider = {
    id: "local",
    baseUrl: "http://127.0.0.1:1/v1",
    isLocal: true,
    async chat(req): Promise<ChatResult> {
      seen.push(req);
      if (seen.length === 1) throw new Error("HTTP 400: request (70114 tokens) exceeds the available context size (69632 tokens)");
      if (req.chore) return { text: "Demande : ajoute les succès à la recherche. Fait : routes lues. Reste : l'affichage.", reasoning: "", toolCalls: [], usage, stopReason: "stop" };
      return { text: "C'est fait.", reasoning: "", toolCalls: [], usage, stopReason: "stop" };
    },
    async listModels() {
      return [];
    },
  };
  const messages: ChatMessage[] = [
    { role: "system", content: "règles", cacheable: true },
    { role: "user", content: "Repository map: src/app.ts", cacheable: true },
    { role: "assistant", content: "Understood — I have the repository map." },
    { role: "user", content: "Ajoute les succès à la recherche, au format des quêtes." },
    { role: "assistant", content: "Je regarde.", reasoning: "…" },
    { role: "user", content: "x ".repeat(40_000) },
  ];
  const r = await runTurn({ provider, model: "m", messages, tools: [], contextWindow: 69_632 });
  assert.equal(r.text, "C'est fait.");
  assert.equal(seen[1]!.chore, true, "the summary, with no tools and no thinking");
  assert.equal(seen[1]!.reasoning, "none");
  assert.match(String(seen[1]!.messages[1]!.content), /Ajoute les succès à la recherche/, "it was given the work to summarize");
  const after = seen[2]!.messages;
  assert.deepEqual(after.slice(0, 3), messages.slice(0, 3), "the cached prefix as it was");
  assert.equal(after.length, 4, "the rest replaced by the summary");
  assert.match(String(after[3]!.content), /routes lues[\s\S]*Continue the task where you stopped\./);
});

test("the stable prefix: the system prompt, the map and its acknowledgement — nothing of the conversation", () => {
  const m: ChatMessage[] = [
    { role: "system", content: "s", cacheable: true },
    { role: "user", content: "map", cacheable: true },
    { role: "assistant", content: "Understood." },
    { role: "user", content: "question" },
  ];
  assert.equal(stablePrefixLength(m), 3);
  assert.equal(stablePrefixLength([{ role: "system", content: "s" }, { role: "user", content: "q" }]), 1, "no map: the system prompt alone");
});

test("what is summarized fits its budget, and keeps the beginning — the request — and the end — the work", () => {
  const m: ChatMessage[] = [{ role: "user", content: "LA DEMANDE" }];
  for (let i = 0; i < 400; i++) {
    m.push({ role: "assistant", content: "", toolCalls: [{ id: String(i), name: "read_file", args: `{"path":"f${i}.ts"}` }] });
    m.push({ role: "tool", toolCallId: String(i), content: "y".repeat(2000) });
  }
  const s = transcriptForSummary(m, 20_000);
  assert.ok(s.length <= 20_100);
  assert.match(s, /^USER: LA DEMANDE/);
  assert.match(s, /f399\.ts/, "the latest work is there");
});
