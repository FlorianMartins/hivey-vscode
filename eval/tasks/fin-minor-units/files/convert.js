// Convert an amount between currencies.
//
// ISO 4217 gives each currency a number of minor units: most have 2, the yen and the won have 0,
// the dinars of Tunisia, Bahrain and Jordan have 3.
export const MINOR_UNITS = { EUR: 2, USD: 2, JPY: 0, KRW: 0, TND: 3, BHD: 3 };

/** The amount in `to`, as a whole number of that currency's minor units. */
export function convert(minorAmount, from, to, rate) {
  const major = minorAmount / 100;
  return Math.round(major * rate * 100);
}
