// Whether a request costs the user anything — which is not the same question as whether it leaves
// the machine, and conflating the two is how a consent card about MONEY ended up interrupting every
// local turn to tell it that nothing was billed.

import { test } from "node:test";
import assert from "node:assert/strict";
import { billsTheUser } from "../src/core/router/billing.js";
import { REMOTE_VENDORS } from "../src/core/providers/vendors.js";

test("a model on your own machine bills nobody", () => {
  assert.equal(billsTheUser("local"), false);
});

test("your own gateway bills nobody, wherever it lives", () => {
  // Deliberate, and the reason is that this extension has no price list for somebody's proxy: a
  // card quoting "~0.0000 $" is worse than no card, because it states a number it does not know.
  assert.equal(billsTheUser("openai-compatible"), false);
});

test("every vendor you hold a key for does bill you", () => {
  // Asserted over the table rather than over a list written here, so a vendor added tomorrow is
  // covered by construction. This is the half that must not be lost: the card exists for these.
  for (const v of REMOTE_VENDORS) {
    if (v.id === "openai-compatible") continue;
    assert.equal(billsTheUser(v.id), true, `${v.id} would stop asking before it spends money`);
  }
});

test("the provider decides, not where its address points", () => {
  // The careful-looking version of this rule asked about the address too, and it was wrong twice:
  // a gateway on a private network is already covered by its provider, and making the answer depend
  // on the address made the consent card impossible to exercise from a test — every stub in the
  // suite listens on loopback. Somebody who configured OpenRouter is told what OpenRouter charges.
  assert.equal(billsTheUser("openrouter"), true);
});
