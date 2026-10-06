// The transports, against a real TLS collector on this machine.
//
// The criteria for this chantier name four cases and they are the right four: a send that works, the
// collector going away, the queue recovering afterwards, and a certificate that must be refused.
// Three of them are about failure, which is the point — a log shipper is judged entirely on what it
// does when the collector is down.
//
// ⚠️ The certificate is generated with `openssl` at test time rather than committed. A private key
// in the repository would be a private key in the repository, and the secret scanner is right to
// refuse one. If `openssl` is missing the test FAILS rather than skipping: a test that passes when
// it did not run is worse than no test.

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { lookup } from "node:dns/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer, type TLSSocket } from "node:tls";
import type { AddressInfo } from "node:net";
import { sendOtlp, sendSyslogTls, type Post } from "../src/core/siem/transport.js";
import { syslogFrame, syslogMessage } from "../src/core/siem/format.js";
import { SiemQueue, type QueueStore } from "../src/core/siem/queue.js";

const ROW = {
  seq: 1,
  prev: "0".repeat(64),
  hash: "h1",
  at: Date.UTC(2026, 9, 3, 11, 0, 0),
  provider: "openrouter",
  host: "openrouter.ai",
  model: "m",
  promptTokens: 10,
  completionTokens: 2,
  cachedTokens: 0,
  usd: 0.001,
  redactions: 0,
  redactionSummary: "",
};

/** A certificate for `localhost`, and a second one for a different name. */
function certificates(): { dir: string; cert: string; key: string; otherCert: string; otherKey: string } {
  const dir = mkdtempSync(join(tmpdir(), "hivey-siem-tls-"));
  const run = (args: string[]) => execFileSync("openssl", args, { stdio: "pipe" });
  try {
    run(["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", join(dir, "key.pem"), "-out", join(dir, "cert.pem"),
         "-days", "2", "-subj", "/CN=localhost", "-addext", "subjectAltName=DNS:localhost,IP:127.0.0.1"]);
    run(["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", join(dir, "other-key.pem"), "-out", join(dir, "other-cert.pem"),
         "-days", "2", "-subj", "/CN=somewhere-else", "-addext", "subjectAltName=DNS:somewhere-else"]);
  } catch (err) {
    throw new Error(
      `this test needs openssl to make a throwaway certificate, and it could not: ${(err as Error).message}. ` +
        "A committed private key is not the alternative.",
    );
  }
  return {
    dir,
    cert: readFileSync(join(dir, "cert.pem"), "utf8"),
    key: readFileSync(join(dir, "key.pem"), "utf8"),
    otherCert: readFileSync(join(dir, "other-cert.pem"), "utf8"),
    otherKey: readFileSync(join(dir, "other-key.pem"), "utf8"),
  };
}

/**
 * A collector that remembers what it was told, and can be made to hang up at either moment.
 *
 * The two moments are not the same case, and the difference is the whole of what a syslog client
 * can honestly claim — see the tests below.
 */
async function collector(options: {
  cert: string;
  key: string;
  hangUp?: "before-handshake" | "after-handshake";
}): Promise<{ port: number; received: () => string; close: () => void }> {
  const chunks: Buffer[] = [];
  const server = createServer({ cert: options.cert, key: options.key }, (socket: TLSSocket) => {
    if (options.hangUp === "after-handshake") {
      socket.destroy();
      return;
    }
    socket.on("data", (d) => chunks.push(d));
    socket.on("error", () => {});
  });
  if (options.hangUp === "before-handshake") {
    server.on("connection", (raw) => raw.destroy());
  }
  // ⚠️ Listen where the name the tests use actually points, not where loopback is spelled in v4.
  // Every test here connects to "localhost" — on purpose, because the certificate carries
  // `DNS:localhost` and verifying that name is half of what these tests assert. Binding to
  // 127.0.0.1 while the client resolves "localhost" to ::1 cost five red tests on the Node 18
  // runner and nothing anywhere else: Node 20 added Happy Eyeballs (`autoSelectFamily`) by
  // default, so it quietly retried over IPv4 and the mismatch stayed invisible. The CI failure
  // read `connect ECONNREFUSED ::1:35751` — the collector was up, on the other stack.
  const { address } = await lookup("localhost");
  await new Promise<void>((resolve) => server.listen(0, address, resolve));
  return {
    port: (server.address() as AddressInfo).port,
    received: () => Buffer.concat(chunks).toString("utf8"),
    close: () => server.close(),
  };
}

function store(): QueueStore {
  let text: string | undefined;
  return { read: () => text, write: (t) => void (text = t) };
}

// ── Sending ──────────────────────────────────────────────────────────────────────────────────────

