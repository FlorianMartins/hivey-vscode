// Shipping the egress ledger to wherever the organisation already watches.
//
// Two kinds of test. The formats are checked against their specifications, because a message a
// collector mis-parses is worse than one it rejects — it looks fine and the fields are wrong. And
// the queue is checked for the one property that makes a log shipper worth having: a row is never
// lost quietly, and an unsent row stays visible.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  EXPORTED_FIELDS,
  SYSLOG_PRIORITY,
  exportable,
  otlpLogs,
  syslogFrame,
  syslogMessage,
} from "../src/core/siem/format.js";
import { QUEUE_MAX, SiemQueue, stuckFor, type QueueStore } from "../src/core/siem/queue.js";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/** A ledger row, as `extension/egress.ts` writes one. */
const ROW = {
  seq: 42,
  prev: "a".repeat(64),
  hash: "b".repeat(64),
  at: Date.UTC(2026, 9, 3, 11, 30, 0),
  provider: "openrouter",
  host: "openrouter.ai",
  model: "anthropic/claude-sonnet-4",
  promptTokens: 1234,
  completionTokens: 567,
  cachedTokens: 0,
  usd: 0.0123,
  redactions: 3,
  redactionSummary: "EMAIL x2, HOST x1",
  images: 1,
};

// ── No content, ever ─────────────────────────────────────────────────────────────────────────────

test("the exported row is built from an allow-list, so a new field does not escape by default", () => {
  // THE rule. A denylist would let the field somebody adds next month through — and the field
  // somebody adds next month is exactly the one with a file path in it.
  const withContent = {
    ...ROW,
    prompt: "the customer DURAND owes 12 000 EUR",
    answer: "here is the corrected RPG",
    attachments: ["/home/fmartins/clients/durand/contrat.docx"],
    redactedValues: ["durand@example.com"],
  };
  const out = exportable(withContent) as Record<string, unknown>;
  for (const leaked of ["prompt", "answer", "attachments", "redactedValues"]) {
    assert.equal(leaked in out, false, `${leaked} reached the SIEM`);
  }
  assert.deepEqual(Object.keys(out).sort(), [...EXPORTED_FIELDS].sort());
});

test("no formatter can emit content either, whatever the row carries", () => {
  const withContent = { ...ROW, prompt: "SECRET-PROMPT-TEXT", attachments: ["/home/me/clients/x.docx"] };
  const syslog = syslogMessage(withContent);
  const otlp = JSON.stringify(otlpLogs([withContent]));
  for (const text of [syslog, otlp]) {
    assert.equal(text.includes("SECRET-PROMPT-TEXT"), false);
    assert.equal(text.includes("clients"), false);
  }
});

test("an absent field is absent, not zero or empty", () => {
  const { images, ...withoutImages } = ROW;
  void images;
  const out = exportable(withoutImages);
  assert.equal("images" in out, false, "a row that sent no image must not grow a column of noughts");
  // And a zero that IS a measurement stays.
  assert.equal(exportable(ROW).cachedTokens, 0);
});

// ── RFC 5424 ─────────────────────────────────────────────────────────────────────────────────────

test("the message has the shape RFC 5424 describes", () => {
  const message = syslogMessage(ROW, { host: "ws-0142", user: "u-7781" }, 4242);
  assert.match(
    message,
    /^<110>1 2026-10-03T11:30:00\.000Z ws-0142 hivey-code 4242 egress \[hiveyCode@0 /,
    message,
  );
  assert.equal(SYSLOG_PRIORITY, 110, "facility 13 (log audit) × 8 + severity 6 (informational)");
  assert.match(message, /seq="42"/);
  assert.match(message, /model="anthropic\/claude-sonnet-4"/);
  assert.match(message, /user="u-7781"/);
  assert.match(message, /\]$/, "nothing after the structured data: that is where content would go");
});

test("the timestamp comes from the row, not from the clock", () => {
  // These ship from a queue, possibly days later. A collector stamping them on arrival would put a
  // Friday's traffic on Monday morning.
  const message = syslogMessage({ ...ROW, at: Date.UTC(2020, 0, 2, 3, 4, 5) });
  assert.match(message, /2020-01-02T03:04:05\.000Z/);
});

