// OpenRouter's `reasoning_details`, given back on the next step — see `mergeReasoningDetail` in
// core/providers/openai.ts.
//
// « Deepseek v4.1 via openrouter cloud semble se perdre trop souvent (il s'éparpille) » : through
// OpenRouter the model got nothing back of what it had thought at the step before, and started each
// step over from the tool results alone.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { OpenAICompatibleProvider, mergeReasoningDetail } from "../src/core/providers/openai.js";

const chunk = (delta: object, finish?: string) => `data: ${JSON.stringify({ choices: [{ delta, ...(finish ? { finish_reason: finish } : {}) }] })}\n\n`;

async function withServer(fn: (url: string, bodies: Array<Record<string, any>>) => Promise<void>): Promise<void> {
  const bodies: Array<Record<string, any>> = [];
  const server = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      bodies.push(JSON.parse(raw));
      res.writeHead(200, { "content-type": "text/event-stream" });
      const detail = (text: string, extra: object = {}) => ({ reasoning_details: [{ type: "reasoning.text", text, index: 0, format: "unknown", ...extra }], reasoning: text });
      res.write(chunk(detail("The search found ")));
      res.write(chunk(detail("two call sites.", { signature: "sig-1" })));
      res.write(chunk({ tool_calls: [{ index: 0, id: "c1", function: { name: "read_file", arguments: '{"path":"a.ts"}' } }] }, "tool_calls"));
      res.end("data: [DONE]\n\n");
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  try {
    await fn(`http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`, bodies);
  } finally {
    server.close();
  }
}

test("through OpenRouter, what the model thought is given back, whole and unchanged, at the next step", async () => {
  await withServer(async (url, bodies) => {
    const provider = new OpenAICompatibleProvider({ id: "openrouter", baseUrl: url, isLocal: false, apiKey: "k" });
    const first = await provider.chat({ model: "deepseek/deepseek-v4.1", messages: [{ role: "user", content: "fix it" }] });
    assert.deepEqual(first.thinkingBlocks, [{ type: "reasoning.text", text: "The search found two call sites.", index: 0, format: "unknown", signature: "sig-1" }]);
    assert.equal(first.reasoning, "The search found two call sites.");

    await provider.chat({
      model: "deepseek/deepseek-v4.1",
      messages: [
        { role: "user", content: "fix it" },
        { role: "assistant", content: "", toolCalls: first.toolCalls, reasoning: first.reasoning, thinkingBlocks: first.thinkingBlocks! },
        { role: "tool", toolCallId: "c1", content: "export const a = 1;" },
      ],
    });
    const sent = bodies[1]!.messages[1];
    assert.deepEqual(sent.reasoning_details, first.thinkingBlocks);
    assert.equal(sent.reasoning_content, undefined, "not the self-hosted field as well");
  });
});

test("another provider is sent exactly what it was before", async () => {
  await withServer(async (url, bodies) => {
    const provider = new OpenAICompatibleProvider({ id: "openai", baseUrl: url, isLocal: false, apiKey: "k" });
    await provider.chat({
      model: "gpt-5.4",
      messages: [
        { role: "user", content: "x" },
        { role: "assistant", content: "", toolCalls: [{ id: "c1", name: "read_file", args: "{}" }], thinkingBlocks: [{ type: "reasoning.text", text: "t" }] },
        { role: "tool", toolCallId: "c1", content: "y" },
      ],
    });
    assert.equal(bodies[0]!.messages[1].reasoning_details, undefined);
  });
});

test("streamed pieces are joined per detail; a new index or type starts the next one", () => {
  const into: Array<Record<string, unknown>> = [];
  mergeReasoningDetail(into, { type: "reasoning.text", text: "a", index: 0 });
  mergeReasoningDetail(into, { type: "reasoning.text", text: "b", index: 0, signature: null });
  mergeReasoningDetail(into, { type: "reasoning.encrypted", data: "xx", index: 1 });
  mergeReasoningDetail(into, { type: "reasoning.encrypted", data: "yy", index: 1 });
  mergeReasoningDetail(into, null);
  assert.deepEqual(into, [
    { type: "reasoning.text", text: "ab", index: 0 },
    { type: "reasoning.encrypted", data: "xxyy", index: 1 },
  ]);
});
