// What the picker is allowed to offer.
//
// The list carried four hundred and fifty-seven rows whatever the user had configured, because the
// generated catalogue ships with the extension and was appended unconditionally. Every one of those
// rows is reached THROUGH OpenRouter, and so are the three Hivey presets — a routing over the same
// catalogue. Without a key there they are not choices, they are a shop window: worth showing to
// somebody who has nothing else, noise to somebody whose access is a private gateway with two
// models on it.

import { test } from "node:test";
import assert from "node:assert/strict";
import { offerable } from "../src/core/models/offer.js";
import type { UiModel } from "../src/shared/protocol.js";

const model = (id: string, provider: string, over: Partial<UiModel> = {}): UiModel => ({
  id,
  name: id,
  vendor: provider,
  context: 0,
  inUsd: 0,
  outUsd: 0,
  cachedInUsd: 0,
  provider,
  local: provider === "local",
  loopback: provider === "local",
  ...over,
});

const catalogue = [model("anthropic/one", "openrouter"), model("openai/two", "openrouter")];

test("a gateway user is offered the gateway's models, not the catalogue", () => {
  // Marked local, because that is what an internal proxy is: a loopback or RFC1918 address. A rule
  // that asked "is it remote?" would never fire for the user who reported this.
  const gw = (id: string) => model(id, "openai-compatible", { local: true, loopback: true });
  const all = [...catalogue, gw("qwen3-coder"), gw("deepseek-r2")];
  const offered = offerable(all, { openrouter: false });
  assert.deepEqual(offered.map((m) => m.id), ["qwen3-coder", "deepseek-r2"]);
});

test("with a key, everything is still offered", () => {
  const all = [...catalogue, model("qwen3-coder", "openai-compatible")];
  assert.equal(offerable(all, { openrouter: true }).length, all.length);
});

test("somebody with nothing configured still sees what connecting would buy them", () => {
  // The catalogue is the argument for connecting a provider at all. Hiding it from a fresh install
  // would leave an empty picker and no explanation.
  assert.deepEqual(offerable(catalogue, { openrouter: false }), catalogue);
});

test("the selected model is never dropped from the list it is selected in", () => {
  // A picker whose trigger names a model absent from its own list cannot be closed by choosing
  // again — and the selection can perfectly well be a catalogue model chosen before the key was
  // removed.
  const all = [
    ...catalogue.map((m, i) => (i === 0 ? { ...m, current: true } : m)),
    model("qwen3-coder", "openai-compatible"),
  ];
  const offered = offerable(all, { openrouter: false });
  assert.ok(offered.some((m) => m.current), "the current model vanished from the picker");
});

test("somebody running only Ollama keeps the catalogue", () => {
  // The trap in the obvious version of this rule, and the common first run. A local runtime is not
  // a choice about where remote models come from — it is the absence of one — so hiding the
  // catalogue there would remove the only thing that says what connecting a provider would buy.
  const all = [...catalogue, model("qwen2.5-coder:7b", "local")];
  assert.equal(offerable(all, { openrouter: false }).length, all.length);
});

test("local models are kept alongside the gateway's", () => {
  const all = [
    ...catalogue,
    model("qwen2.5-coder:7b", "local"),
    model("qwen3-coder", "openai-compatible", { local: true, loopback: true }),
  ];
  assert.deepEqual(offerable(all, { openrouter: false }).map((m) => m.id), ["qwen2.5-coder:7b", "qwen3-coder"]);
});

test("a key with a vendor of their own also settles where their models come from", () => {
  const all = [...catalogue, model("claude-x", "anthropic")];
  assert.deepEqual(offerable(all, { openrouter: false }).map((m) => m.id), ["claude-x"]);
});
