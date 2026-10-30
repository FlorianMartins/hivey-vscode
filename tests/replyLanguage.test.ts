// The user's language, held for the whole of an agent turn.
//
// « dans les réponses il continue de basculer entre les langues ». And then « je ne veux pas de
// translator, je veux la réponse dans la langue de l'utilisateur »: the rule does the work, in the
// user's own words too; nothing is translated after the fact.

import { test } from "node:test";
import assert from "node:assert/strict";
import { languageDirective, withReplyLanguage } from "../src/core/prompts.js";
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

test("in French the rule is also said in French; in English the request is exactly what it was", () => {
  const msgs = [{ role: "system", content: "sys" }, { role: "user", content: "x" }, { role: "tool", content: "out" }];
  const fr = withReplyLanguage(msgs, "fr");
  assert.match(fr[0]!.content, /Réponds en français/);
  assert.match(fr[2]!.content, /Reply language: French\.[^\]]*Réponds en français[^\]]*\]$/);
  const en = withReplyLanguage(msgs, "en");
  assert.equal(
    en[0]!.content,
    "sys\nLanguage: the user writes in English. Every sentence you write for them is in English — short notes between tool calls included, even right after reading code, logs or your own reasoning in another language. Code, identifiers and file names stay as they are.\n",
  );
  assert.equal(en[2]!.content, "out\n\n[Reply language: English. Every sentence you write for the user — notes between tool calls included — is in English.]");
});

test("nothing is translated after the fact: a note is kept as the model wrote it, and no extra request is made", async () => {
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
  const r = await runTurn({
    provider,
    model: "m",
    messages: [{ role: "system", content: "sys" }, { role: "user", content: "Retire le bandeau." }],
    tools: [read],
    replyLanguage: "fr",
    firmLanguage: true,
  });
  assert.equal(seen.length, 2, "two steps, and no translation request between them");
  assert.match(r.text, /C'est fait\./);
  assert.match(seen[0]!.messages[0]!.content, /Language: the user writes in French[\s\S]*Réponds en français/);
});

test("a cloud model gets no firm rule and no reminder in its tool results — only one plain sentence", async () => {
  // « le modèle indique qu'il est forcé de répondre en français, ce qui fait conflit avec les modèles
  // de base ». The firm rule and the reminder after each tool result were written for Qwen3.8.
  const seen: ChatRequest[] = [];
  let n = 0;
  const provider: Provider = {
    id: "openrouter",
    baseUrl: "http://127.0.0.1:1/v1",
    isLocal: false,
    async chat(req) {
      seen.push({ ...req, messages: req.messages.map((m) => ({ ...m })) });
      n++;
      const usage = { promptTokens: 1, completionTokens: 1, cachedTokens: 0 };
      return n === 1
        ? { text: "", reasoning: "", toolCalls: [{ id: "c1", name: "read_file", args: "{}" }], usage, stopReason: "tool_calls" }
        : { text: "C'est fait.", reasoning: "", toolCalls: [], usage, stopReason: "stop" };
    },
    async listModels() {
      return [];
    },
  };
  const read = { schema: { name: "read_file", description: "", parameters: { type: "object", properties: {} } }, approval: () => false, run: async () => ({ content: "file" }) } as Tool;
  await runTurn({ provider, model: "m", messages: [{ role: "system", content: "sys" }, { role: "user", content: "Retire le bandeau." }], tools: [read], replyLanguage: "fr" });
  const sent = seen[1]!.messages.map((m) => m.content).join("\n");
  assert.doesNotMatch(sent, /Every sentence you write|Reply language:|Réponds en français/);
  assert.equal(languageDirective("fr", false), "The user writes in French: reply in French, unless they ask for another language.");
  assert.match(languageDirective("fr"), /Write every sentence of your reply in French/, "firm on the user's own server");
});

test("a sentence for the person before the tools, asked only when the caller says so (self-hosted)", () => {
  const sys = [{ role: "system", content: "s" }];
  assert.match(withReplyLanguage(sys, "fr", true)[0]!.content, /one short sentence in French/);
  assert.doesNotMatch(withReplyLanguage(sys, "fr")[0]!.content, /one short sentence/, "a cloud model: its own settings");
  assert.doesNotMatch(withReplyLanguage(sys, "fr", true)[0]!.content, /Réfléchis/, "its thinking in its own language");
});
