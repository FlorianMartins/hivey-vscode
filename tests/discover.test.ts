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
