// The egress ledger, in the two shapes a security operations centre can ingest.
//
// The local ledger already answers "what left this machine, when, to whom, and can you tell whether
// anybody edited the log". What it cannot do is reach the team whose job it is to look: a chained
// JSON array in one developer's workspace state is evidence nobody is watching. So the same rows go
// out, unchanged, to wherever the organisation already collects its logs.
//
// Two transports because organisations have one of two things and never both: a syslog collector
// that has been there for fifteen years, or an OpenTelemetry pipeline somebody built last year.
// Both are written by hand against their specifications (RFC 5424 and RFC 5425 for the first, the
// OTLP/HTTP JSON encoding for the second) because this extension ships no runtime dependency, and
// because a log shipper is exactly the kind of library that turns out to buffer in memory and lose
// the queue on exit.
//
// ⚠️ THE ONE RULE: NO CONTENT, EVER. Not the prompt, not the answer, not the redacted values, not
// the file names. A log of what you were trying to keep private is not a privacy feature, and a SIEM
// is the place where that mistake is hardest to undo — the data is now in a system with its own
// retention, its own operators and its own export. So the exported record is built from an
// ALLOW-LIST of fields rather than by removing the ones we think are sensitive, and a test holds
// that list: a field added to the ledger tomorrow does not reach the SIEM until somebody adds it
// here, deliberately.

/** Exactly the fields that may leave for a SIEM. An allow-list, not a denylist. */
export const EXPORTED_FIELDS = [
  "seq",
  "prev",
  "hash",
  "at",
  "provider",
  "host",
  "model",
  "promptTokens",
  "completionTokens",
  "cachedTokens",
  "usd",
  "redactions",
  "redactionSummary",
  "images",
] as const;

export type ExportedField = (typeof EXPORTED_FIELDS)[number];
export type Exported = Partial<Record<ExportedField, string | number>>;

/**
 * One ledger row, reduced to what may leave.
 *
 * Built by copying the allowed fields across, which is the only direction that is safe: a denylist
 * would let a field added next month through by default, and the field added next month is exactly
 * the one somebody put a file path in.
 */
export function exportable(entry: Record<string, unknown>): Exported {
  const out: Exported = {};
  for (const field of EXPORTED_FIELDS) {
    const value = entry[field];
    if (value === undefined || value === null) continue;
    if (typeof value === "number" || typeof value === "string") out[field] = value;
  }
  return out;
}

export interface Identity {
  /**
   * Who this machine's activity belongs to, as the organisation names people.
   *
   * ⚠️ Empty by default, and never defaulted to an e-mail address, a git identity or anything else
   * this extension could discover. An identifier the operator chose is a pseudonym they can resolve
   * and an auditor cannot; an e-mail address scraped from `git config` is personal data nobody
   * consented to shipping, in a system with its own retention. Empty means the field is simply
   * absent, and the sovereignty report says the operator has not configured one.
   */
  user?: string;
  /** The host name the collector should attribute this to. */
  host?: string;
}

// ── RFC 5424 ─────────────────────────────────────────────────────────────────────────────────────

/**
 * Facility 13, "log audit", severity 6, "informational".
 *
 * Not an arbitrary number: a collector routes on the facility, and these rows belong with the audit
 * stream rather than with the application noise. 13 × 8 + 6.
 */
export const SYSLOG_PRIORITY = 110;

const APP_NAME = "hivey-code";
/** RFC 5424's own registered id for the fields an implementation defines itself. */
const SD_ID = "hiveyCode@0";

/**
 * Escaped the way RFC 5424 requires inside a structured-data parameter value.
 *
 * Three characters and no others: `"`, `\` and `]`. Getting this wrong does not produce a rejected
 * message, it produces a message the collector parses into the WRONG FIELDS — which is worse,
 * because the log then looks fine.
 */
