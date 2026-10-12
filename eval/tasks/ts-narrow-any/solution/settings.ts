// Settings as they arrive from the configuration file.

export interface Settings {
  endpoint: string;
  retries: number;
  verbose: boolean;
}

/** What a configuration file may hold before anything has been checked. */
type Unknown = Record<string, unknown>;

function isObject(value: unknown): value is Unknown {
  return typeof value === "object" && value !== null;
}

/**
 * A cast says "trust me"; a guard asks. The difference shows up the first time a field is missing:
 * the cast hands a `undefined` to something expecting a string, several layers away from here.
 */
export function readSettings(raw: unknown): Settings {
  if (!isObject(raw)) throw new Error("settings: expected an object");
  const endpoint = raw["endpoint"];
  const retries = raw["retries"];
  if (typeof endpoint !== "string") throw new Error("settings: endpoint must be a string");
  if (typeof retries !== "number") throw new Error("settings: retries must be a number");
  return { endpoint, retries, verbose: Boolean(raw["verbose"]) };
}
