// Wire-format tests against a real HTTP server, because a mocked `fetch` proves only that the
// mock matches the code that calls it. A server that replays the exact frames Ollama, OpenRouter
// and Anthropic send catches the things that actually break: a tool call split across three
// chunks, usage arriving after the last token, an error frame in the middle of a stream.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { AddressInfo } from "node:net";
import { OpenAICompatibleProvider } from "../src/core/providers/openai.js";
import { AnthropicProvider } from "../src/core/providers/anthropic.js";
import { HttpError } from "../src/core/util/http.js";

type Handler = (req: IncomingMessage, res: ServerResponse, body: string) => void;

async function serve(handler: Handler): Promise<{ url: string; close: () => Promise<void>; requests: Array<{ path: string; headers: NodeJS.Dict<string | string[]>; body: any }> }> {
  const requests: Array<{ path: string; headers: NodeJS.Dict<string | string[]>; body: any }> = [];
  // Sockets are tracked so `close()` can drop connections belonging to a request the server was
  // never going to answer — otherwise a timeout test hangs the whole suite on teardown.
  const sockets = new Set<import("node:net").Socket>();
  const server: Server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      requests.push({ path: req.url ?? "", headers: req.headers, body: body ? safeParse(body) : undefined });
      handler(req, res, body);
    });
  });
  server.on("connection", (sock) => {
    sockets.add(sock);
    sock.on("close", () => sockets.delete(sock));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as AddressInfo).port;
  return {
    url: `http://127.0.0.1:${port}/v1`,
    requests,
    close: () =>
      new Promise<void>((r) => {
        for (const sock of sockets) sock.destroy();
        server.close(() => r());
      }),
  };
}

function safeParse(s: string) {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}

function sse(res: ServerResponse, frames: unknown[]) {
  res.writeHead(200, { "Content-Type": "text/event-stream" });
  for (const f of frames) res.write(`data: ${JSON.stringify(f)}\n\n`);
  res.write("data: [DONE]\n\n");
  res.end();
}

test("an OpenAI-compatible stream becomes text, and usage is captured", async () => {
  const s = await serve((_req, res) =>
    sse(res, [
      { choices: [{ delta: { content: "Hello" } }] },
      { choices: [{ delta: { content: " world" } }] },
      { choices: [{ delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 12, completion_tokens: 3, prompt_tokens_details: { cached_tokens: 8 } } },
    ]),
  );
  const p = new OpenAICompatibleProvider({ id: "local", baseUrl: s.url, isLocal: true });
  const chunks: string[] = [];
  const r = await p.chat({ model: "m", messages: [{ role: "user", content: "hi" }] }, (d) => d.text && chunks.push(d.text));
  await s.close();

  assert.equal(r.text, "Hello world");
  assert.deepEqual(chunks, ["Hello", " world"], "text is streamed, not delivered at the end");
  assert.equal(r.usage.promptTokens, 12);
  assert.equal(r.usage.cachedTokens, 8);
});

test("a tool call split across chunks is reassembled by index", async () => {
  const s = await serve((_req, res) =>
    sse(res, [
      { choices: [{ delta: { tool_calls: [{ index: 0, id: "call_1", function: { name: "read_", arguments: '{"pa' } }] } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, function: { name: "file", arguments: 'th":"a.ts"}' } }] } }] },
      { choices: [{ delta: {}, finish_reason: "tool_calls" }] },
    ]),
  );
  const p = new OpenAICompatibleProvider({ id: "local", baseUrl: s.url, isLocal: true });
  const r = await p.chat({ model: "m", messages: [{ role: "user", content: "read it" }] });
  await s.close();

  assert.equal(r.stopReason, "tool_calls");
  assert.equal(r.toolCalls.length, 1);
  assert.equal(r.toolCalls[0]!.name, "read_file");
  assert.deepEqual(JSON.parse(r.toolCalls[0]!.args), { path: "a.ts" });
});