function sdValue(value: string | number): string {
  return String(value).replace(/([\\\]"])/g, "\\$1");
}

function sdName(name: string): string {
  // A parameter name may not contain `=`, a space, `]` or `"`. Ours never do; this is here so that a
  // field added later cannot quietly produce an unparseable message.
  return name.replace(/[=\s\]"]/g, "_");
}

/** `-` is RFC 5424's NILVALUE: a field that is absent, as opposed to empty. */
function orNil(value: string | undefined): string {
  const clean = (value ?? "").trim();
  if (!clean) return "-";
  // The header fields are printable ASCII without spaces. Anything else is replaced rather than
  // sent, because a space in a header field shifts every field after it.
  return clean.replace(/[^\x21-\x7e]/g, "_").slice(0, 48);
}

/**
 * One row as an RFC 5424 message.
 *
 * The timestamp comes from the row, not from the clock: these are shipped from a queue, possibly
 * days after the request, and a collector that stamps them on arrival would place a Friday's
 * traffic on Monday morning.
 */
export function syslogMessage(entry: Record<string, unknown>, identity: Identity = {}, procId = process.pid): string {
  const fields = exportable(entry);
  const at = typeof fields.at === "number" ? new Date(fields.at) : new Date();
  const timestamp = Number.isFinite(at.getTime()) ? at.toISOString() : new Date().toISOString();
  const params = Object.entries(fields)
    .filter(([key]) => key !== "at")
    .map(([key, value]) => `${sdName(key)}="${sdValue(value)}"`);
  if (identity.user?.trim()) params.push(`user="${sdValue(identity.user.trim())}"`);
  const header = `<${SYSLOG_PRIORITY}>1 ${timestamp} ${orNil(identity.host)} ${APP_NAME} ${orNil(String(procId))} egress`;
  // No free-text message after the structured data: the structured data IS the record, and a message
  // is where content would end up the first time somebody wanted a human-readable line.
  return `${header} [${SD_ID} ${params.join(" ")}]`;
}

/**
 * RFC 5425 framing: the octet count, a space, then the message.
 *
 * Octet counting rather than a trailing newline, because the length is in BYTES and a model name
 * with a non-ASCII character makes `string.length` and the byte count disagree — at which point the
 * collector reads the start of the next message as the end of this one and every row after it is
 * garbage.
 */
export function syslogFrame(message: string): Buffer {
  const body = Buffer.from(message, "utf8");
  return Buffer.concat([Buffer.from(`${body.length} `, "ascii"), body]);
}

// ── OTLP/HTTP, JSON encoding ─────────────────────────────────────────────────────────────────────

/**
 * The rows as an OTLP logs request body.
 *
 * Hand-written against the JSON encoding rather than generated from the protobuf: the shape is
 * small, stable, and a generator would be a build-time dependency for forty lines of object
 * literal.
 */
export function otlpLogs(entries: Array<Record<string, unknown>>, identity: Identity = {}, version = ""): unknown {
  const resource: Array<{ key: string; value: { stringValue: string } }> = [
    { key: "service.name", value: { stringValue: APP_NAME } },
  ];
  if (version) resource.push({ key: "service.version", value: { stringValue: version } });
  if (identity.host?.trim()) resource.push({ key: "host.name", value: { stringValue: identity.host.trim() } });
  if (identity.user?.trim()) resource.push({ key: "enduser.id", value: { stringValue: identity.user.trim() } });

  return {
    resourceLogs: [
      {
        resource: { attributes: resource },
        scopeLogs: [
          {
            scope: { name: "hivey-code.egress" },
            logRecords: entries.map((entry) => {
              const fields = exportable(entry);
              const at = typeof fields.at === "number" ? fields.at : Date.now();
              return {
                // OTLP wants nanoseconds, as a string because the number does not fit a double.
                timeUnixNano: `${at}000000`,
                severityNumber: 9, // INFO
                severityText: "INFO",
                // The body names the event and carries nothing about it. Everything is an attribute,
                // so a collector can index it and nobody is tempted to put a prompt in here.
                body: { stringValue: "egress" },
                attributes: Object.entries(fields)
                  .filter(([key]) => key !== "at")
                  .map(([key, value]) =>
                    typeof value === "number"
                      ? { key, value: { doubleValue: value } }
                      : { key, value: { stringValue: value } },
                  ),
              };
            }),
          },
        ],
      },
    ],
  };
}
