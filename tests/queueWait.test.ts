// Waiting for one's turn on the user's own server is not a failure — see `post` in providers/openai.ts.
//
// « il n'avance pas et fait rien »: a sub-agent queued behind a long step on a one-slot server was
// abandoned by Node's HTTP client after five minutes without headers, reported as "sent nothing
// within Infinity s", and the agent started the whole work over.

import { test } from "node:test";
import assert from "node:assert/strict";
import { OpenAICompatibleProvider } from "../src/core/providers/openai.js";

const sse = (text: string): Response =>
  new Response(
    `data: ${JSON.stringify({ choices: [{ delta: { content: text }, finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`,
    { status: 200, headers: { "content-type": "text/event-stream" } },
  );

/** Node's own "no headers in five minutes", as its fetch throws it. */
function headersTimeout(): Error {
  const cause = Object.assign(new Error("Headers Timeout Error"), { code: "UND_ERR_HEADERS_TIMEOUT" });
  return Object.assign(new TypeError("fetch failed"), { cause });
}

async function withFetch<T>(impl: typeof fetch, body: () => Promise<T>): Promise<T> {
  const real = globalThis.fetch;
  globalThis.fetch = impl;
  try {
    return await body();
  } finally {
    globalThis.fetch = real;
  }
}

test("on the user's own server, a request given up for want of headers is sent again", async () => {
  let calls = 0;
  const provider = new OpenAICompatibleProvider({ id: "local", baseUrl: "http://127.0.0.1:1/v1", isLocal: true });
  const r = await withFetch(
    (async () => {
      calls++;
      if (calls <= 2) throw headersTimeout();
      return sse("enfin mon tour");
    }) as typeof fetch,
    () => provider.chat({ model: "m", messages: [{ role: "user", content: "x" }] }),
  );
  assert.equal(r.text, "enfin mon tour");
  assert.equal(calls, 3);
});

test("elsewhere, the same timeout is still a failure — and Stop is never retried", async () => {
  const remote = new OpenAICompatibleProvider({ id: "openrouter", baseUrl: "https://openrouter.ai/api/v1", isLocal: false, apiKey: "k" });
  await assert.rejects(
    withFetch((async () => {
      throw headersTimeout();
    }) as typeof fetch, () => remote.chat({ model: "m", messages: [{ role: "user", content: "x" }] })),
    /sent nothing within/,
  );

  const ctl = new AbortController();
  let calls = 0;
  const local = new OpenAICompatibleProvider({ id: "local", baseUrl: "http://127.0.0.1:1/v1", isLocal: true });
  await assert.rejects(
    withFetch((async () => {
      calls++;
      ctl.abort();
      throw Object.assign(new Error("aborted"), { name: "AbortError" });
    }) as typeof fetch, () => local.chat({ model: "m", messages: [{ role: "user", content: "x" }], signal: ctl.signal })),
  );
  assert.equal(calls, 1, "a request the person stopped is not sent again");
});
