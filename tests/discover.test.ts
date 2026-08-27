// Finding a model server that is already running.
//
// This is the code that decides whether the first screen a new user sees is useful or embarrassing.
// The tests below are mostly about the ways a probe goes wrong: a server that answers with a shape
// nobody documented, a port that hangs instead of refusing, an endpoint that is running but empty.
// Each of those, unhandled, produces the same visible outcome — "nothing found" — on a machine
// where something is very much running.

import { test } from "node:test";
import assert from "node:assert/strict";
import { discoverLocal, looksLikeCodeModel, modelIds, rankModels, suggestPull } from "../src/core/providers/discover.js";
import { recommend, versionScore } from "../src/core/models/recommend.js";
import { shortModelName } from "../src/core/models/names.js";

/** A fake network: a map of URL to answer, everything else refuses. */
function net(answers: Record<string, unknown>, opts: { hang?: string[] } = {}) {
  const asked: string[] = [];
  return {
    asked,
    fetchJson: async (url: string, timeoutMs: number) => {
      asked.push(url);
      if (opts.hang?.some((h) => url.includes(h))) {
        // A port that accepts the connection and never answers is the worst case: it is what a
        // firewall in DROP mode looks like, and it is why every probe carries a deadline.
        await new Promise((r) => setTimeout(r, timeoutMs + 20));
        throw new Error("timeout");
      }
      if (url in answers) return answers[url];
      throw new Error("ECONNREFUSED");
    },
  };
}

test("a running Ollama is found, with what it serves", async () => {
  const fake = net({
    "http://127.0.0.1:11434/v1/models": { data: [{ id: "qwen2.5-coder:7b" }, { id: "llama3.2:3b" }] },
  });
  const found = await discoverLocal({ fetchJson: fake.fetchJson });
  assert.equal(found.length, 1);
  assert.equal(found[0]?.name, "Ollama");
  assert.equal(found[0]?.baseUrl, "http://127.0.0.1:11434/v1");
  assert.deepEqual(found[0]?.models, ["qwen2.5-coder:7b", "llama3.2:3b"]);
});

test("nothing running is an empty list, not an error", async () => {
  // The screen has something sensible to say about an empty list. It has nothing to say about a
  // rejected promise except to look broken.
  const found = await discoverLocal({ fetchJson: net({}).fetchJson });
  assert.deepEqual(found, []);
});

test("only loopback is ever contacted", async () => {
  // The one rule this file must not break. An extension that argues your code should not leave the
  // machine has no business probing the network it is attached to.
  const fake = net({});
  await discoverLocal({ fetchJson: fake.fetchJson });
  assert.ok(fake.asked.length > 0);
  for (const url of fake.asked) {
    assert.match(url, /^http:\/\/127\.0\.0\.1:/, `${url} is not loopback`);
  }
});

test("several runtimes at once are all reported", async () => {
  const fake = net({
    "http://127.0.0.1:11434/v1/models": { data: [{ id: "qwen2.5-coder:7b" }] },
    "http://127.0.0.1:1234/v1/models": { data: [{ id: "some-lmstudio-model" }] },
  });
  const found = await discoverLocal({ fetchJson: fake.fetchJson });
  assert.deepEqual(found.map((r) => r.name).sort(), ["LM Studio", "Ollama"]);
});

test("a port that hangs does not hold up the ones that answer", async () => {
  const fake = net(
    { "http://127.0.0.1:11434/v1/models": { data: [{ id: "qwen2.5-coder:7b" }] } },
    { hang: [":8000", ":8080"] },
  );
  const started = Date.now();
  const found = await discoverLocal({ fetchJson: fake.fetchJson, timeoutMs: 60 });
  // Concurrent, so the whole sweep costs about one timeout rather than one per candidate.
  assert.ok(Date.now() - started < 400, "the probes did not run concurrently");
  assert.equal(found.length, 1);
});

test("a server that is up with nothing loaded is reported, not hidden", async () => {
  // "Ollama is running but empty" is actionable; "nothing found" sends the user to reinstall
  // something that is already working.
  const fake = net({ "http://127.0.0.1:11434/v1/models": { data: [] } });
  const found = await discoverLocal({ fetchJson: fake.fetchJson });
  assert.equal(found.length, 1);
  assert.deepEqual(found[0]?.models, []);
  assert.equal(suggestPull("Ollama"), "ollama pull qwen2.5-coder:7b");
  assert.equal(suggestPull("vLLM"), undefined, "no command is better than a wrong one");
});

