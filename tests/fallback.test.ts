// What happens when the model that was supposed to answer will not.
//
// The two mistakes are opposite and both expensive. Falling back too eagerly sends a wrong request
// twice and bills for both; not falling back at all makes the free preset a demonstration rather
// than something anybody works with, because a free endpoint is free precisely because it is
// rate-limited.

import { test } from "node:test";
import assert from "node:assert/strict";
import { describeFallback, fallbackChain, isRetryable } from "../src/core/router/fallback.js";
import type { RouterConfig } from "../src/core/router/route.js";

const cfg = (model: string): RouterConfig => ({
  chat: { provider: "openrouter", model },
  completion: { provider: "local", model: "qwen2.5-coder:7b" },
  escalation: "ask",
  localContextTokens: 32000,
});

test("a rate limit is worth trying elsewhere", () => {
  assert.equal(isRetryable(Object.assign(new Error("too many requests"), { status: 429 })), true);
  assert.equal(isRetryable(Object.assign(new Error("bad gateway"), { status: 502 })), true);
  assert.equal(isRetryable(Object.assign(new Error("upstream timeout"), { status: 504 })), true);
});

test("a wrong request is not", () => {
  // Sending a malformed body somewhere else sends a malformed body twice, and on a paid provider
  // it bills for both. A bad key is not fixed by a retry either.
  assert.equal(isRetryable(Object.assign(new Error("no such model"), { status: 400 })), false);
  assert.equal(isRetryable(Object.assign(new Error("unauthorised"), { status: 401 })), false);
  assert.equal(isRetryable(Object.assign(new Error("forbidden"), { status: 403 })), false);
  assert.equal(isRetryable(Object.assign(new Error("not found"), { status: 404 })), false);
});

test("a dead socket is recognised by what it says, since it carries no status", () => {
  assert.equal(isRetryable(new Error("connect ECONNREFUSED 127.0.0.1:11434")), true);
  assert.equal(isRetryable(new Error("fetch failed")), true);
  assert.equal(isRetryable(new Error("api.example.com sent nothing within 180s")), true);
  assert.equal(isRetryable(new Error("The user declined this action.")), false);
  assert.equal(isRetryable(undefined), false);
  assert.equal(isRetryable(new Error("")), false);
});

test("a preset falls back along its own roles, downwards, then to the machine", () => {
  const chain = fallbackChain(cfg("hivey/free"), { provider: "openrouter", model: "deep-model", why: "" }, {
    kind: "agent",
    localModel: "qwen2.5-coder:7b",
  });
  assert.ok(chain.length >= 2, JSON.stringify(chain));
  assert.equal(chain[chain.length - 1]!.provider, "local", "the machine is always the last resort");
  assert.equal(chain[chain.length - 1]!.model, "qwen2.5-coder:7b");
});

test("a fallback never lands on the model that just failed", () => {
  const from = { provider: "openrouter" as const, model: "chore-model", why: "" };
  const chain = fallbackChain(cfg("hivey/free"), from, { kind: "aux", localModel: "qwen2.5-coder:7b" });
  assert.equal(chain.some((r) => r.model === "chore-model"), false, JSON.stringify(chain));
});

test("no local model and no preset means no chain, and the error reaches the user", () => {
  // Inventing a destination the user never chose would be worse than failing: they would be billed
  // by a provider they did not pick, or answered by a model they did not ask for.
  const chain = fallbackChain(cfg("anthropic/claude-sonnet-5"), { provider: "anthropic", model: "claude-sonnet-5", why: "" }, {
    kind: "chat",
  });
  assert.deepEqual(chain, []);
});

test("every hop says where the answer came from", () => {
  // A silent fallback is the worst version of this: the answer arrives from a smaller model, reads
  // slightly worse, and nobody knows why.
  const line = describeFallback(
    { provider: "openrouter", model: "big", why: "" },
    { provider: "local", model: "qwen", why: "this machine, because the network did not answer" },
  );
  assert.match(line, /big did not answer/);
  assert.match(line, /qwen/);
});
