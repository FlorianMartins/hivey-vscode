// The state of one request, as the panel sees it.

/**
 * Four optional fields describe sixteen states, of which three are real. The other thirteen —
 * loading and failed at once, done with no data, nothing set at all — were all writable, and every
 * reader had to guess which combination meant what.
 */
export type Request =
  | { status: "loading" }
  | { status: "failed"; error: string }
  | { status: "done"; data: string[] };

export function render(request: Request): string {
  switch (request.status) {
    case "loading":
      return "loading…";
    case "failed":
      return `failed: ${request.error}`;
    case "done":
      return request.data.join(", ");
  }
}
