import { load } from "./validate.js";

console.log(`${load({}).retries} ${load({ retries: 5 }).retries}`);
