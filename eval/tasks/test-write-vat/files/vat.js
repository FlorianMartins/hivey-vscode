export const RATES = { standard: 0.2, reduced: 0.055 };

export function withVat(amount, rate = "standard") {
  if (amount < 0) throw new RangeError("amount must not be negative");
  const multiplier = RATES[rate];
  if (multiplier === undefined) throw new RangeError(`unknown rate: ${rate}`);
  return Math.round(amount * (1 + multiplier) * 100) / 100;
}
