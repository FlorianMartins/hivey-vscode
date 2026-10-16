import { cents, format, sum, type Cents } from "./money.js";

export interface Line {
  label: string;
  quantity: number;
  unitPrice: Cents;
}

/** VAT on the net total, rounded half up to the cent. */
export function vat(net: Cents, ratePercent: number): Cents {
  return cents(Math.round((net * ratePercent) / 100));
}

export function render(lines: readonly Line[], ratePercent: number): string[] {
  const totals = lines.map((l) => cents(l.unitPrice * l.quantity));
  const net = sum(totals);
  const tax = vat(net, ratePercent);
  return [
    ...lines.map((l, i) => `${l.label} x${l.quantity}`.padEnd(16) + format(totals[i]!).padStart(12)),
    "Net".padEnd(16) + format(net).padStart(12),
    `VAT ${ratePercent}%`.padEnd(16) + format(tax).padStart(12),
    "Total".padEnd(16) + format(sum([net, tax])).padStart(12),
  ];
}
