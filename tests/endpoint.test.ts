// An address somebody typed, turned into one a request can be made to.
//
// The failure this module exists for produced the least useful message in the product: a host with
// no scheme is a relative path to `fetch`, which answers "Invalid URL" — naming no cause and
// suggesting no action — on every request, for the life of the setting. The key is fine, the
// account is fine, and there is no way to find out.

import { test } from "node:test";
import assert from "node:assert/strict";
import { checkEndpoint, describeUnusableEndpoint } from "../src/core/providers/endpoint.js";

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