test("reasoning tokens are separated from the answer", async () => {
  const s = await serve((_req, res) =>
    sse(res, [
      { choices: [{ delta: { reasoning_content: "let me think" } }] },
      { choices: [{ delta: { content: "42" } }] },
    ]),
  );
  const p = new OpenAICompatibleProvider({ id: "local", baseUrl: s.url, isLocal: true });
  const r = await p.chat({ model: "m", messages: [{ role: "user", content: "?" }] });
  await s.close();
  assert.equal(r.text, "42");
  assert.equal(r.reasoning, "let me think");
});

test("attribution headers go to OpenRouter and nowhere else", async () => {
  const local = await serve((_req, res) => sse(res, [{ choices: [{ delta: { content: "x" } }] }]));
  await new OpenAICompatibleProvider({ id: "local", baseUrl: local.url, isLocal: true, referer: "r", title: "t" }).chat({
    model: "m",
    messages: [{ role: "user", content: "hi" }],
  });
  assert.equal(local.requests[0]!.headers["http-referer"], undefined, "a local server must receive a simple request");
  await local.close();

  const or = await serve((_req, res) => sse(res, [{ choices: [{ delta: { content: "x" } }] }]));
  await new OpenAICompatibleProvider({ id: "openrouter", baseUrl: or.url, isLocal: false, apiKey: "k", referer: "r", title: "t" }).chat({
    model: "m",
    messages: [{ role: "user", content: "hi" }],
  });
  assert.equal(or.requests[0]!.headers["http-referer"], "r");
  assert.equal(or.requests[0]!.headers["authorization"], "Bearer k");
  assert.equal(or.requests[0]!.body.usage.include, true, "ask OpenRouter for the real cost");
  await or.close();
});

test("an Ollama server on an unusual port is recognised by probing it, not by its URL", async () => {
  // The whole point: this server is on a random port and still gets the fill-in-the-middle path.
  const s = await serve((req, res) => {
    if (req.url === "/api/version") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ version: "0.6.0" }));
      return;
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ response: "return a + b;" }));
  });
  const ollama = new OpenAICompatibleProvider({ id: "local", baseUrl: s.url, isLocal: true });
  const out = await ollama.complete!({ model: "m", prefix: "function add(a,b){", suffix: "}", maxTokens: 32, stop: [] });
  const second = await ollama.complete!({ model: "m", prefix: "x", suffix: "y", maxTokens: 8, stop: [] });
  await s.close();

  assert.equal(out, "return a + b;");
  assert.equal(second, "return a + b;");
  const generate = s.requests.filter((r) => r.path === "/api/generate");
  assert.equal(generate.length, 2);
  assert.equal(generate[0]!.body.suffix, "}", "the suffix travels as a field, not as a template");
  assert.equal(generate[0]!.body.keep_alive, "30m", "the weights stay resident between keystrokes");
  assert.equal(s.requests.filter((r) => r.path === "/api/version").length, 1, "probed once, then remembered");
});

test("a remote endpoint is never probed", async () => {
  const s = await serve((_req, res) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ choices: [{ text: "x" }] }));
  });
  const remote = new OpenAICompatibleProvider({ id: "openai-compatible", baseUrl: s.url, isLocal: false, apiKey: "k" });
  await remote.complete!({ model: "m", prefix: "a", suffix: "b", maxTokens: 8, stop: [] });
  await s.close();
  assert.equal(s.requests.filter((r) => r.path.startsWith("/api/")).length, 0, "no unsolicited request to a third party");
});

test("an HTTP error is explained, not thrown raw", async () => {
  const s = await serve((_req, res) => {
    res.writeHead(401, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: { message: "No auth credentials found" } }));
  });
  const p = new OpenAICompatibleProvider({ id: "openrouter", baseUrl: s.url, isLocal: false });
  await assert.rejects(() => p.chat({ model: "m", messages: [{ role: "user", content: "hi" }] }), /401.*No auth credentials.*API key/s);
  await s.close();
});

