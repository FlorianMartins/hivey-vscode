// An address somebody typed, turned into one a request can be made to.
//
// The failure this module exists for produced the least useful message in the product: a host with
// no scheme is a relative path to `fetch`, which answers "Invalid URL" — naming no cause and
// suggesting no action — on every request, for the life of the setting. The key is fine, the
// account is fine, and there is no way to find out.

import { test } from "node:test";
import assert from "node:assert/strict";
import { checkEndpoint, describeUnusableEndpoint, looksLikeApiKey } from "../src/core/providers/endpoint.js";
import { REMOTE_VENDORS } from "../src/core/providers/vendors.js";

test("a complete address is kept exactly as it is", () => {
  const r = checkEndpoint("https://api.openai.com/v1");
  assert.equal(r.url, "https://api.openai.com/v1");
  assert.equal(r.repaired, undefined, "an address that was already right must not be reported as changed");
});

test("a missing scheme is completed, because it has one plausible reading", () => {
  // What every documentation page shows, and what a browser accepts.
  const r = checkEndpoint("api.openai.com/v1");
  assert.equal(r.url, "https://api.openai.com/v1");
  assert.equal(r.repaired, true, "the interface has to be able to say what it saved");
});

test("a local address is completed with http, because that is what a model server speaks", () => {
  // None of them has a certificate, and https to Ollama fails in a way nobody can read.
  assert.equal(checkEndpoint("127.0.0.1:11434/v1").url, "http://127.0.0.1:11434/v1");
  assert.equal(checkEndpoint("localhost:1234/v1").url, "http://localhost:1234/v1");
  // But a public host gets https: completing it with http would send a key in clear.
  assert.equal(checkEndpoint("openrouter.ai/api/v1").url, "https://openrouter.ai/api/v1");
});

test("a trailing slash is removed, since every caller appends its own path", () => {
  assert.equal(checkEndpoint("https://api.openai.com/v1/").url, "https://api.openai.com/v1");
  assert.equal(checkEndpoint("https://api.openai.com/v1///").url, "https://api.openai.com/v1");
});

test("a scheme that is not http is refused rather than guessed at", () => {
  // `htp://` could be either, and picking `http` would sometimes send an API key over a network in
  // clear. A repair is only allowed where there is exactly one reading.
  const r = checkEndpoint("ftp://files.example.com/v1");
  assert.equal(r.url, undefined);
  assert.match(r.problem!, /not a scheme/);
  assert.match(r.problem!, /http:\/\/ or https:\/\//);
});

test("nothing at all says what the shape is", () => {
  const r = checkEndpoint("   ");
  assert.equal(r.url, undefined);
  assert.match(r.problem!, /https:\/\/api\.example\.com\/v1/, "a message with no example is a message nobody can act on");
});

test("the check at the point of use names the setting and the fix", () => {
  // Settings arrive from settings.json, from synchronisation, from a team's configuration — so not
  // every address passes the field that validates it.
  assert.equal(describeUnusableEndpoint("https://api.openai.com/v1", "openai"), undefined);

  const missing = describeUnusableEndpoint("api.openai.com/v1", "openai")!;
  assert.match(missing, /openai/);
  assert.match(missing, /missing its scheme/);
  assert.match(missing, /https:\/\/api\.openai\.com\/v1/, "it must say what to put instead");

  const bad = describeUnusableEndpoint("ftp://x/v1", "gateway")!;
  assert.match(bad, /gateway/);
  assert.match(bad, /unusable/);
});

test("a trailing slash alone is not reported as a problem to the user", () => {
  // It is repaired silently at the point of use; telling somebody their address is "unusable"
  // because of a slash would be crying wolf.
  const said = describeUnusableEndpoint("https://api.openai.com/v1/", "openai");
  assert.equal(said, undefined);
});

// ── A key is not an address, and must never be told to become one ───────────────────────────────
//
// The worst message this product has produced, reported by a user on the morning of a demo:
//
//     The address configured for "openrouter" is missing its scheme: "sk-or-v1-…".
//     It should be "https://sk-or-v1-…".
//
// It is worse than useless. It is confident, it is wrong, and it instructs the reader to make the
// setting more broken than they found it — and it was the last thing they read before concluding
// the extension did not work. The cause is structural: keys live in the editor's secret store, so
// the settings editor shows exactly one box carrying the provider's name, and it is the address.

test("a pasted key is recognised as a key, for every vendor that publishes a prefix", () => {
  const body = "0123456789abcdef0123456789abcdef";
  for (const v of REMOTE_VENDORS) {
    const prefix = v.placeholder.replace(/[….]+$/u, "").trim();
    if (prefix.length < 3) continue;
    const key = `${prefix}${body}`;
    assert.ok(looksLikeApiKey(key), `${v.id}: ${key} was not recognised as a key`);
    const check = checkEndpoint(key);
    assert.ok(check.credential, `${v.id}: the check did not say it was a credential`);
    assert.equal(check.url, undefined, `${v.id}: a key was turned into an address`);
    assert.doesNotMatch(
      check.problem ?? "",
      /https:\/\/sk-|should be “https/,
      `${v.id}: the message still tells the user to put https:// in front of their key`,
    );
  }
});

test("the message at the point of use names the real problem", () => {
  const said = describeUnusableEndpoint("sk-or-v1-0123456789abcdef0123456789abcdef", "openrouter") ?? "";
  assert.match(said, /API key/, said);
  assert.doesNotMatch(said, /missing its scheme/, said);
});

test("an address is still an address, and nothing here second-guesses one", () => {
  // The other half. A detector that calls a hostname a credential breaks the setting it was added
  // to protect, and it would do it silently on somebody's private gateway.
  for (const address of [
    "https://api.openai.com/v1",
    "api.openai.com/v1",
    "localhost:11434/v1",
    "127.0.0.1:1234/v1",
    "my-gateway.internal/v1",
    "sk-proxy.example.com/v1",
  ]) {
    assert.equal(looksLikeApiKey(address), false, address);
    assert.ok(checkEndpoint(address).url, `${address} was refused`);
  }
});

test("a bare hostname is not long enough to be mistaken for a key", () => {
  assert.equal(looksLikeApiKey("localhost"), false);
  assert.equal(looksLikeApiKey("gateway"), false);
});
