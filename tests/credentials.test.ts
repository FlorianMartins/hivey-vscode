// Adding a provider: both fields, checked, in one pass.
//
// Florian: « l'ajout d'une nouvelle clé API qui est bug et pas user friendly par exemple pour le
// gateway qui demande de stocker l'adresse et ensuite de stocker la clé API plutôt que de remplir les
// deux champs et valider ». Two faults: the address was never asked for at all, and nothing was ever
// checked — including against the `placeholder` the vendor table carries for exactly that purpose.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  checkCredentials,
  expectedPrefix,
  keyProblem,
  normalizeBaseUrl,
  urlProblem,
} from "../src/core/providers/credentials.js";

const OPENROUTER = { label: "OpenRouter", placeholder: "sk-or-v1-…" };
const SHAPELESS = { label: "Mistral", placeholder: "…" };

test("a key with a line break in it is refused", () => {
  // The single most common bad paste: a selection that caught the newline at the end.
  const problem = keyProblem(OPENROUTER, "sk-or-v1-abc\n");
  assert.equal(problem?.fatal, true);
  assert.match(problem!.message, /space or a line break/);
});

test("an address pasted into the key box says which box it belongs in", () => {
  const problem = keyProblem(OPENROUTER, "https://openrouter.ai/api/v1");
  assert.equal(problem?.fatal, true);
  assert.match(problem!.message, /previous step/);
});

test("the example copied out of the prompt is refused", () => {
  assert.equal(keyProblem(OPENROUTER, "sk-or-v1-…")?.fatal, true);
});

test("a wrong prefix warns but does not refuse", () => {
  // ⚠️ Deliberately not fatal. A vendor can change its key format next quarter, and a check that
  // refuses a VALID key is worse than one that lets a wrong key through: the first makes the product
  // unusable for somebody holding the right thing.
  const problem = keyProblem(OPENROUTER, "sk-ant-abcdef");
  assert.equal(problem?.fatal, false);
  assert.match(problem!.message, /usually start with/);
});

test("a vendor with no published key shape complains about nothing", () => {
  assert.equal(expectedPrefix("…"), undefined);
  assert.equal(keyProblem(SHAPELESS, "whatever-this-is"), undefined);
});

test("a good key passes", () => {
  // Deliberately short. A realistic-length fake trips `scan:secrets` on its SHAPE, which is the
  // scanner doing its job — the fix is not to widen its allow-list for a test file, it is to not
  // write something that looks like a credential. What is under test here is the prefix, not a
  // length nobody checks.
  assert.equal(keyProblem(OPENROUTER, "sk-or-v1-ok"), undefined);
});

test("an address is normalised the way people type it", () => {
  assert.equal(normalizeBaseUrl("  openrouter.ai/api/v1/  "), "https://openrouter.ai/api/v1");
  assert.equal(normalizeBaseUrl("https://x.test/v1///"), "https://x.test/v1");
  // Localhost gets http, because that is what a local runtime serves and https would simply fail.
  assert.equal(normalizeBaseUrl("127.0.0.1:11434/v1"), "http://127.0.0.1:11434/v1");
  assert.equal(normalizeBaseUrl(""), "");
});

test("an empty address is only a problem when the provider needs one", () => {
  assert.equal(urlProblem("", { required: false }), undefined);
  assert.equal(urlProblem("", { required: true })?.fatal, true);
});

test("the full endpoint path is refused, because the client adds it", () => {
  const problem = urlProblem("https://x.test/v1/chat/completions", { required: true });
  assert.equal(problem?.fatal, true);
  assert.match(problem!.message, /without \/chat\/completions/);
});

test("a missing /v1 warns and a present one does not", () => {
  // ⚠️ A warning, not a refusal: most OpenAI-compatible gateways are at /v1 and leaving it off is the
  // common mistake — but some are not, and refusing those would break the gateway entry for exactly
  // the people it exists for.
  assert.equal(urlProblem("https://gw.test", { required: true })?.fatal, false);
  assert.equal(urlProblem("https://gw.test/v1", { required: true }), undefined);
});

test("http to a remote host warns about the key travelling in clear", () => {
  assert.match(urlProblem("http://gw.example.com/v1", { required: true })!.message, /clear text/);
  // Not for this machine or this network, where there is nothing to intercept.
  assert.equal(urlProblem("http://127.0.0.1:11434/v1", { required: true }), undefined);
  assert.equal(urlProblem("http://localhost:1234/v1", { required: true }), undefined);
});

test("something that is not an address at all is refused", () => {
  assert.equal(urlProblem("ftp://x.test/v1", { required: true })?.fatal, true);
});

test("a rejected key is reported as rejected, not as unreachable", () => {
  // The distinction matters: one means "fix the key", the other means "the VPN is down". Telling
  // somebody to check their key when the address is wrong is an afternoon.
  return (async () => {
    const stub = (async () => new Response("", { status: 401 })) as unknown as typeof fetch;
    const out = await checkCredentials({ wire: "openai", label: "OpenAI" }, "https://api.test/v1", "sk-bad", stub);
    assert.equal(out.ok, false);
    assert.equal(out.ok === false && out.retryable, false, "a rejected key is not worth retrying");
  })();
});

test("an unreachable endpoint is retryable and says the address", () => {
  return (async () => {
    const stub = (async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof fetch;
    const out = await checkCredentials({ wire: "openai", label: "Gateway" }, "https://gw.test/v1", "sk-x", stub);
    assert.equal(out.ok, false);
    assert.equal(out.ok === false && out.retryable, true);
    assert.match(out.ok === false ? out.why : "", /gw\.test\/v1\/models/);
  })();
});

test("a server that does not list models is not a bad key", () => {
  // ⚠️ Plenty of small gateways serve /chat/completions and nothing else. Treating 404 as a rejected
  // key would refuse working credentials.
  return (async () => {
    const stub = (async () => new Response("", { status: 404 })) as unknown as typeof fetch;
    const out = await checkCredentials({ wire: "openai", label: "Gateway" }, "https://gw.test/v1", "sk-x", stub);
    assert.equal(out.ok, true);
  })();
});

test("a working key reports how many models it can see", () => {
  return (async () => {
    const stub = (async () =>
      new Response(JSON.stringify({ data: [{ id: "a" }, { id: "b" }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })) as unknown as typeof fetch;
    const out = await checkCredentials({ wire: "openai", label: "OpenRouter" }, "https://or.test/api/v1", "sk-or-v1-x", stub);
    assert.deepEqual(out, { ok: true, models: 2 });
  })();
});

test("Anthropic is checked with its own header", () => {
  // Two wire formats, two ways of presenting a key. Sending a Bearer token to Anthropic would report
  // every valid Anthropic key as rejected.
  return (async () => {
    let seen: Record<string, string> = {};
    const stub = (async (_url: string, init: { headers: Record<string, string> }) => {
      seen = init.headers;
      return new Response(JSON.stringify({ data: [] }), { status: 200, headers: { "content-type": "application/json" } });
    }) as unknown as typeof fetch;
    await checkCredentials({ wire: "anthropic", label: "Anthropic" }, "https://api.anthropic.com/v1", "sk-ant-x", stub);
    assert.equal(seen["x-api-key"], "sk-ant-x");
    assert.equal(seen["authorization"], undefined);
  })();
});