test("an absent host or user is RFC 5424's NILVALUE, not an empty field", () => {
  const message = syslogMessage(ROW);
  assert.match(message, /^<110>1 \S+ - hivey-code /, message);
  assert.equal(/user="/.test(message), false, "an unconfigured identity must not become an empty one");
});

test("a header field cannot shift every field after it", () => {
  // A space in a header field is how a collector ends up reading the app name as the host.
  const message = syslogMessage(ROW, { host: "my machine\nwith a newline" });
  const header = message.slice(0, message.indexOf("["));
  assert.equal(header.split(" ").length, 7, header);
  assert.equal(/\n/.test(message), false);
});

test("the three characters RFC 5424 reserves inside a parameter are escaped", () => {
  // Getting this wrong does not produce a rejected message. It produces one the collector parses
  // into the WRONG FIELDS, which looks fine.
  const message = syslogMessage({ ...ROW, model: 'a"b\\c]d' });
  assert.match(message, /model="a\\"b\\\\c\\\]d"/, message);
});

test("the frame counts BYTES, not characters", () => {
  // A model name with a non-ASCII character makes `string.length` and the byte count disagree, and
  // then the collector reads the start of the next message as the end of this one.
  const message = syslogMessage({ ...ROW, model: "modèle-é" });
  const frame = syslogFrame(message);
  const space = frame.indexOf(0x20);
  const declared = Number(frame.subarray(0, space).toString("ascii"));
  assert.equal(declared, Buffer.byteLength(message, "utf8"));
  assert.notEqual(declared, message.length, "this test is pointless if the two happen to be equal");
  assert.equal(frame.length, space + 1 + declared);
});

// ── OTLP ─────────────────────────────────────────────────────────────────────────────────────────

test("the OTLP body carries the rows as attributes, and the body names only the event", () => {
  const payload = otlpLogs([ROW], { host: "ws-0142", user: "u-7781" }, "0.75.0") as {
    resourceLogs: Array<{
      resource: { attributes: Array<{ key: string; value: { stringValue: string } }> };
      scopeLogs: Array<{ logRecords: Array<{ timeUnixNano: string; body: { stringValue: string }; attributes: Array<{ key: string; value: Record<string, unknown> }> }> }>;
    }>;
  };
  const resource = payload.resourceLogs[0]!.resource.attributes;
  assert.deepEqual(resource.find((a) => a.key === "service.name")?.value.stringValue, "hivey-code");
  assert.deepEqual(resource.find((a) => a.key === "service.version")?.value.stringValue, "0.75.0");
  assert.deepEqual(resource.find((a) => a.key === "enduser.id")?.value.stringValue, "u-7781");

  const record = payload.resourceLogs[0]!.scopeLogs[0]!.logRecords[0]!;
  assert.equal(record.body.stringValue, "egress", "the body must name the event and carry nothing about it");
  assert.equal(record.timeUnixNano, `${ROW.at}000000`);
  const attrs = new Map(record.attributes.map((a) => [a.key, a.value]));
  assert.deepEqual(attrs.get("promptTokens"), { doubleValue: 1234 });
  assert.deepEqual(attrs.get("model"), { stringValue: "anthropic/claude-sonnet-4" });
  assert.equal(attrs.has("at"), false, "the timestamp is the record's, not an attribute");
});

test("an unconfigured identity leaves the attribute out rather than sending an empty one", () => {
  const payload = JSON.stringify(otlpLogs([ROW]));
  assert.equal(payload.includes("enduser.id"), false);
  assert.equal(payload.includes("host.name"), false);
});

// ── The queue ────────────────────────────────────────────────────────────────────────────────────

function store(): QueueStore & { text: () => string | undefined } {
  let text: string | undefined;
  return { read: () => text, write: (t) => void (text = t), text: () => text };
}

test("a row survives the editor closing", () => {
  const disk = store();
  new SiemQueue(disk).enqueue(ROW);
  // A second queue over the same storage is what reopening the editor looks like.
  const reopened = new SiemQueue(disk);
  assert.equal(reopened.depth(), 1);
  assert.deepEqual(reopened.pending()[0]?.row, ROW);
});

test("a row is removed only once the collector has taken it", () => {
  const queue = new SiemQueue(store());
  queue.enqueue(ROW);
  const batch = queue.pending();
  // Sending failed: the row stays, and it remembers why.
  queue.failed(batch, "ECONNREFUSED 10.0.0.9:6514");
  assert.equal(queue.depth(), 1);
  assert.equal(queue.pending()[0]?.attempts, 1);
  assert.match(queue.pending()[0]?.lastError ?? "", /ECONNREFUSED/);
  // Then it worked.
  queue.acknowledge(batch, 1_700_000_000_000);
  assert.equal(queue.depth(), 0);
  assert.equal(queue.lastSentAt(), 1_700_000_000_000);
});

test("acknowledging removes the rows that were sent, not the first n", () => {
  // A row may have been enqueued while the batch was in flight. Removing "the first n" would drop a
  // row that was never sent — a gap in an audit log, caused by the shipper.
  const queue = new SiemQueue(store());
  queue.enqueue({ ...ROW, seq: 1, hash: "h1" });
  const batch = queue.pending();
  queue.enqueue({ ...ROW, seq: 2, hash: "h2" });
  queue.acknowledge(batch);
  assert.equal(queue.depth(), 1);
  assert.equal(queue.pending()[0]?.row["seq"], 2);
});

test("an unsent row stays visible, with how long it has been stuck", () => {
  // The sentence this module exists to make possible: "the last 12 rows have not reached the
  // collector since Tuesday".
  const queue = new SiemQueue(store());
  queue.enqueue(ROW, 1_000);
  assert.equal(stuckFor(queue, 61_000), 60_000);
  assert.equal(queue.depth(), 1);
  queue.acknowledge(queue.pending());
  assert.equal(stuckFor(queue, 61_000), undefined, "nothing waiting is not the same as waiting zero");
});

test("the queue is bounded, and dropping is counted rather than silent", () => {
  const queue = new SiemQueue(store());
  for (let i = 0; i < QUEUE_MAX; i++) assert.equal(queue.enqueue({ seq: i, hash: `h${i}` }), true);
  assert.equal(queue.dropped(), 0);
  assert.equal(queue.enqueue({ seq: QUEUE_MAX, hash: "over" }), false, "the caller must be told a row was lost");
  assert.equal(queue.depth(), QUEUE_MAX);
  assert.equal(queue.dropped(), 1);
  // And only an operator acknowledging it clears the count: sending more does not make the gap
  // disappear from the record.
  queue.acknowledge(queue.pending(10));
  assert.equal(queue.dropped(), 1);
  queue.acknowledgeDropped();
  assert.equal(queue.dropped(), 0);
});

test("a batch is bounded, so one flush cannot be the whole queue", () => {
  const queue = new SiemQueue(store());
  for (let i = 0; i < 500; i++) queue.enqueue({ seq: i, hash: `h${i}` });
  assert.equal(queue.pending().length, 200);
  assert.equal(queue.pending(10).length, 10);
});

test("a corrupt spool file costs the queue, not the extension", () => {
  // Throwing on startup would stop the editor because a log shipper could not read its spool.
  const disk = store();
  disk.write("{not json");
  const queue = new SiemQueue(disk);
  assert.equal(queue.depth(), 0);
  queue.enqueue(ROW);
  assert.equal(queue.depth(), 1);
});

// ── Off by default, and wired ────────────────────────────────────────────────────────────────────

test("every SIEM setting ships switched off or empty", () => {
  // This sends a record of one machine's activity to a system with its own operators, its own
  // retention and its own export. It is right on a managed workstation and wrong on a laptop, and
  // nothing in the code can tell which it is on — so an operator switches it on.
  const manifest = JSON.parse(readFileSync("package.json", "utf8")) as {
    contributes: { configuration: Array<{ properties: Record<string, { default: unknown }> }> };
  };
  const props = Object.assign({}, ...manifest.contributes.configuration.map((b) => b.properties)) as Record<
    string,
    { default: unknown }
  >;
  assert.equal(props["hiveyCode.siem.transport"]?.default, "off");
  assert.equal(props["hiveyCode.siem.host"]?.default, "");
  assert.equal(props["hiveyCode.siem.url"]?.default, "");
  // ⚠️ The identity is empty, and nothing fills it in.
  assert.equal(props["hiveyCode.siem.userId"]?.default, "");
  // And the certificate IS checked by default.
  assert.equal(props["hiveyCode.siem.rejectUnauthorized"]?.default, true);
});

test("the identity is never discovered from the machine", () => {
  // An identifier the operator chose is a pseudonym they can resolve and an auditor cannot. An
  // e-mail address taken from a git configuration is personal data nobody consented to shipping,
  // in a system with its own retention.
  const code = readFileSync(join("src", "extension", "siem.ts"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
  for (const discovered of ["user.email", "git config", "userInfo", "USERNAME", "os.userInfo", "env.LOGNAME"]) {
    assert.equal(code.includes(discovered), false, `the shipper reaches for ${discovered}`);
  }
  assert.match(code, /settings\.userId \? \{ user: settings\.userId \} : \{\}/, "the identity is not the configured one");
});

test("the shipper is handed every ledger row, and cannot break the request that made it", () => {
  const egress = readFileSync(join("src", "extension", "egress.ts"), "utf8");
  assert.match(egress, /this\.onRecord\?\.\(/, "ledger rows never reach the shipper");
  // A log shipper may not fail a request that has already happened.
  assert.match(egress, /try \{\s*\n\s*this\.onRecord\?\./);
  const wiring = readFileSync(join("src", "extension", "extension.ts"), "utf8");
  assert.match(wiring, /gate\.onRecord = \(row\) => siem\.offer\(row\)/, "the shipper is never connected");
});
