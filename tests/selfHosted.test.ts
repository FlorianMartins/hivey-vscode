// « les anonymisations des données s'appliquent également sur les modèles locaux et gateway […]
// c'est des environnements sûrs ». Self-hosted is decided by WHAT the provider is, not by its
// address: the local endpoint reached by a public name, or the company gateway, is still the
// user's own infrastructure. Clouds stay pseudonymized whatever happens.

import { test } from "node:test";
import assert from "node:assert/strict";
import { isLocalEndpoint, isSelfHostedProvider } from "../src/core/redaction/index.js";

test("the local endpoint and the user's own gateway are self-hosted, by what they are", () => {
  assert.ok(isSelfHostedProvider("local"));
  assert.ok(isSelfHostedProvider("openai-compatible"));
  // A public address does not change that — which is exactly what the address test alone got wrong.
  assert.equal(isLocalEndpoint("https://ai.hivey.be/v1"), false);
});

test("no cloud provider is ever self-hosted", () => {
  for (const cloud of ["openrouter", "anthropic", "openai", "google", "deepseek", "qwen", "mistral", "xai", "groq", "perplexity"]) {
    assert.equal(isSelfHostedProvider(cloud), false, cloud);
  }
});