test("a server that is not there names the fix", async () => {
  // A port nothing listens on: the connection is refused rather than merely slow.
  const p = new OpenAICompatibleProvider({ id: "local", baseUrl: "http://127.0.0.1:45387/v1", isLocal: true });
  await assert.rejects(
    () => p.chat({ model: "m", messages: [{ role: "user", content: "hi" }] }),
    (e: HttpError) => /ollama serve|Cannot reach/i.test(e.message),
  );
});

test("a slow first byte is reported as a model load, not as `fetch failed`", async () => {
  const s = await serve(() => {
    /* never answers */
  });
  const p = new OpenAICompatibleProvider({ id: "local", baseUrl: s.url, isLocal: true, timeoutMs: 150 });
  await assert.rejects(
    () => p.chat({ model: "m", messages: [{ role: "user", content: "hi" }] }),
    /model loading|sent nothing within/i,
  );
  await s.close();
});

test("cancelling a request is not an error to report", async () => {
  const s = await serve(() => {});
  const p = new OpenAICompatibleProvider({ id: "local", baseUrl: s.url, isLocal: true });
  const ctl = new AbortController();
  const pending = p.chat({ model: "m", messages: [{ role: "user", content: "hi" }], signal: ctl.signal });
  ctl.abort();
  await assert.rejects(() => pending, /cancelled/);
  await s.close();
});

test("Anthropic: the stable prefix is marked for the prompt cache", async () => {
  const s = await serve((_req, res) => {
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    for (const f of [
      { type: "message_start", message: { usage: { input_tokens: 10, cache_read_input_tokens: 900 } } },
      { type: "content_block_start", index: 0, content_block: { type: "text" } },
      { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "ok" } },
      { type: "message_delta", usage: { output_tokens: 5 }, delta: { stop_reason: "end_turn" } },
    ]) {
      res.write(`data: ${JSON.stringify(f)}\n\n`);
    }
    res.end();
  });
  const p = new AnthropicProvider({ baseUrl: s.url, apiKey: "k" });
  const r = await p.chat({
    model: "claude-sonnet-4-5",
    messages: [
      { role: "system", content: "sys" },
      { role: "user", content: "map", cacheable: true },
      { role: "user", content: "question" },
    ],
  });
  await s.close();

  const sent = s.requests[0]!.body;
  assert.equal(sent.system[0].cache_control.type, "ephemeral");
  assert.equal(sent.messages[0].content[0].cache_control.type, "ephemeral");
  assert.equal(sent.messages[1].content[0].cache_control, undefined, "the volatile tail must not break the cache");
  assert.equal(r.text, "ok");
  assert.equal(r.usage.cachedTokens, 900);
  assert.equal(r.usage.completionTokens, 5);
});

test("reasoning effort is translated per provider, not passed through", async () => {
  // OpenRouter normalises it under `reasoning`; an OpenAI-shaped gateway takes `reasoning_effort`.
  const or = await serve((_req, res) => sse(res, [{ choices: [{ delta: { content: "x" } }] }]));
  await new OpenAICompatibleProvider({ id: "openrouter", baseUrl: or.url, isLocal: false, apiKey: "k" }).chat({
    model: "m",
    messages: [{ role: "user", content: "hi" }],
    reasoning: "high",
  });
  assert.deepEqual(or.requests[0]!.body.reasoning, { effort: "high" });
  assert.equal(or.requests[0]!.body.reasoning_effort, undefined);
  await or.close();

  const gateway = await serve((_req, res) => sse(res, [{ choices: [{ delta: { content: "x" } }] }]));
  await new OpenAICompatibleProvider({ id: "openai-compatible", baseUrl: gateway.url, isLocal: false, apiKey: "k" }).chat({
    model: "m",
    messages: [{ role: "user", content: "hi" }],
    reasoning: "low",
  });
  assert.equal(gateway.requests[0]!.body.reasoning_effort, "low");
  await gateway.close();
});

