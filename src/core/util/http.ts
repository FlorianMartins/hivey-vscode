// Every HTTP call the extension makes goes through here, for three reasons.
//
// 1. TIMEOUTS THAT MEAN SOMETHING. Node's fetch gives up on a response whose headers are slow,
//    and a local model loading 5 GB of weights on a CPU-only laptop IS slow — the first request
//    after a cold start can take a minute before a single byte comes back. The default failure is
//    `TypeError: fetch failed`, which tells a user nothing. Here the deadline is explicit, longer
//    for chat than for completion, and the error says what actually happened.
// 2. ERRORS A HUMAN CAN ACT ON. Connection refused means the server is not running; a 401 means
//    the key; a timeout on the first call means the model is loading. Each one has a next step,
//    and the message carries it.
// 3. ONE PLACE THAT KNOWS WHERE REQUESTS GO. The egress ledger and the tests both hook here, so
//    "what did this extension send, and to whom" has a single answer.

export class HttpError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly url?: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export interface RequestOptions extends RequestInit {
  /** Deadline for the first byte of the response. */
  timeoutMs?: number;
  /** What the user was doing, used in the error message. */
  label?: string;
}

export async function request(url: string, opts: RequestOptions = {}): Promise<Response> {
  const { timeoutMs = 120_000, label = "request", signal, ...init } = opts;
  const ctl = new AbortController();
  // Whose abort was it? `fetch` rejects with the abort REASON, so without this flag a deadline we
  // set ourselves is indistinguishable from a cancellation by the user.
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    ctl.abort(new Error("timeout"));
  }, timeoutMs);
  const unlink = linkAbort(signal ?? undefined, ctl);
  try {
    return await fetch(url, { ...init, signal: ctl.signal });
  } catch (err) {
    // The request is over; nothing is left for the caller's signal to cancel.
    unlink();
    throw explain(err, url, label, timeoutMs, signal?.aborted === true, timedOut);
  } finally {
    // Only the deadline. The link to the caller's signal deliberately OUTLIVES this function —
    // see `linkAbort`.
    clearTimeout(timer);
  }
}

/**
 * The caller's cancellation, wired to this request for as long as the request can be cancelled.
 *
 * `fetch` resolves when the response HEADERS arrive, not when the body is finished. The bridge from
 * the caller's signal used to be removed in a `finally` on that await — so from the first byte
 * onward, the caller's signal reached nothing. For a streamed answer that is the whole lifetime of
 * the request.
 *
 * What saved it in practice is that the readers cancel their stream on abort, and cancelling the
 * body is enough to make the client drop the connection — measured, not assumed: a test that
 * streams forever shows the server seeing the socket close either way. So this is not the fix for a
 * bug anyone has reported; it is the same promise kept for the cases where nothing is reading a
 * stream — a slow `res.json()`, a request cancelled between the headers and the body — where the
 * caller's stop had no effect at all.
 *
 * What it must not do is accumulate one listener per request on a signal that lives for a whole
 * turn: twenty steps would trip Node's "possible EventTarget memory leak" warning. Hence one
 * listener per SIGNAL, shared by every request made under it, with the controllers in a set the
 * signal owns.
 */
export function linkAbort(signal: AbortSignal | undefined, ctl: AbortController): () => void {
  if (!signal) return () => {};
  if (signal.aborted) {
    ctl.abort(signal.reason);
    return () => {};
  }
  let group = links.get(signal);
  if (!group) {
    const controllers = new Set<AbortController>();
    group = controllers;
    links.set(signal, controllers);
    signal.addEventListener(
      "abort",
      () => {
        for (const pending of controllers) pending.abort(signal.reason);
        controllers.clear();
      },
      { once: true },
    );
  }
  group.add(ctl);
  const held = group;
  return () => held.delete(ctl);
}

/** Keyed by the caller's signal, so the whole group is collected when the turn is. */
const links = new WeakMap<AbortSignal, Set<AbortController>>();

/**
 * Node buries the useful code: `TypeError: fetch failed` with the real reason two `cause` levels
 * down, and sometimes inside an AggregateError when a host resolves to several addresses.
 */
function errorCode(err: unknown, depth = 0): string | undefined {
  if (!err || typeof err !== "object" || depth > 5) return undefined;
  const e = err as { code?: unknown; errors?: unknown[]; cause?: unknown };
  if (typeof e.code === "string") return e.code;
  if (Array.isArray(e.errors)) {
    for (const inner of e.errors) {
      const c = errorCode(inner, depth + 1);
      if (c) return c;
    }
  }
  return errorCode(e.cause, depth + 1);
}

function explain(
  err: unknown,
  url: string,
  label: string,
  timeoutMs: number,
  cancelledByCaller: boolean,
  timedOut: boolean,
): Error {
  if (cancelledByCaller) return new HttpError(`${label} cancelled`, undefined, url);
  const e = err as { name?: string; cause?: { message?: string } };
  const code = errorCode(err);
  const host = safeHost(url);

  if (code === "ECONNREFUSED" || code === "ENOTFOUND" || code === "EAI_AGAIN") {
    return new HttpError(
      `Cannot reach ${host}. Is the model server running? (Ollama: \`ollama serve\`; LM Studio: enable the local server.)`,
      undefined,
      url,
    );
  }
  if (code === "CERT_HAS_EXPIRED" || code === "UNABLE_TO_VERIFY_LEAF_SIGNATURE" || code === "SELF_SIGNED_CERT_IN_CHAIN") {
    return new HttpError(`TLS certificate rejected for ${host}: ${code}. A corporate proxy usually needs its CA added to NODE_EXTRA_CA_CERTS.`, undefined, url);
  }
  if (timedOut || e?.name === "AbortError" || code === "UND_ERR_HEADERS_TIMEOUT" || code === "UND_ERR_CONNECT_TIMEOUT") {
    return new HttpError(
      `${host} sent nothing within ${timeoutMs >= 1000 ? `${Math.round(timeoutMs / 1000)}s` : `${timeoutMs}ms`}. On a first request this is usually the model loading into memory — try again, or keep it warm.`,
      undefined,
      url,
    );
  }
  // `fetch failed` on its own says nothing; the cause usually carries the sentence that does.
  const detail = e?.cause?.message ?? (err as Error)?.message ?? String(err);
  return new HttpError(`${label} to ${host} failed: ${detail}`, undefined, url);
}

function safeHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}
