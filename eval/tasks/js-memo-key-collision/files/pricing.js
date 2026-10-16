import { memoize } from "./memo.js";

/**
 * Prices per store currency.
 *
 * `basePrice(sku)` is the catalogue price in EUR and `rate(currency)` the conversion rate from EUR;
 * both are network calls in production.
 */
export function createPricing({ basePrice, rate }) {
  const rateFor = memoize((currency) => rate(currency));

  const priceFor = memoize((sku, currency) => {
    const amount = basePrice(sku) * rateFor(currency);
    return Math.round(amount * 100) / 100;
  });

  return { priceFor };
}