test("a configured endpoint is probed alongside the well-known ports", async () => {
  const fake = net({ "http://127.0.0.1:9999/v1/models": { data: [{ id: "mine" }] } });
  const found = await discoverLocal({
    fetchJson: fake.fetchJson,
    extra: [{ name: "Configured endpoint", baseUrl: "http://127.0.0.1:9999/v1" }],
  });
  assert.equal(found.length, 1);
  assert.equal(found[0]?.name, "Configured endpoint");
});

test("the same address is not reported twice", async () => {
  const fake = net({ "http://127.0.0.1:11434/v1/models": { data: [{ id: "a" }] } });
  const found = await discoverLocal({
    fetchJson: fake.fetchJson,
    extra: [{ name: "Configured endpoint", baseUrl: "http://127.0.0.1:11434/v1" }],
  });
  assert.equal(found.length, 1, "the configured endpoint IS the Ollama we already found");
});

// ── Reading the answer ───────────────────────────────────────────────────────────────────────

test("the model list is read in each of the shapes servers actually use", () => {
  assert.deepEqual(modelIds({ data: [{ id: "a" }, { id: "b" }] }), ["a", "b"]);
  assert.deepEqual(modelIds({ models: [{ name: "a" }] }), ["a"], "Ollama's native endpoint");
  assert.deepEqual(modelIds({ data: ["a", "b"] }), ["a", "b"], "some servers return plain strings");
  assert.deepEqual(modelIds({ models: [{ model: "a" }] }), ["a"]);
});

test("an answer nobody documented yields no models rather than throwing", () => {
  for (const body of [null, undefined, "hello", 42, {}, { data: "nope" }, { data: [{}] }]) {
    assert.deepEqual(modelIds(body), [], JSON.stringify(body));
  }
});

// ── Ordering ─────────────────────────────────────────────────────────────────────────────────

test("coding models come first, so the default offered is a sensible one", () => {
  const ranked = rankModels(["nomic-embed-text", "llama3.2:3b", "qwen2.5-coder:7b", "mistral:7b-instruct"]);
  assert.equal(ranked[0], "qwen2.5-coder:7b");
  assert.equal(ranked.at(-1), "nomic-embed-text", "an embedding model is not something to write code with");
});

test("an unrecognised model is ranked low but never hidden", () => {
  const ranked = rankModels(["my-private-finetune", "qwen2.5-coder:7b"]);
  assert.equal(ranked.length, 2, "someone running a model we do not know still gets to pick it");
  assert.ok(ranked.includes("my-private-finetune"));
});

test("models that cannot write code are recognised as such", () => {
  for (const id of ["nomic-embed-text", "bge-large", "whisper-large", "llava:7b", "stable-diffusion"]) {
    assert.equal(looksLikeCodeModel(id), false, id);
  }
  for (const id of ["qwen2.5-coder:7b", "deepseek-coder-v2", "codestral", "llama3.3:70b"]) {
    assert.equal(looksLikeCodeModel(id), true, id);
  }
});

// ── Recommendations ──────────────────────────────────────────────────────────────────────────
//
// The design constraint these tests enforce: nothing is hard-coded to a version. A recommendation
// that names `claude-sonnet-4` is correct today and quietly wrong the month after — and an
// out-of-date recommendation looks exactly like a current one.

test("a family's recommendation follows its newest available version, not a pinned id", () => {
  const before = recommend([
    { id: "anthropic/claude-sonnet-4", inUsd: 3, local: false },
    { id: "qwen/qwen2.5-coder-32b", inUsd: 0.2, local: false },
  ]);
  assert.deepEqual(before.map((r) => r.id), ["anthropic/claude-sonnet-4", "qwen/qwen2.5-coder-32b"]);

  // The catalogue refreshes; the families are the same, the versions are not.
  const after = recommend([
    { id: "anthropic/claude-sonnet-4", inUsd: 3, local: false },
    { id: "anthropic/claude-sonnet-5", inUsd: 3, local: false },
    { id: "qwen/qwen2.5-coder-32b", inUsd: 0.2, local: false },
    { id: "qwen/qwen3-coder", inUsd: 0.3, local: false },
  ]);
  assert.deepEqual(after.map((r) => r.id), ["anthropic/claude-sonnet-5", "qwen/qwen3-coder"]);
});