test("asking for no reasoning tells OpenRouter to exclude it, so a thinking model stops billing for it", async () => {
  const s = await serve((_req, res) => sse(res, [{ choices: [{ delta: { content: "x" } }] }]));
  await new OpenAICompatibleProvider({ id: "openrouter", baseUrl: s.url, isLocal: false, apiKey: "k" }).chat({
    model: "m",
    messages: [{ role: "user", content: "hi" }],
    reasoning: "none",
  });
  assert.deepEqual(s.requests[0]!.body.reasoning, { exclude: true });
  await s.close();
});

test("Anthropic: thinking is a token budget, and the answer must still fit after it", async () => {
  const s = await serve((_req, res) => {
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    res.write(`data: ${JSON.stringify({ type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "hmm" } })}\n\n`);
    res.write(`data: ${JSON.stringify({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "42" } })}\n\n`);
    res.end();
  });
  const r = await new AnthropicProvider({ baseUrl: s.url, apiKey: "k" }).chat({
    model: "claude-sonnet-4-5",
    messages: [{ role: "user", content: "?" }],
    reasoning: "medium",
    maxTokens: 1024,
    temperature: 0.7,
  });
  const body = s.requests[0]!.body;
  await s.close();

  assert.equal(body.thinking.type, "enabled");
  assert.ok(body.thinking.budget_tokens >= 4096);
  assert.ok(body.max_tokens > body.thinking.budget_tokens, "max_tokens must leave room for the answer");
  assert.equal(body.temperature, undefined, "extended thinking and a temperature cannot both be set");
  assert.equal(r.reasoning, "hmm", "the thinking is captured separately from the answer");
  assert.equal(r.text, "42");
});

test("Anthropic: a tool call assembled from partial JSON", async () => {
  const s = await serve((_req, res) => {
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    for (const f of [
      { type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "toolu_1", name: "write_file" } },
      { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: '{"path":' } },
      { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: '"a.ts"}' } },
      { type: "message_delta", delta: { stop_reason: "tool_use" }, usage: { output_tokens: 2 } },
    ]) {
      res.write(`data: ${JSON.stringify(f)}\n\n`);
    }
    res.end();
  });
  const p = new AnthropicProvider({ baseUrl: s.url, apiKey: "k" });
  const r = await p.chat({ model: "m", messages: [{ role: "user", content: "write it" }] });
  await s.close();
  assert.equal(r.stopReason, "tool_calls");
  assert.deepEqual(JSON.parse(r.toolCalls[0]!.args), { path: "a.ts" });
});

test("a parameter the server refuses by name is dropped, and the question asked again", async () => {
  // OpenAI's own API, on its reasoning models: `max_tokens` is refused and `max_completion_tokens`
  // is demanded, and a temperature other than the default is refused outright. Both arrive as an
  // HTTP 400 that ends the answer. Nothing here predicts which model does that — the server says
  // what it will not take, and the request goes again without it.
  let calls = 0;
  const s = await serve((_req, res, body) => {
    calls++;
    const sent = JSON.parse(body);
    if ("max_tokens" in sent) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          error: { message: "Unsupported parameter: 'max_tokens' is not supported with this model. Use 'max_completion_tokens' instead." },
        }),
      );
      return;
    }
    sse(res, [{ choices: [{ delta: { content: "ok" } }] }]);
  });
  const p = new OpenAICompatibleProvider({ id: "openai", baseUrl: s.url, apiKey: "k", isLocal: false });
  const r = await p.chat({ model: "gpt-5", messages: [{ role: "user", content: "hi" }], maxTokens: 400, temperature: 0.2 });
  await s.close();

  assert.equal(r.text, "ok", "the answer survives the correction");
  assert.equal(calls, 2, "corrected once, not once per token");
  const second = s.requests[1]!.body;
  assert.equal(second.max_completion_tokens, 400, "the budget is carried over, not lost");
  assert.equal("max_tokens" in second, false);
  assert.equal(second.temperature, 0.2, "a field the server did not complain about is left alone");
});

