// The user's language, held for the whole of an agent turn.
//
// « dans les réponses il continue de basculer entre les langues ».

import { test } from "node:test";
import assert from "node:assert/strict";
import { isWrongLanguage, withReplyLanguage } from "../src/core/prompts.js";
import { runTurn, type Tool } from "../src/core/agent/loop.js";
import type { ChatRequest, ChatResult, Provider } from "../src/core/providers/types.js";

test("the rule goes on the system prompt and the reminder on the newest tool output — on the copy sent", () => {
  const stored = [
    { role: "system", content: "You are Hivey Code." },
    { role: "user", content: "Retire le bandeau." },
    { role: "tool", content: "function surveillerVersion() {}" },
  ];
  const sent = withReplyLanguage(stored, "fr");
  assert.match(sent[0]!.content, /Language: the user writes in French/);
  assert.match(sent[2]!.content, /Reply language: French/);
  assert.equal(stored[0]!.content, "You are Hivey Code.", "the stored transcript is untouched");
  assert.equal(stored[2]!.content, "function surveillerVersion() {}");
  assert.equal(sent.length, 3, "no message is added");
});

test("only a passage long enough, and surely in the other language, is the wrong language", () => {
  assert.equal(isWrongLanguage("The live data mechanism is already working, it's just the banner for code changes that is in the way. I'll delete it.", "fr"), true);
  assert.equal(isWrongLanguage("Le mécanisme de données en direct fonctionne déjà, c'est seulement le bandeau qui gêne. Je le supprime.", "fr"), false);
  assert.equal(isWrongLanguage("OK, done.", "fr"), false, "too short to tell");
  assert.equal(isWrongLanguage("`relireBientot(Object.keys(RECHARGER_VUE))` `location.reload()` `surveillerVersion`", "fr"), false, "code is not prose");
});

test("a note in the wrong language is translated before it is kept — the model reads the same text next", async () => {
  const replies: ChatResult[] = [
    {
      text: "The live data mechanism is already working, it is just the banner for code changes that is in the way, so I will delete it.",
      reasoning: "",
      toolCalls: [{ id: "c1", name: "read_file", args: "{}" }],
      usage: { promptTokens: 1, completionTokens: 1, cachedTokens: 0 },
      stopReason: "tool_calls",
    },
    { text: "C'est fait.", reasoning: "", toolCalls: [], usage: { promptTokens: 1, completionTokens: 1, cachedTokens: 0 }, stopReason: "stop" },
  ];
  const seen: ChatRequest[] = [];
  const provider: Provider = {
    id: "fake",
    baseUrl: "http://127.0.0.1:11434/v1",
    isLocal: true,
    async chat(req) {
      seen.push({ ...req, messages: req.messages.map((m) => ({ ...m })) });
      return replies[seen.length - 1]!;
    },
    async listModels() {
      return [];
    },
  };
  const read: Tool = {
    schema: { name: "read_file", description: "", parameters: { type: "object", properties: {} } },
    approval: () => false,
    run: async () => ({ content: "file" }),
  } as Tool;
  const asked: string[] = [];
  const r = await runTurn({
    provider,
    model: "m",
    messages: [{ role: "system", content: "sys" }, { role: "user", content: "Retire le bandeau." }],
    tools: [read],
    replyLanguage: "fr",
    translate: async (text) => {
      asked.push(text);
      return "Le mécanisme de données en direct fonctionne déjà ; seul le bandeau gêne, je le supprime.";
    },
  });
  assert.equal(asked.length, 1, "only the English note is sent for translation, not the French answer");
  assert.match(r.text, /Le mécanisme de données en direct/);
  assert.doesNotMatch(r.text, /The live data mechanism/);
  const next = seen[1]!.messages.find((m) => m.role === "assistant" && m.toolCalls?.length)!;
  assert.match(next.content, /Le mécanisme de données/, "the model reads the translated note on the next step");
  assert.match(seen[0]!.messages[0]!.content, /Language: the user writes in French/);
});
