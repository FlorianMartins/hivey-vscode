// What the editor hands the terminal client.
//
// This file exists because of a bug that could not be seen from either side alone: the extension
// passed a URL and a model, the client also needed a provider and a key, and nobody had written
// down that this was the contract. Anyone whose model sat behind a gateway opened the terminal and
// got `HTTP 401 Unauthorized` on their first question — which reads as a broken feature rather
// than as a missing hand-off.

import { test } from "node:test";
import assert from "node:assert/strict";
import { ENV, missingKey, terminalEnvironment } from "../src/cli/env.js";

/**
 * Deliberately not shaped like a key.
 *
 * The project's own secret scanner reads every tracked file, and a fixture spelled `sk-or-v1-…`
 * trips it — correctly. A scanner that has been taught to ignore one file that looks like a
 * credential is a scanner that will ignore the next one too, so the fixture changes rather than the
 * rule. Nothing here depends on the value's shape; only on it arriving.
 */
const KEY = "a-value-that-travels";

const remote = { provider: "openrouter", model: "anthropic/claude-sonnet-4.5", baseUrl: "https://openrouter.ai/api/v1", isLocal: false };
const local = { provider: "local", model: "qwen2.5-coder:7b", baseUrl: "http://127.0.0.1:11434/v1", isLocal: true };

test("the provider travels, so the client speaks the right wire format", () => {
  // Anthropic's API is not the OpenAI one. Without this the editor could open a terminal pointed at
  // Anthropic and the client would send OpenAI-shaped requests to it for ever.
  const env = terminalEnvironment({ ...remote, provider: "anthropic" });
  assert.equal(env[ENV.provider], "anthropic");
  assert.equal(env[ENV.model], remote.model);
  assert.equal(env[ENV.url], remote.baseUrl);
});

test("a remote endpoint carries the key", () => {
  const env = terminalEnvironment({ ...remote, apiKey: KEY });
  assert.equal(env[ENV.key], KEY);
});

test("a local endpoint never carries a key, even when one is stored", () => {
  // There is no reason for a credential to be in the environment of a process that will not use it,
  // and "no reason" is the whole test for whether a secret should be somewhere.
  const env = terminalEnvironment({ ...local, apiKey: KEY });
  assert.equal(env[ENV.key], undefined);
  assert.ok(!Object.values(env).includes(KEY));
});

test("no key stored means no empty variable", () => {
  // An empty string is not the same as absent, and a client that reads one gets an empty
  // Authorization header rather than none at all.
  const env = terminalEnvironment(remote);
  assert.equal(ENV.key in env, false);
});

test("the editor's own Node is what runs", () => {
  assert.equal(terminalEnvironment(local)["ELECTRON_RUN_AS_NODE"], "1");
});

test("a terminal that would fail is known to be failing before it opens", () => {
  assert.equal(missingKey(remote), true, "remote, no key");
  assert.equal(missingKey({ ...remote, apiKey: KEY }), false);
  assert.equal(missingKey(local), false, "a local server needs no key");
  assert.equal(missingKey({ ...local, apiKey: undefined }), false);
});
