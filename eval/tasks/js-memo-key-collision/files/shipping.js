import { memoize } from "./memo.js";

/**
 * Shipping cost, by destination country and weight band. `quote(country, band)` asks the carrier.
 */
export function createShipping({ quote }) {
  const cost = memoize((country, band) => quote(country, band));

  return {
    shippingFor(country, weightKg) {
      const band = weightKg <= 1 ? "S" : weightKg <= 5 ? "M" : "L";
      return cost(country, band);
    },
  };
}
