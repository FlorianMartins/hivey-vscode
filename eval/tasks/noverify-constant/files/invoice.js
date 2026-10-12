// The same rate, written a second time — which is the whole trap.
const VAT_RATE = 0.2;

export function grossTotal(lines) {
  return lines.reduce((sum, net) => sum + net, 0) * (1 + VAT_RATE);
}
