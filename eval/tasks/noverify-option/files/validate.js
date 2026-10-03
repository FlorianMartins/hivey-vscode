import { DEFAULTS } from "./defaults.js";

// A closed list: an option nobody declared is a typo, and a typo that is silently
// accepted is a setting that does nothing.
const ALLOWED = new Set(["timeout", "verbose"]);

export function load(given) {
  for (const key of Object.keys(given)) {
    if (!ALLOWED.has(key)) throw new Error(`unknown option ${key}`);
  }
  return { ...DEFAULTS, ...given };
}
