import { test } from "node:test";
import assert from "node:assert/strict";
import { totalCents } from "./total.js";

test("an ordinary invoice is exact", () => {
  assert.equal(totalCents([{ unitPrice: 19.99, quantity: 3 }]), 5997);
});

test("a half cent rounds up, away from zero", () => {
  assert.equal(totalCents([{ unitPrice: 0.125, quantity: 1 }]), 13);
});

test("a half cent on a refund rounds DOWN, also away from zero", () => {
  // Math.round rounds towards +Infinity, so -12.5 becomes -12 and the customer is refunded a cent
  // less than the invoice charged them. Over a year of credit notes that is a real reconciliation
  // difference, and it is invisible on every positive amount anyone tests with.
  assert.equal(totalCents([{ unitPrice: -0.125, quantity: 1 }]), -13);
});

test("a whole refund matches the invoice it cancels", () => {
  const lines = [{ unitPrice: 1.005, quantity: 1 }];
  const refund = [{ unitPrice: -1.005, quantity: 1 }];
  assert.equal(totalCents(lines) + totalCents(refund), 0);
});
