/** An amount in cents. Never a float: a float of euros cannot hold 0.10 exactly. */
export type Cents = number & { readonly __cents: unique symbol };

export function cents(value: number): Cents {
  if (!Number.isInteger(value)) throw new Error(`not a whole number of cents: ${value}`);
  return value as Cents;
}

export function format(amount: Cents, currency = "EUR"): string {
  const sign = amount < 0 ? "-" : "";
  const abs = Math.abs(amount);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")} ${currency}`;
}

export function sum(amounts: readonly Cents[]): Cents {
  return cents(amounts.reduce((total, a) => total + a, 0));
}
