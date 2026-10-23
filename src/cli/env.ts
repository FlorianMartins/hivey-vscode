// What the terminal client reads from its environment.
//
// The key travels in the environment, never in the command line: on Linux `/proc/<pid>/cmdline` is
// world-readable and the environment is not, and on any platform the command line is what a shell
// writes to its history file.

export const ENV = {
  provider: "HIVEY_CODE_PROVIDER",
  model: "HIVEY_CODE_MODEL",
  url: "HIVEY_CODE_URL",
  key: "HIVEY_CODE_KEY",
  /**
   * Measurement knobs for the evaluation harness: the thinking level (`none`, `low`, `medium`,
   * `high`) and the temperature a run uses. Unset, the client behaves exactly as it always does.
   */
  reasoning: "HIVEY_CODE_REASONING",
  temperature: "HIVEY_CODE_TEMPERATURE",
  /**
   * The model's context window, in tokens, for a run that must fill it — the evaluation's "full
   * context" bench, where compaction and the shortening of old outputs are what is measured. Unset,
   * the window is what the configuration or the catalogue says, and nothing changes.
   */
  context: "HIVEY_CODE_CONTEXT",
} as const;

/** The thinking level asked for in the environment, if it is one this client knows. */
export function reasoningFromEnv(value: string | undefined): "none" | "low" | "medium" | "high" | undefined {
  const v = value?.trim().toLowerCase();
  return v === "none" || v === "low" || v === "medium" || v === "high" ? v : undefined;
}

/** The context window asked for in the environment, in tokens — 4096 at least, or nothing. */
export function contextFromEnv(value: string | undefined): number | undefined {
  const n = Number(value?.trim());
  return Number.isInteger(n) && n >= 4096 ? n : undefined;
}

/** The temperature asked for in the environment, if it is a number between 0 and 2. */
export function temperatureFromEnv(value: string | undefined): number | undefined {
  if (value === undefined || value.trim() === "") return undefined;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 && n <= 2 ? n : undefined;
}
