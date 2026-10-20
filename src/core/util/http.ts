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

/**
 * What kind of failure, read by code; the message is for people, in their language. Code used to
 * match the English sentence ("sent nothing within"), which is what kept the message in English.
 */
import { t } from "../../shared/i18n.js";
export type HttpFailure = "cancelled" | "unreachable" | "tls" | "timeout" | "failed";

export class HttpError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly url?: string,
    readonly kind?: HttpFailure,
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
  // No deadline at all when there is none to keep (`Infinity`): Node turns an over-large delay into
  // ONE millisecond, which would abort every such request at once.
  const timer =
    Number.isFinite(timeoutMs) && timeoutMs > 0
      ? setTimeout(() => {
          timedOut = true;
          ctl.abort(new Error("timeout"));
        }, timeoutMs)
      : undefined;
  const unlink = linkAbort(signal ?? undefined, ctl);
  try {
    try {
      return await fetch(url, { ...init, signal: ctl.signal });
    } catch (err) {
      // Sent again, once, on a fresh connection — see `resetBeforeAnswer`.
      if (ctl.signal.aborted || !resetBeforeAnswer(err) || !(init.body === undefined || typeof init.body === "string")) throw err;
      return await fetch(url, { ...init, signal: ctl.signal });
    }
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
 * The connection was reset before a single byte of the answer came back.
 *
 * ⚠️ « chat vers ai.hivey.be a échoué : read ECONNRESET », with no trace on the gateway nor on the
 * server: Node keeps idle connections open to reuse them, and one the network or the far end had
 * quietly closed meanwhile fails the first request sent on it — before that request reached anybody.
 * Sent again at once on a new connection, it simply goes through. Only that: a refusal, a timeout or a
 * cancellation is not a reset, and a reset AFTER the answer began is the stream's business (see
 * `isConnectionDrop` in providers/openai.ts).
 */
export function resetBeforeAnswer(err: unknown): boolean {
  const e = err as { code?: string; message?: string; cause?: { code?: string; message?: string } };
  const codes = ["ECONNRESET", "EPIPE", "UND_ERR_SOCKET", "UND_ERR_CLOSED"];
  if (codes.includes(String(e?.code)) || codes.includes(String(e?.cause?.code))) return true;
  return /other side closed|socket hang up/i.test(`${e?.message ?? ""} ${e?.cause?.message ?? ""}`);
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
  if (cancelledByCaller) return new HttpError(t("{0} cancelled", label), undefined, url, "cancelled");
  const e = err as { name?: string; cause?: { message?: string } };
  const code = errorCode(err);
  const host = safeHost(url);

  if (code === "ECONNREFUSED" || code === "ENOTFOUND" || code === "EAI_AGAIN") {
    return new HttpError(
      t("Cannot reach {0}. Is the model server running? (Ollama: `ollama serve`; LM Studio: enable the local server.)", host),
      undefined,
      url,
      "unreachable",
    );
  }
  if (code === "CERT_HAS_EXPIRED" || code === "UNABLE_TO_VERIFY_LEAF_SIGNATURE" || code === "SELF_SIGNED_CERT_IN_CHAIN") {
    return new HttpError(
      t("TLS certificate rejected for {0}: {1}. A corporate proxy usually needs its CA added to NODE_EXTRA_CA_CERTS.", host, code),
      undefined,
      url,
      "tls",
    );
  }
  if (timedOut || e?.name === "AbortError" || code === "UND_ERR_HEADERS_TIMEOUT" || code === "UND_ERR_CONNECT_TIMEOUT") {
    return new HttpError(
      t(
        "{0} sent nothing within {1}. On a first request this is usually the model loading into memory — try again, or keep it warm.",
        host,
        timeoutMs >= 1000 ? `${Math.round(timeoutMs / 1000)} s` : `${timeoutMs} ms`,
      ),
      undefined,
      url,
      "timeout",
    );
  }
  // `fetch failed` on its own says nothing; the cause usually carries the sentence that does.
  const detail = e?.cause?.message ?? (err as Error)?.message ?? String(err);
  return new HttpError(t("{0} to {1} failed: {2}", label, host, detail), undefined, url, "failed");
}

function safeHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}
