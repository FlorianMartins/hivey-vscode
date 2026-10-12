import { test } from "node:test";
import assert from "node:assert/strict";
import { formatAddress } from "./address.js";

test("a full address is formatted", () => {
  assert.equal(
    formatAddress({ address: { street: "1 rue Dupont", city: "Lyon", postcode: "69001" } }),
    "1 rue Dupont, 69001 Lyon",
  );
});

test("no address is an empty string, not a crash", () => {
  assert.equal(formatAddress({}), "");
  assert.equal(formatAddress({ address: null }), "");
});
