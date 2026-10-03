// Getting the rows to the collector, over the two things organisations actually run.
//
// Both transports are written against their specifications with `node:tls` and the project's own
// HTTP helper, for the reason ADR-0004 gives: a log shipper is precisely the kind of library that
// turns out to buffer in memory, lose the spool on exit, or phone home. Node's built-ins are
// allowed; an npm package is not.
//
// The shape of both functions is the same and it is deliberate: they either succeed for the whole
// batch or they report why, and they never swallow. The caller — `ship()` — is what decides whether
// a failure means "keep the rows and try later", and that decision has to be in one place.

import { connect as tlsConnect, type ConnectionOptions } from "node:tls";

export interface SyslogTarget {
  host: string;
  port: number;
  /**
   * The collector's CA, in PEM, when it is not one the machine already trusts.
   *
   * The ordinary case inside a bank: the collector's certificate is signed by the company's own
   * authority, which is in the OS store on a managed machine and is not on a developer's laptop.
   */
  ca?: string;
  /**
   * Whether to check the certificate at all. True — checking — is the only default.
   *
   * ⚠️ The setting exists because somebody will have a self-signed collector and a deadline, and
   * the alternative to offering it is them disabling the whole feature. It is named for what it
   * does, it is off, and the sovereignty report states it when it is on: a log stream that can be
   * intercepted is a log stream whose contents can be chosen.
   */
  rejectUnauthorized?: boolean;
  timeoutMs?: number;
}

export interface SendResult {
  ok: boolean;
  /** Why it failed, in the words the panel shows and the queue remembers. */
  why?: string;
}

const DEFAULT_TIMEOUT = 10_000;

/**
 * One connection, every frame, then a clean close.
 *
 * A connection per flush rather than a kept-open socket. A long-lived TLS socket to a collector is
 * a thing that silently half-dies — the kernel has it, the collector forgot it — and the failure
 * mode is rows that write successfully into nothing. Reconnecting costs a handshake per flush and
 * buys the guarantee that a successful write reached a collector that was there a moment ago.
 *
 * `ok` is reported only after the socket has drained AND closed without error. Resolving on
 * `write()` returning true would acknowledge rows that are still in a buffer.
 */
export function sendSyslogTls(frames: Buffer[], target: SyslogTarget): Promise<SendResult> {
  return new Promise<SendResult>((resolve) => {
    if (!frames.length) {
      resolve({ ok: true });
      return;
    }
    let settled = false;
    const finish = (result: SendResult) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    const options: ConnectionOptions = {
      host: target.host,
      port: target.port,
      // RFC 5425 names the port and the fact that this is TLS; nothing here negotiates downwards.
      rejectUnauthorized: target.rejectUnauthorized !== false,
      ...(target.ca ? { ca: target.ca } : {}),
      // Checked against the name the operator configured. A collector reached by IP with a
      // certificate for a name is a mismatch, and that is the correct answer rather than an
      // inconvenience to work around.
      servername: /^[\d.]+$/.test(target.host) ? undefined : target.host,
    };

    let socket: ReturnType<typeof tlsConnect>;
    try {
      socket = tlsConnect(options);
    } catch (err) {
      finish({ ok: false, why: reason(err) });
      return;
    }

    // The one state machine in this function, and it exists because of a case the first version got
    // wrong: a collector that completes the handshake and then hangs up. The write succeeds — into
    // the kernel's buffer — and the callback fires, so resolving there reports a success for rows
    // that reached nothing. So nothing is acknowledged until the socket has CLOSED, cleanly, after
    // the whole batch went out.
    //
    // ⚠️ Said plainly, because it bounds the claim: syslog has no application-level
    // acknowledgement. "The connection completed without error" is the strongest thing knowable
    // here, and it is what `ok` means. A collector that accepted the bytes and dropped them on the
    // floor is indistinguishable from one that stored them, over any syslog transport.
    let wrote = false;

    socket.setTimeout(target.timeoutMs ?? DEFAULT_TIMEOUT, () => {
      finish({ ok: false, why: `timed out after ${target.timeoutMs ?? DEFAULT_TIMEOUT} ms` });
      socket.destroy();
    });
    socket.on("error", (err) => {
      finish({ ok: false, why: reason(err) });
      socket.destroy();
    });
    socket.on("close", (hadError: boolean) => {
      if (hadError) {
        finish({ ok: false, why: "the connection ended in error" });
        return;
      }
      finish(
        wrote
          ? { ok: true }
          : { ok: false, why: "the collector closed the connection before the batch had been sent" },
      );
    });
    socket.on("secureConnect", () => {
      if (!socket.authorized && options.rejectUnauthorized !== false) {
        // Belt and braces: `rejectUnauthorized` already raises `error`, and relying on one check
        // for "do not send audit logs to an unverified host" is one check too few.
        finish({ ok: false, why: `certificate not accepted: ${socket.authorizationError ?? "unknown reason"}` });
        socket.destroy();
        return;
      }
      socket.write(Buffer.concat(frames), (err) => {
        if (err) {
          finish({ ok: false, why: reason(err) });
          socket.destroy();
          return;
        }
        // `end` flushes and its callback fires once the FIN is out. That marks the batch as written;
        // `close` is what decides whether it counts.
        socket.end(() => {
          wrote = true;
        });
      });
    });
  });
}

export interface OtlpTarget {
  /** The collector's logs endpoint, for example `https://otel.example.com/v1/logs`. */
  url: string;
  /** Extra headers the collector needs — an API key, a tenant. Supplied by the operator. */
  headers?: Record<string, string>;
  timeoutMs?: number;
}

/** The HTTP call, injected so this module stays testable and so there is one HTTP path in the product. */
export interface Post {
  (input: {
    url: string;
    method: "POST";
    headers: Record<string, string>;
    body: string;
    timeoutMs: number;
  }): Promise<{ status: number; body: string }>;
}

/**
 * OTLP/HTTP, JSON encoding.
 *
 * 2xx is success. A 4xx is a request the collector will never accept, and retrying it forever is
 * how a queue stops moving — so it is reported as a failure the caller can see, with the status in
 * the reason, rather than retried silently.
 */
export async function sendOtlp(body: unknown, target: OtlpTarget, post: Post): Promise<SendResult> {
  try {
    const response = await post({
      url: target.url,
      method: "POST",
      headers: { "content-type": "application/json", ...(target.headers ?? {}) },
      body: JSON.stringify(body),
      timeoutMs: target.timeoutMs ?? DEFAULT_TIMEOUT,
    });
    if (response.status >= 200 && response.status < 300) return { ok: true };
    return { ok: false, why: `the collector answered HTTP ${response.status}: ${response.body.slice(0, 120)}` };
  } catch (err) {
    return { ok: false, why: reason(err) };
  }
}

function reason(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  return message.trim().split("\n")[0]?.slice(0, 200) || "no reason given";
}
