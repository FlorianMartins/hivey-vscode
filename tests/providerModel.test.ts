// The model that goes with a provider, when the provider is switched — see core/router/providerModel.ts.

import { test } from "node:test";
import assert from "node:assert/strict";
import { modelForProvider } from "../src/core/router/providerModel.js";

const models = [
  { id: "hivey/smart", provider: "openrouter" },
  { id: "anthropic/claude-opus-5.5", provider: "openrouter" },
  { id: "qwen-27b", provider: "openai-compatible" },
  { id: "qwen-flash", provider: "openai-compatible" },
  { id: "qwen3.8:27b", provider: "local" },
];

test("switching to OpenRouter from the gateway does not keep the gateway's model — no 404", () => {
  assert.equal(modelForProvider("openrouter", "qwen-27b", {}, models), "hivey/smart", "the first it lists");
});

test("back on a provider, its own last model comes back", () => {
  const remembered = { openrouter: "anthropic/claude-opus-5.5", "openai-compatible": "qwen-flash" };
  assert.equal(modelForProvider("openrouter", "qwen-flash", remembered, models), "anthropic/claude-opus-5.5");
  assert.equal(modelForProvider("openai-compatible", "anthropic/claude-opus-5.5", remembered, models), "qwen-flash");
});

test("a remembered model no longer served is not brought back; the current one is kept where it is served", () => {
  assert.equal(modelForProvider("openrouter", "anthropic/claude-opus-5.5", { openrouter: "gone/model" }, models), "anthropic/claude-opus-5.5");
  assert.equal(modelForProvider("local", "qwen-27b", { local: "gone" }, models), "qwen3.8:27b");
});

test("its list not in yet: the model it last answered with; nothing known at all: left as it is", () => {
  assert.equal(modelForProvider("anthropic", "qwen-27b", { anthropic: "claude-opus-5-5" }, models), "claude-opus-5-5");
  assert.equal(modelForProvider("openrouter", "qwen-27b", {}, []), undefined);
});
