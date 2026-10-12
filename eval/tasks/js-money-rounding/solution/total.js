export function totalCents(lines) {
  // Each line is { unitPrice: euros as a number, quantity: integer }. A refund line is negative.
  let total = 0;
  for (const line of lines) total += line.unitPrice * line.quantity;
  const cents = total * 100;
  // Half AWAY FROM ZERO, in both directions. `Math.round` rounds towards +Infinity, so a refund of
  // half a cent came back a cent short of the invoice that charged it.
  return Math.sign(cents) * Math.round(Math.abs(cents));
}
