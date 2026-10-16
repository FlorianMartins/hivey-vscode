import { test } from "node:test";
import assert from "node:assert/strict";
import { createPricing } from "./pricing.js";

const catalogue = { A1: 10, B2: 25.5 };
const rates = { EUR: 1, USD: 1.1, GBP: 0.8 };

test("a price in the catalogue currency", () => {
  const { priceFor } = createPricing({ basePrice: (sku) => catalogue[sku], rate: (c) => rates[c] });
  assert.equal(priceFor("A1", "EUR"), 10);
  assert.equal(priceFor("B2", "EUR"), 25.5);
});

test("a converted price", () => {
  const { priceFor } = createPricing({ basePrice: (sku) => catalogue[sku], rate: (c) => rates[c] });
  assert.equal(priceFor("B2", "GBP"), 20.4);
});
