// A reply that runs away — a thinking in a loop, or a reply that fills the whole context window.
// See `repeatingTail` and `RUNAWAY_NOTES` in core/agent/loop.ts.
//
// « Il a encore bloqué en plein milieu » : 29 000 tokens in one step, three minutes, until the
// server's window was full — then the same step asked again unchanged, or the turn ended with no answer.

import { test } from "node:test";
import assert from "node:assert/strict";
import { repeatingTail, runTurn } from "../src/core/agent/loop.js";
import type { ChatRequest, ChatResult, Provider } from "../src/core/providers/types.js";

const usage = (completionTokens = 10) => ({ promptTokens: 100, completionTokens, cachedTokens: 0 });
const base = { model: "m", messages: [{ role: "system" as const, content: "s" }, { role: "user" as const, content: "fais-le" }], tools: [] };

test("the same passage three times in a row is a loop; a long ordinary thought is not", () => {
  const para = "Je dois vérifier la fonction pageItems avec siblings = 0, puis relire la règle du contrat. ";
  assert.equal(repeatingTail("Début de la réflexion. " + para.repeat(3)), true);
  assert.equal(repeatingTail("Début de la réflexion. " + para.repeat(2)), false, "twice is how people think");
  const ordinary = Array.from({ length: 200 }, (_, i) => `Étape ${i} : je lis le fichier ${i % 7}.ts et je note ce qui change.`).join(" ");
  assert.equal(repeatingTail(ordinary), false);
  assert.equal(repeatingTail("ok ok ok ok ok ok ok ok ok ok ok ok ok ok ok ok ok ok ok ok ok ok ok ok ok ok ok ok ok ok ok ok ok ok ok ok ok ok ok ok ok ok ok ok ok ok"), false, "a short stutter is under the floor");
});

test("a thinking that loops is stopped early, and the model is told to decide — not left to fill the window", async () => {
  const seen: ChatRequest[] = [];
  let streamed = 0;
  const loop = "I should check pagination again with siblings set to zero, then read the contract once more before deciding. ";
  const provider: Provider = {
    id: "local",
    baseUrl: "http://127.0.0.1:1/v1",
    isLocal: true,
    async chat(req, onDelta): Promise<ChatResult> {
      seen.push(req);
      if (seen.length === 1) {
        // Streams the same paragraph until it is stopped.
        for (let i = 0; i < 500 && !req.signal?.aborted; i++) {
          streamed++;
          onDelta?.({ reasoning: loop });
          await new Promise((r) => setImmediate(r));
        }
        throw new Error("aborted");
      }
      return { text: "C'est fait.", reasoning: "", toolCalls: [], usage: usage(), stopReason: "stop" };
    },
    async listModels() {
      return [];
    },
  };
  const r = await runTurn({ ...base, provider });
  assert.ok(streamed < 60, `stopped after ${streamed} pieces, not left to run`);
  assert.equal(r.text, "C'est fait.");
  assert.match(String(seen[1]!.messages.at(-1)!.content), /repeating the same passage/);
});

test("a reply that fills the window by itself is not asked again unchanged: told, twice at most, then the turn says where it stands", async () => {
  const seen: ChatRequest[] = [];
  const provider: Provider = {
    id: "local",
    baseUrl: "http://127.0.0.1:1/v1",
    isLocal: true,
    async chat(req): Promise<ChatResult> {
      seen.push(req);
      // The conclusion request has no tools to offer: it answers.
      if (/kept filling the context window/.test(String(req.messages.at(-1)!.content))) {
        return { text: "Voici où j'en suis.", reasoning: "", toolCalls: [], usage: usage(), stopReason: "stop" };
      }
      return { text: "", reasoning: "…".repeat(1000), toolCalls: [], usage: { promptTokens: 40_605, completionTokens: 29_026, cachedTokens: 0 }, stopReason: "length" };
    },
    async listModels() {
      return [];
    },
  };
  const r = await runTurn({ ...base, provider, contextWindow: 69_632, concludeWhenCut: "always" });
  assert.match(String(seen[1]!.messages.at(-1)!.content), /thinking ran to 29026 tokens/);
  assert.equal(seen.length, 4, "the reply, two notes, then the conclusion");
  assert.equal(r.stoppedBecause, "repeating");
  assert.match(r.text, /Voici où j'en suis/);
});

test("a window filled by the CONVERSATION, the reply itself short, is not taken for a runaway", async () => {
  const seen: ChatRequest[] = [];
  const provider: Provider = {
    id: "local",
    baseUrl: "http://127.0.0.1:1/v1",
    isLocal: true,
    async chat(req): Promise<ChatResult> {
      seen.push(req);
      if (seen.length === 1) return { text: "", reasoning: "court", toolCalls: [], usage: { promptTokens: 67_000, completionTokens: 2_600, cachedTokens: 0 }, stopReason: "length" };
      return { text: "Fait.", reasoning: "", toolCalls: [], usage: usage(), stopReason: "stop" };
    },
    async listModels() {
      return [];
    },
  };
  const messages = [...base.messages, { role: "assistant" as const, content: "", toolCalls: [{ id: "1", name: "read_file", args: "{}" }] }, { role: "tool" as const, toolCallId: "1", content: "x".repeat(200_000) }];
  const r = await runTurn({ ...base, messages, provider, contextWindow: 69_632 });
  // What happens then is the existing handling of a full window (shorten, ask again) — unchanged.
  for (const req of seen) assert.doesNotMatch(String(req.messages.at(-1)!.content), /ran to|filled the whole context|kept filling/, "no note: not a runaway");
  assert.notEqual(r.stoppedBecause, "repeating");
});