test("a refusal that names no parameter is reported, not retried", async () => {
  // Retrying a wrong model name or an empty message spends the user's time twice on the same
  // error, and on a paid endpoint it can spend their money twice too.
  let calls = 0;
  const s = await serve((_req, res) => {
    calls++;
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: { message: "The model `gpt-невідомо` does not exist" } }));
  });
  const p = new OpenAICompatibleProvider({ id: "openai", baseUrl: s.url, apiKey: "k", isLocal: false });
  await assert.rejects(
    () => p.chat({ model: "nope", messages: [{ role: "user", content: "hi" }], maxTokens: 400 }),
    /does not exist/,
    "the server's own words reach the user",
  );
  await s.close();
  assert.equal(calls, 1);
});

// The two dialects that follow disagree about everything here — the field name, the encoding, the
// nesting — so both are checked on the body that actually leaves. The ORDER is not cosmetic either:
// a model handed a picture before the question it is about describes the picture instead of
// answering it.

test("OpenAI: an image becomes a content array with a data URL", async () => {
  const s = await serve((_req, res) => sse(res, [{ choices: [{ delta: { content: "a cat" } }] }]));
  const p = new OpenAICompatibleProvider({ id: "openai", baseUrl: s.url, apiKey: "k", isLocal: false });
  await p.chat({
    model: "gpt-5",
    messages: [{ role: "user", content: "what is this?", images: [{ mediaType: "image/png", data: "QUJD" }] }],
  });
  await s.close();

  const sent = s.requests[0]!.body.messages[0];
  assert.ok(Array.isArray(sent.content), "a message with an image must use the array form");
  assert.equal(sent.content[0].type, "text");
  assert.equal(sent.content[0].text, "what is this?");
  assert.equal(sent.content[1].type, "image_url");
  assert.equal(sent.content[1].image_url.url, "data:image/png;base64,QUJD");
});

test("OpenAI: a message with no image keeps the plain string form", async () => {
  // Every server on the list accepts the array form, and several older gateways accept only the
  // string. Switching everything to arrays for the sake of one feature would break them all.
  const s = await serve((_req, res) => sse(res, [{ choices: [{ delta: { content: "ok" } }] }]));
  const p = new OpenAICompatibleProvider({ id: "local", baseUrl: s.url, isLocal: true });
  await p.chat({ model: "m", messages: [{ role: "user", content: "hello" }] });
  await s.close();
  assert.equal(s.requests[0]!.body.messages[0].content, "hello");
});

test("Anthropic: an image becomes a base64 source block, after the text", async () => {
  const s = await serve((_req, res) => {
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    res.write(`event: content_block_delta\ndata: ${JSON.stringify({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "a cat" } })}\n\n`);
    res.write(`event: message_stop\ndata: ${JSON.stringify({ type: "message_stop" })}\n\n`);
    res.end();
  });
  const p = new AnthropicProvider({ baseUrl: s.url, apiKey: "k" });
  await p.chat({
    model: "claude-sonnet-5",
    messages: [{ role: "user", content: "what is this?", images: [{ mediaType: "image/png", data: "QUJD" }] }],
  });
  await s.close();

  const blocks = s.requests[0]!.body.messages[0].content;
  assert.equal(blocks[0].type, "text");
  assert.equal(blocks[1].type, "image");
  assert.equal(blocks[1].source.type, "base64");
  assert.equal(blocks[1].source.media_type, "image/png");
  assert.equal(blocks[1].source.data, "QUJD");
});

// ── The prompt cache, which is where the bill is actually decided ────────────────────────────────
//
// Anthropic's cache is not automatic: it applies only to prefixes a request explicitly marks. The
// marker existed here from the beginning and only the NATIVE Anthropic client ever emitted it — so
// every Claude conversation routed through OpenRouter, which is the default paid route and what the
// Hivey presets use, paid the full input price for its system prompt, its repository map and its
// whole transcript on every single request.

