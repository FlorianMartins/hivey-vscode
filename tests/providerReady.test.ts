// Whether a provider has anything behind it, which decides whether choosing it sends the user to
// set it up. Getting this wrong in either direction is worse than not having it: a false "ready"
// restores the silent 401, and a false "not ready" throws somebody onto a settings screen they had
// already filled in.

import { test } from "node:test";
import assert from "node:assert/strict";
import { providerReady } from "../src/webview/chat.js";
import type { UiSetup, UiState } from "../src/shared/protocol.js";

function stateWith(setup: Partial<UiSetup>): UiState {
  return { setup: { probing: false, runtimes: [], hasKey: {}, endpoints: {}, ...setup } } as unknown as UiState;
}

test("on this machine is ready only once a server has answered", () => {
  assert.equal(providerReady("local", stateWith({})), false);
  assert.equal(
    providerReady("local", stateWith({ runtimes: [{ id: "ollama", label: "Ollama", baseUrl: "", models: [] }] as never })),
    true,
  );
});

test("a probe still running is not a failure", () => {
  // Reported as "not set up" while the search is in progress, every window would accuse the machine
  // of having nothing on it for the second the probe takes.
  assert.equal(providerReady("local", stateWith({ probing: true })), true);
});

test("a gateway needs its key", () => {
  assert.equal(providerReady("anthropic", stateWith({})), false);
  assert.equal(providerReady("anthropic", stateWith({ hasKey: { anthropic: true } })), true);
  assert.equal(providerReady("openrouter", stateWith({ hasKey: { anthropic: true } })), false);
});

test("a gateway that is only an API shape needs an address as well as a key", () => {
  // Azure, LiteLLM, a company proxy: the key alone points at nothing.
  const keyOnly = stateWith({ hasKey: { "openai-compatible": true } });
  assert.equal(providerReady("openai-compatible", keyOnly), false);
  const both = stateWith({ hasKey: { "openai-compatible": true }, endpoints: { "openai-compatible": "https://x/v1" } });
  assert.equal(providerReady("openai-compatible", both), true);
  const urlOnly = stateWith({ endpoints: { "openai-compatible": "https://x/v1" } });
  assert.equal(providerReady("openai-compatible", urlOnly), false, "an address without a key is not ready either");
});
