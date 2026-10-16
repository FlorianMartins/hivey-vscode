export const DEFAULTS = Object.freeze({
  baseUrl: "https://api.example.test",
  timeout: 30, // seconds
  retries: 2,
});

/**
 * The effective configuration, from a parsed config file or CLI flags.
 *
 * `warn` receives deprecation notices; the CLI prints them on stderr.
 */
export function loadConfig(raw = {}, { warn = (msg) => console.warn(msg) } = {}) {
  const input = { ...raw };

  // `retry` was renamed `retries` in 2.0. Old files keep working until 3.0.
  if ("retry" in input) {
    warn("config: `retry` is deprecated, use `retries`");
    if (!("retries" in input)) input.retries = input.retry;
    delete input.retry;
  }

  const config = { ...DEFAULTS, ...input };

  if (typeof config.timeout !== "number" || !(config.timeout > 0)) {
    throw new Error(`config: timeout must be a positive number of seconds, got ${JSON.stringify(config.timeout)}`);
  }
  if (!Number.isInteger(config.retries) || config.retries < 0) {
    throw new Error(`config: retries must be a non-negative integer, got ${JSON.stringify(config.retries)}`);
  }
  return config;
}
