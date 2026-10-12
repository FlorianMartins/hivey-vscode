import { test } from "node:test";
import assert from "node:assert/strict";
import { invoiceTotal, quote, summary } from "./orders.js";

const order = { customer: { loyal: true }, lines: [{ price: 10, quantity: 2 }] };
const plain = { customer: { loyal: false }, lines: [{ price: 10, quantity: 2 }] };

test("a loyal customer gets the discount", () => {
  assert.equal(quote(order), 18);
  assert.equal(invoiceTotal(order), 18);
});

test("anyone else does not", () => {
  assert.equal(quote(plain), 20);
  assert.equal(invoiceTotal(plain), 20);
});

test("the summary agrees with the total", () => {
  assert.equal(summary(order), "1 lines, 18.00 EUR");
});
