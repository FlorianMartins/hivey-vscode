import { test } from "node:test";
import assert from "node:assert/strict";
import { createPricing } from "./pricing.js";
import { createShipping } from "./shipping.js";

function counted(fn) {
  const wrapped = (...args) => {
    wrapped.calls += 1;
    return fn(...args);
  };
  wrapped.calls = 0;
  return wrapped;
}

test("the same SKU in two currencies gives two prices", () => {
  const basePrice = counted((sku) => ({ A1: 10, B2: 20 })[sku]);
  const rate = counted((c) => ({ EUR: 1, USD: 1.5 })[c]);
  const { priceFor } = createPricing({ basePrice, rate });
  assert.equal(priceFor("A1", "EUR"), 10);
  assert.equal(priceFor("A1", "USD"), 15);
  assert.equal(priceFor("B2", "USD"), 30);
  assert.equal(priceFor("B2", "EUR"), 20);
});

test("the slow lookups are still cached", () => {
  const basePrice = counted((sku) => ({ A1: 10, B2: 20 })[sku]);
  const rate = counted((c) => ({ EUR: 1, USD: 1.5 })[c]);
  const { priceFor } = createPricing({ basePrice, rate });
  for (let i = 0; i < 5; i++) {
    priceFor("A1", "EUR");
    priceFor("A1", "USD");
    priceFor("B2", "USD");
  }
  // One catalogue lookup per (sku, currency) price computed, one rate lookup per currency.
  assert.ok(basePrice.calls <= 3, `basePrice called ${basePrice.calls} times for 3 distinct prices`);
  assert.equal(rate.calls, 2);
});

test("shipping to two countries in the same band gives two quotes", () => {
  const quote = counted((country, band) => `${country}-${band}`);
  const { shippingFor } = createShipping({ quote });
  assert.equal(shippingFor("BE", 0.5), "BE-S");
  assert.equal(shippingFor("BE", 3), "BE-M");
  assert.equal(shippingFor("FR", 0.5), "FR-S");
  assert.equal(shippingFor("BE", 0.7), "BE-S");
  assert.equal(quote.calls, 3);
});
