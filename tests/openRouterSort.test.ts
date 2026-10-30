// Which host OpenRouter sends a request to — see `OpenRouterSort` in core/providers/openai.ts.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { OpenAICompatibleProvider, type OpenRouterSort } from "../src/core/providers/openai.js";

/** A server that records each request body and answers one streamed "ok". */
async function recorder(): Promise<{ url: string; bodies: Array<Record<string, unknown>>; close: () => Promise<void> }> {
  const bodies: Array<Record<string, unknown>> = [];
  const server = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += String(c)));
    req.on("end", () => {
      bodies.push(JSON.parse(raw || "{}"));
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: "ok" }, finish_reason: "stop" }] })}\n\n`);
      res.end("data: [DONE]\n\n");
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as AddressInfo).port;
  return { url: `http://127.0.0.1:${port}/v1`, bodies, close: () => new Promise((r) => server.close(() => r())) };
}

test("OpenRouter is asked for the fastest host first, unless the setting says otherwise", async () => {
  // « DeepSeek V4.1 Flash a mis 45 min pour faire une tâche »: forty-odd hosts serve it, and
  // OpenRouter's default leans to the cheapest, often the slowest.
  const cases: Array<[OpenRouterSort | undefined, unknown]> = [
    [undefined, { sort: "throughput" }],
    ["latency", { sort: "latency" }],
    ["price", { sort: "price" }],
    ["default", undefined],
  ];
  for (const [sort, expected] of cases) {
    const s = await recorder();
    const p = new OpenAICompatibleProvider({ id: "openrouter", baseUrl: s.url, apiKey: "k", isLocal: false, ...(sort ? { openRouterSort: sort } : {}) });
    await p.chat({ model: "deepseek/deepseek-v4.1-flash", messages: [{ role: "user", content: "hi" }] });
    await s.close();
    assert.deepEqual(s.bodies[0]!["provider"], expected, String(sort));
  }
});

test("no other provider gets the routing field", async () => {
  const s = await recorder();
  await new OpenAICompatibleProvider({ id: "deepseek", baseUrl: s.url, apiKey: "k", isLocal: false }).chat({ model: "deepseek-flash", messages: [{ role: "user", content: "hi" }] });
  await s.close();
  assert.equal(s.bodies[0]!["provider"], undefined);
});
