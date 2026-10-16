import { render } from "@core/invoice.js";
import { cents } from "@core/money.js";

const lines = [
  { label: "Widget", quantity: 2, unitPrice: cents(1000) },
  { label: "Gadget", quantity: 1, unitPrice: cents(1550) },
  { label: "Cable", quantity: 3, unitPrice: cents(299) },
];

for (const line of render(lines, 21)) console.log(line);
