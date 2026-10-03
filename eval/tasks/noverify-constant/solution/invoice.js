const VAT_RATE = 0.21;

export function grossTotal(lines) {
  return lines.reduce((sum, net) => sum + net, 0) * (1 + VAT_RATE);
}
