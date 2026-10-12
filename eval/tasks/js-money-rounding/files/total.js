export function totalCents(lines) {
  // Each line is { unitPrice: euros as a number, quantity: integer }. A refund line is negative.
  let total = 0;
  for (const line of lines) total += line.unitPrice * line.quantity;
  return Math.round(total * 100);
}