test("a batch reaches a TLS collector, framed as RFC 5425 wants it", async () => {
  const certs = certificates();
  const siem = await collector({ cert: certs.cert, key: certs.key });
  try {
    const frames = [ROW, { ...ROW, seq: 2, hash: "h2" }].map((row) => syslogFrame(syslogMessage(row, { host: "ws-1" })));
    const result = await sendSyslogTls(frames, { host: "localhost", port: siem.port, ca: certs.cert });
    assert.equal(result.ok, true, result.why);
    // Give the server a moment to have read what was written before the FIN.
    for (let i = 0; i < 50 && !siem.received().includes("seq=\"2\""); i++) await new Promise((r) => setTimeout(r, 20));
    const text = siem.received();
    assert.match(text, /^\d+ <110>1 /, text.slice(0, 80));
    assert.match(text, /seq="1"/);
    assert.match(text, /seq="2"/);
    // Two frames, each prefixed by its own byte count: the second starts right after the first.
    const first = Number(text.slice(0, text.indexOf(" ")));
    const second = text.slice(text.indexOf(" ") + 1 + first);
    assert.match(second, /^\d+ <110>1 /, second.slice(0, 40));
  } finally {
    siem.close();
    rmSync(certs.dir, { recursive: true, force: true });
  }
});

test("an empty batch is a success that opens no connection", async () => {
  // Otherwise an idle editor hands a collector a handshake a minute for nothing.
  const result = await sendSyslogTls([], { host: "127.0.0.1", port: 1 });
  assert.deepEqual(result, { ok: true });
});

// ── The collector going away ─────────────────────────────────────────────────────────────────────

test("a collector that is not there is a failure with a reason, not a throw", async () => {
  const result = await sendSyslogTls([syslogFrame(syslogMessage(ROW))], {
    host: "127.0.0.1",
    // Port 1 on loopback: refused immediately rather than after a timeout.
    port: 1,
    rejectUnauthorized: false,
    timeoutMs: 3000,
  });
  assert.equal(result.ok, false);
  assert.ok(result.why, "a failure with no reason tells the queue nothing");
});

test("a collector that hangs up during the handshake is a failure", async () => {
  // The detectable hang-up, and the common one in practice: a firewall that accepts the TCP
  // connection and drops the TLS, a collector restarting, a load balancer with no backend.
  const certs = certificates();
  const siem = await collector({ cert: certs.cert, key: certs.key, hangUp: "before-handshake" });
  try {
    const result = await sendSyslogTls([syslogFrame(syslogMessage(ROW))], {
      host: "localhost",
      port: siem.port,
      ca: certs.cert,
      timeoutMs: 3000,
    });
    assert.equal(result.ok, false, "rows were acknowledged to a collector that never completed a handshake");
    assert.ok(result.why, "a failure with no reason tells the queue nothing");
  } finally {
    siem.close();
    rmSync(certs.dir, { recursive: true, force: true });
  }
});

test("⚠️ a collector that completes the handshake and then discards the bytes reads as a success", async () => {
  // THE LIMIT, recorded rather than hidden. Syslog has no application-level acknowledgement: the
  // bytes go into the kernel's buffer, the handshake succeeded, and nothing on the wire
  // distinguishes a collector that stored the rows from one that dropped them on the floor. Over
  // any syslog transport, "ok" can only ever mean "the connection completed without error".
  //
  // This test exists so that the claim stays bounded. If somebody later makes `sendSyslogTls`
  // promise more than that, this is where the promise gets examined — and the honest way to
  // actually deliver it is a transport with an acknowledgement, which is what OTLP's HTTP status
  // gives and what the OTLP tests below check.
  const certs = certificates();
  const siem = await collector({ cert: certs.cert, key: certs.key, hangUp: "after-handshake" });
  try {
    const result = await sendSyslogTls([syslogFrame(syslogMessage(ROW))], {
      host: "localhost",
      port: siem.port,
      ca: certs.cert,
      timeoutMs: 3000,
    });
    assert.equal(result.ok, true, "if this now fails, the client learned to tell the difference — say so and reword the limit");
  } finally {
    siem.close();
    rmSync(certs.dir, { recursive: true, force: true });
  }
});

// ── A certificate that must be refused ───────────────────────────────────────────────────────────

test("a certificate signed by nobody we trust is refused", async () => {
  const certs = certificates();
  const siem = await collector({ cert: certs.otherCert, key: certs.otherKey });
  try {
    const result = await sendSyslogTls([syslogFrame(syslogMessage(ROW))], {
      host: "localhost",
      port: siem.port,
      // The CA we pinned is the OTHER one, so this collector cannot be verified.
      ca: certs.cert,
      timeoutMs: 3000,
    });
    assert.equal(result.ok, false, "audit logs were sent to a host that could not be verified");
    assert.match(result.why ?? "", /certificate|self[- ]signed|unable to verify|not accepted/i, result.why);
  } finally {
    siem.close();
    rmSync(certs.dir, { recursive: true, force: true });
  }
});

