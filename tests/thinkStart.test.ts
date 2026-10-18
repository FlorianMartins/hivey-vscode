// The thinking started in the user's language — see `THINK_STARTERS` in core/userLanguage.ts.
//
// « il faudrait que le modèle réfléchisse avec la langue de l'utilisateur ». Measured on Qwen3.8 over
// 60 tasks in French, Spanish and German: started this way, 92-98 % of the thinking and 97-100 % of
// the notes were in the user's language, against 0-1 % and 54-86 % with the rule alone, and 57/60
// tasks passed against 55/60.

import { test } from "node:test";
import assert from "node:assert/strict";
import { THINK_STARTERS } from "../src/core/userLanguage.js";
import { withReplyLanguage } from "../src/core/prompts.js";
import { runTurn } from "../src/core/agent/loop.js";
import type { ChatRequest, ChatResult, Provider } from "../src/core/providers/types.js";

const usage = { promptTokens: 1, completionTokens: 1, cachedTokens: 0 };

function recorder(replies: ChatResult[]) {
  const seen: ChatRequest[] = [];
  const provider: Provider = {
    id: "local",
    baseUrl: "http://127.0.0.1:1/v1",
    isLocal: true,
    async chat(req, onDelta) {
      seen.push({ ...req, messages: req.messages.map((m) => ({ ...m })) });
      const r = replies[seen.length - 1]!;
      if (r.reasoning) onDelta?.({ reasoning: r.reasoning });
      return r;
    },
    async listModels() {
      return [];
    },
  };
  return { provider, seen };
}

test("the thought is started in the user's language, and the start is put back in front of it", async () => {
  const start = THINK_STARTERS.es!;
  const { provider, seen } = recorder([{ text: "Hecho.", reasoning: " el cálculo del descuento.", toolCalls: [], usage, stopReason: "stop" }]);
  const shown: string[] = [];
  const r = await runTurn({
    provider,
    model: "m",
    messages: [{ role: "system", content: "s" }, { role: "user", content: "corrige el cálculo" }],
    tools: [],
    replyLanguage: "es",
    thinkPrefix: start,
    onDelta: (d) => {
      if (d.reasoning) shown.push(d.reasoning);
    },
  });
  const sent = seen[0]!.messages;
  assert.deepEqual(sent[sent.length - 1], { role: "assistant", content: "", reasoning: start });
  assert.match(sent[0]!.content, /Piensa en español también\./, "the order to think in it, in it, where the thinking is started");
  assert.equal(shown[0], `${start} el cálculo del descuento.`);
  assert.equal(r.reasoning, `${start} el cálculo del descuento.`);
});

test("no start with thinking off, for a side task, or in English — and no order to think in it", async () => {
  for (const extra of [{ reasoning: "none" as const }, { chore: true }]) {
    const { provider, seen } = recorder([{ text: "ok", reasoning: "", toolCalls: [], usage, stopReason: "stop" }]);
    await runTurn({ provider, model: "m", messages: [{ role: "system", content: "s" }, { role: "user", content: "x" }], tools: [], replyLanguage: "fr", thinkPrefix: THINK_STARTERS.fr!, ...extra });
    const sent = seen[0]!.messages;
    assert.notEqual(sent[sent.length - 1]!.role, "assistant");
    assert.doesNotMatch(sent[0]!.content, /Réfléchis en français/);
  }
  assert.equal(THINK_STARTERS.en, undefined);
  assert.doesNotMatch(withReplyLanguage([{ role: "system", content: "s" }], "fr")[0]!.content, /Réfléchis/, "the rule alone does not ask for it");
});

test("each start is a sentence begun, not finished — a finished one closed the thinking on the spot", () => {
  for (const [lang, start] of Object.entries(THINK_STARTERS)) {
    assert.doesNotMatch(start!, /[.!?:]\s*$/, lang);
    assert.doesNotMatch(start!, /\s$/, `${lang}: no trailing space — the model's next token carries its own`);
  }
});
