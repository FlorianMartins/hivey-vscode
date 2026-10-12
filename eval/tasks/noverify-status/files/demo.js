import { STATUSES } from "./status.js";
import { label } from "./render.js";

console.log(STATUSES.map(label).join("|"));