test("the check can be turned off deliberately, and only deliberately", async () => {
  // Somebody will have a self-signed collector and a deadline, and the alternative to offering this
  // is them switching the whole feature off. It is named for what it does and it is not the default.
  const certs = certificates();
  const siem = await collector({ cert: certs.otherCert, key: certs.otherKey });
  try {
    const refused = await sendSyslogTls([syslogFrame(syslogMessage(ROW))], { host: "localhost", port: siem.port, timeoutMs: 3000 });
    assert.equal(refused.ok, false, "the default must be to check");
    const allowed = await sendSyslogTls([syslogFrame(syslogMessage(ROW))], {
      host: "localhost",
      port: siem.port,
      rejectUnauthorized: false,
      timeoutMs: 3000,
    });
    assert.equal(allowed.ok, true, allowed.why);
  } finally {
    siem.close();
    rmSync(certs.dir, { recursive: true, force: true });
  }
});

// ── Recovery ─────────────────────────────────────────────────────────────────────────────────────

test("rows survive an outage and go out when the collector comes back", async () => {
  const certs = certificates();
  const queue = new SiemQueue(store());
  queue.enqueue(ROW);
  queue.enqueue({ ...ROW, seq: 2, hash: "h2" });

  try {
    // The collector is down.
    let batch = queue.pending();
    let result = await sendSyslogTls(batch.map((q) => syslogFrame(syslogMessage(q.row))), {
      host: "127.0.0.1",
      port: 1,
      rejectUnauthorized: false,
      timeoutMs: 3000,
    });
    assert.equal(result.ok, false);
    queue.failed(batch, result.why ?? "");
    assert.equal(queue.depth(), 2, "an outage must not lose rows");
    assert.equal(queue.pending()[0]?.attempts, 1);

    // And back up.
    const siem = await collector({ cert: certs.cert, key: certs.key });
    try {
      batch = queue.pending();
      result = await sendSyslogTls(batch.map((q) => syslogFrame(syslogMessage(q.row))), {
        host: "localhost",
        port: siem.port,
        ca: certs.cert,
      });
      assert.equal(result.ok, true, result.why);
      queue.acknowledge(batch);
      assert.equal(queue.depth(), 0);
      for (let i = 0; i < 50 && !siem.received().includes('seq="2"'); i++) await new Promise((r) => setTimeout(r, 20));
      assert.match(siem.received(), /seq="1"/);
      assert.match(siem.received(), /seq="2"/);
    } finally {
      siem.close();
    }
  } finally {
    rmSync(certs.dir, { recursive: true, force: true });
  }
});

// ── OTLP ─────────────────────────────────────────────────────────────────────────────────────────

test("OTLP: 2xx is success, and everything else is a failure that says what came back", async () => {
  const calls: Array<{ url: string; body: string; headers: Record<string, string> }> = [];
  const post = (status: number, body = ""): Post => async (input) => {
    calls.push({ url: input.url, body: input.body, headers: input.headers });
    return { status, body };
  };
  assert.deepEqual(await sendOtlp({ a: 1 }, { url: "https://otel.example.com/v1/logs" }, post(200)), { ok: true });
  assert.deepEqual(await sendOtlp({ a: 1 }, { url: "https://otel.example.com/v1/logs" }, post(204)), { ok: true });

  const refused = await sendOtlp({ a: 1 }, { url: "https://otel.example.com/v1/logs" }, post(401, "no tenant"));
  assert.equal(refused.ok, false);
  assert.match(refused.why ?? "", /HTTP 401/);
  assert.match(refused.why ?? "", /no tenant/);

  assert.equal(calls[0]?.headers["content-type"], "application/json");
  assert.equal(calls[0]?.url, "https://otel.example.com/v1/logs");
});

test("OTLP: the operator's own headers ride along, and a thrown request is a reason", async () => {
  const seen: Array<Record<string, string>> = [];
  const ok: Post = async (input) => {
    seen.push(input.headers);
    return { status: 200, body: "" };
  };
  await sendOtlp({}, { url: "https://otel.example.com/v1/logs", headers: { "x-tenant": "cf" } }, ok);
  assert.equal(seen[0]?.["x-tenant"], "cf");

  const boom: Post = async () => {
    throw new Error("getaddrinfo ENOTFOUND otel.example.com");
  };
  const result = await sendOtlp({}, { url: "https://otel.example.com/v1/logs" }, boom);
  assert.equal(result.ok, false);
  assert.match(result.why ?? "", /ENOTFOUND/);
});
