// Whether a provider can be switched to, as opposed to switched to and then failing.

import { test } from "node:test";
import assert from "node:assert/strict";
import { providerIsReady, whatIsMissing } from "../src/core/providers/ready.js";

const gateway = { hasKey: false, hasEndpoint: true, needsUrl: true, localFound: false };

test("a gateway with an address is ready, key or no key", () => {
  // The defect, reported three times in three different places. The check asked for a key FIRST
  // and looked at the address afterwards, so a gateway with an address and no key was never ready
  // — and the composer's menu refuses to select something that is not ready. Choosing "Your own
  // gateway" therefore did nothing at all, for ever. A key there is genuinely optional: a proxy on
  // somebody's own network usually has none, and `providerFor` says so in as many words.
  assert.equal(providerIsReady("openai-compatible", gateway), true);
  assert.equal(providerIsReady("openai-compatible", { ...gateway, hasKey: true }), true);
});

test("a gateway with no address is not ready, and says which piece is missing", () => {
  const bare = { ...gateway, hasEndpoint: false };
  assert.equal(providerIsReady("openai-compatible", bare), false);
  assert.equal(whatIsMissing("openai-compatible", bare), "endpoint");
});

test("a vendor still needs its key", () => {
  // The other half, which must not be lost: selecting Anthropic with no key leaves the panel
  // configured to fail, and the failure arrives one question later as an HTTP 401.
  const vendor = { hasKey: false, hasEndpoint: true, needsUrl: false, localFound: false };
  assert.equal(providerIsReady("anthropic", vendor), false);
  assert.equal(whatIsMissing("anthropic", vendor), "key");
  assert.equal(providerIsReady("anthropic", { ...vendor, hasKey: true }), true);
});

test("the local provider is ready once a runtime has been found", () => {
  assert.equal(providerIsReady("local", { ...gateway, localFound: true }), true);
  assert.equal(providerIsReady("local", { ...gateway, localFound: false }), false);
  assert.equal(whatIsMissing("local", gateway), "runtime");
});
