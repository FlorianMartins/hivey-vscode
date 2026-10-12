// Convert an amount between currencies.
//
// ISO 4217 gives each currency a number of minor units: most have 2, the yen and the won have 0,
// the dinars of Tunisia, Bahrain and Jordan have 3.
export const MINOR_UNITS = { EUR: 2, USD: 2, JPY: 0, KRW: 0, TND: 3, BHD: 3 };

function scale(currency) {
  const units = MINOR_UNITS[currency];
  // Refused rather than assumed: defaulting to two is what produced yen with centimes, and it did
  // so silently, which is the part that cost days.
  if (units === undefined) throw new Error(`unknown currency: ${currency}`);
  return 10 ** units;
}

/** The amount in `to`, as a whole number of that currency's minor units. */
export function convert(minorAmount, from, to, rate) {
  const major = minorAmount / scale(from);
  const converted = major * rate * scale(to);
  // Half away from zero, in both directions, the way an invoice rounds — `Math.round` rounds a
  // negative half towards zero.
  return Math.sign(converted) * Math.round(Math.abs(converted));
}
