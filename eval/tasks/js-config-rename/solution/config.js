export const DEFAULTS = Object.freeze({
  baseUrl: "https://api.example.test",
  timeoutMs: 30_000,
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

  // `timeout`, in seconds, was renamed `timeoutMs`, in milliseconds. Old files keep working until
  // 3.0; when both are present the new key wins. The old value is validated under its own name, so
  // the error names what the user actually wrote.
  if ("timeout" in input) {
    warn("config: `timeout` (seconds) is deprecated, use `timeoutMs` (milliseconds)");
    if (typeof input.timeout !== "number" || !(input.timeout > 0)) {
      throw new Error(`config: timeout must be a positive number of seconds, got ${JSON.stringify(input.timeout)}`);
    }
    if (!("timeoutMs" in input)) input.timeoutMs = Math.round(input.timeout * 1000);
    delete input.timeout;
  }

  const config = { ...DEFAULTS, ...input };

  if (!Number.isInteger(config.timeoutMs) || config.timeoutMs <= 0) {
    throw new Error(`config: timeoutMs must be a positive whole number of milliseconds, got ${JSON.stringify(config.timeoutMs)}`);
  }
  if (!Number.isInteger(config.retries) || config.retries < 0) {
    throw new Error(`config: retries must be a non-negative integer, got ${JSON.stringify(config.retries)}`);
  }
  return config;
}