test("a local model leads, whatever its family", () => {
  // The whole argument of this extension. Burying the free one that sends nothing under a paid one
  // would contradict the product on the screen where the choice is made.
  const out = recommend([
    { id: "anthropic/claude-opus-4", inUsd: 15, local: false },
    { id: "qwen2.5-coder:7b", inUsd: 0, local: true },
  ]);
  assert.equal(out[0]?.id, "qwen2.5-coder:7b");
  // The reason is about the model, not about where it runs: the row already says "local" twice.
  assert.match(out[0]!.why, /built for code/);
});

test("one model per family, so the list is a set of choices", () => {
  const out = recommend([
    { id: "anthropic/claude-sonnet-5", inUsd: 3, local: false },
    { id: "anthropic/claude-opus-5", inUsd: 15, local: false },
    { id: "anthropic/claude-haiku-4", inUsd: 0.8, local: false },
  ]);
  assert.equal(out.length, 1, "three sizes of the same model is not three decisions");
});

test("a size suffix is not a version", () => {
  // `:70b` is how big it is, not which one it is. Reading it as a version would rank a small new
  // model below a large old one on the strength of a number that means something else.
  assert.ok(versionScore("qwen3-coder:7b") > versionScore("qwen2.5-coder:70b"));
  assert.ok(versionScore("llama-3.3-70b") > versionScore("llama-3.1-405b"));
});

test("a date in the id is not a version either", () => {
  // `20250219` would otherwise dwarf every real version number and win permanently.
  assert.equal(versionScore("claude-3-5-sonnet-20241022"), 5);
});

test("models from no known family are simply not recommended", () => {
  assert.deepEqual(recommend([{ id: "someones-private-finetune", inUsd: 1, local: false }]), []);
  assert.deepEqual(recommend([]), []);
});

test("the list is bounded, best first", () => {
  const many = [
    { id: "anthropic/claude-sonnet-5", inUsd: 3, local: false },
    { id: "openai/gpt-5", inUsd: 5, local: false },
    { id: "qwen/qwen3-coder", inUsd: 0.3, local: false },
    { id: "deepseek/deepseek-v3", inUsd: 0.3, local: false },
    { id: "mistralai/codestral", inUsd: 0.3, local: false },
    { id: "google/gemini-3-pro", inUsd: 2, local: false },
    { id: "z-ai/glm-5", inUsd: 0.5, local: false },
    { id: "x-ai/grok-code", inUsd: 1, local: false },
  ];
  const out = recommend(many, 3);
  assert.equal(out.length, 3);
  assert.deepEqual(out.map((r) => r.id), ["anthropic/claude-sonnet-5", "openai/gpt-5", "qwen/qwen3-coder"]);
});

test("every recommendation says why, because a bare list is not advice", () => {
  for (const r of recommend([{ id: "qwen/qwen3-coder", inUsd: 0.3, local: false }])) {
    assert.ok(r.why.length > 10, r.id);
  }
});

// ── The name shown on the composer's model button ────────────────────────────────────────────

test("a model name is shortened to the part someone would say out loud", () => {
  // The button shares a row with three other controls at the side bar's default width. The vendor
  // is repeated in the picker and the size tag is a deployment detail; what is left is the name.
  assert.equal(shortModelName("anthropic/claude-sonnet-4.5"), "claude-sonnet-4.5");
  assert.equal(shortModelName("qwen2.5-coder:7b"), "qwen2.5-coder");
  assert.equal(shortModelName("qwen/qwen3-coder:32b"), "qwen3-coder");
  assert.equal(shortModelName("codestral"), "codestral");
});

test("shortening never returns nothing", () => {
  // A button whose label vanished is a button the user reports as missing — which is exactly what
  // happened when it was allowed to shrink to zero width.
  for (const name of ["", ":7b", "a/", "x"]) {
    const short = shortModelName(name);
    assert.equal(typeof short, "string");
    if (name) assert.ok(short.length > 0, JSON.stringify(name));
  }
});
