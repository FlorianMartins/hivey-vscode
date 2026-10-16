/**
 * The API client. `transport(url, { timeoutMs })` does the actual request; it is `fetch` with an
 * AbortSignal in production and a fake in the tests.
 */
export function createClient(config, transport) {
  async function get(path) {
    let lastError;
    for (let attempt = 0; attempt <= config.retries; attempt++) {
      try {
        return await transport(`${config.baseUrl}${path}`, { timeoutMs: config.timeoutMs });
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError;
  }
  return { get };
}
