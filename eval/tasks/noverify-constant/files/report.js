import { withVat } from "./price.js";
import { grossTotal } from "./invoice.js";

console.log(`${withVat(100).toFixed(2)} ${grossTotal([100]).toFixed(2)}`);
