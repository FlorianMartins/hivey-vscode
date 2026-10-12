import { DEFAULTS } from "./defaults.js";

const ALLOWED = new Set(["timeout", "verbose", "retries"]);

export function load(given) {
  for (const key of Object.keys(given)) {
    if (!ALLOWED.has(key)) throw new Error(`unknown option ${key}`);
  }
  return { ...DEFAULTS, ...given };
}
