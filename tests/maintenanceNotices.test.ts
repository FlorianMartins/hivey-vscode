// The turn's housekeeping, said once and out of the timeline — see `maintenance` in core/agent/loop.ts.
//
// « le résumé de la réflexion affiche "Le tour approchait de la fenêtre de contexte…" et pas le
// résumé de la réflexion » : near the window the notice came after every step's thinking.

import { test } from "node:test";
import assert from "node:assert/strict";
import { runTurn, type Tool } from "../src/core/agent/loop.js";
import type { ChatResult, Provider } from "../src/core/providers/types.js";

test("old outputs shortened before every step: said once, through the housekeeping channel, never in the timeline", async () => {
  const read: Tool = {
    schema: { name: "read_file", description: "d", parameters: { type: "object", properties: { path: { type: "string" } } } },
    approval: () => false,
    parallel: () => true,
    run: async (args) => ({ content: `${String(args["path"])}\n` + "ligne de code\n".repeat(3000) }),
  };
  let step = 0;
  const provider: Provider = {
    id: "local",
    baseUrl: "http://127.0.0.1:1/v1",
    isLocal: true,
    async chat(): Promise<ChatResult> {
      step++;
      const usage = { promptTokens: 100, completionTokens: 10, cachedTokens: 0 };
      if (step > 5) return { text: "Fait.", reasoning: "", toolCalls: [], usage, stopReason: "stop" };
      return { text: "Je lis le fichier suivant.", reasoning: "…", toolCalls: [{ id: String(step), name: "read_file", args: `{"path":"f${step}.ts"}` }], usage, stopReason: "tool_calls" };
    },
    async listModels() {
      return [];
    },
  };
  const reported: string[] = [];
  const maintained: string[] = [];
  const r = await runTurn({
    provider,
    model: "m",
    messages: [{ role: "user", content: "lis tout" }],
    tools: [read],
    contextWindow: 30_000,
    report: (m) => reported.push(m),
    maintenance: (m) => maintained.push(m),
  });
  assert.match(r.text, /Fait\.$/);
  const shortened = maintained.filter((m) => /older tool outputs were shortened/.test(m));
  assert.equal(shortened.length, 1, `said once, not at each of the ${step} steps`);
  assert.equal(reported.filter((m) => /older tool outputs were shortened|context window/.test(m)).length, 0, "not in the timeline");
});