test("OpenRouter: a cacheable message carries the marker Anthropic needs", async () => {
  const s = await serve((_req, res) => sse(res, [{ choices: [{ delta: { content: "ok" } }] }]));
  const p = new OpenAICompatibleProvider({ id: "openrouter", baseUrl: s.url, apiKey: "k", isLocal: false });
  await p.chat({
    model: "anthropic/claude-opus-5",
    messages: [
      { role: "system", content: "rules", cacheable: true },
      { role: "user", content: "hello" },
    ],
  });
  await s.close();

  const sent = s.requests[0]!.body.messages;
  assert.ok(Array.isArray(sent[0].content), "a marked message must use the content-array form");
  assert.deepEqual(sent[0].content[0].cache_control, { type: "ephemeral" });
  assert.equal(sent[1].content, "hello", "an unmarked message keeps the plain string form");
});

test("a gateway that is not OpenRouter is sent nothing it did not ask for", async () => {
  // `cache_control` is an Anthropic-and-OpenRouter extension. A strict gateway answers 400 to a
  // field it does not know, and turning every request into the array form to suit one provider
  // would break the others.
  const s = await serve((_req, res) => sse(res, [{ choices: [{ delta: { content: "ok" } }] }]));
  const p = new OpenAICompatibleProvider({ id: "openai-compatible", baseUrl: s.url, apiKey: "k", isLocal: false });
  await p.chat({ model: "m", messages: [{ role: "system", content: "rules", cacheable: true }] });
  await s.close();
  assert.equal(s.requests[0]!.body.messages[0].content, "rules");
});

test("never more than four breakpoints, whichever door the request goes through", async () => {
  // Anthropic rejects the whole request beyond four, and a repository with two skills loaded plus
  // the rolling breakpoint reaches five without anybody doing anything unusual. The LAST four win:
  // a breakpoint caches everything before it, so a later one subsumes an earlier one.
  const six = Array.from({ length: 6 }, (_, i) => ({ role: "user" as const, content: `m${i}`, cacheable: true }));

  const a = await serve((_req, res) => sse(res, [{ choices: [{ delta: { content: "ok" } }] }]));
  const openrouter = new OpenAICompatibleProvider({ id: "openrouter", baseUrl: a.url, apiKey: "k", isLocal: false });
  await openrouter.chat({ model: "anthropic/claude-opus-5", messages: six });
  await a.close();
  const marked = a.requests[0]!.body.messages.filter((m: any) => Array.isArray(m.content) && m.content[0].cache_control);
  assert.equal(marked.length, 4);
  assert.equal(marked[3].content[0].text, "m5", "the last message must keep its breakpoint");
  assert.equal(marked[0].content[0].text, "m2", "the earliest ones are the ones to drop");
});

test("Anthropic: the system blocks and the messages share the same budget of four", async () => {
  const s = await serve((_req, res) => {
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    res.write(`event: message_stop\ndata: ${JSON.stringify({ type: "message_stop" })}\n\n`);
    res.end();
  });
  const p = new AnthropicProvider({ baseUrl: s.url, apiKey: "k" });
  await p.chat({
    model: "claude-opus-5",
    messages: [
      { role: "system", content: "rules", cacheable: true },
      { role: "system", content: "skill one", cacheable: true },
      { role: "system", content: "skill two", cacheable: true },
      { role: "user", content: "map", cacheable: true },
      { role: "user", content: "question", cacheable: true },
    ],
  });
  await s.close();

  const body = s.requests[0]!.body;
  const systemMarks = body.system.filter((b: any) => b.cache_control).length;
  const messageMarks = body.messages.filter((m: any) => m.content.some((b: any) => b.cache_control)).length;
  assert.equal(systemMarks + messageMarks, 4, "five breakpoints is a request Anthropic refuses outright");
  assert.equal(messageMarks, 2, "the two latest — the map and the question — must be the ones kept");
});
