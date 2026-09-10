// A log nobody can quietly edit afterwards.
//
// The egress ledger already records every remote request: when, where to, which model, how many
// tokens, what it cost, how many placeholders were substituted. Never content — a log of what you
// were trying to keep private is not a privacy feature. What it could not do is answer the question
// a security officer actually asks, which is not "what does it say" but "how do you know nobody
// changed it". A JSON array in the workspace state is editable by anything that can write to disk,
// including the person being audited.
//
// So each entry carries the hash of the one before it. Changing an old entry changes its hash,
// which breaks the link the next entry holds, and every entry after that — you cannot alter one
// line without rewriting the whole tail, and the tail is what gets exported to the SIEM the moment
// it is written. It does not make tampering impossible. It makes it VISIBLE, which is the whole of
// what a tamper-evident log claims and considerably more than an unchained one claims.
//
// This is also, deliberately, the only place in this project where hashing is used. Hashing the
// data that gets SENT is the thing that sounds like security and is not: a hash of an email address
// is an email address to anyone with a list of email addresses, which is why the pseudonymiser is
// reversible-with-a-local-vault rather than a digest.

import { createHash } from "node:crypto";

/** The first entry has no predecessor. Sixty-four zeroes, so every `prev` is the same shape. */
export const GENESIS = "0".repeat(64);

export interface Chained {
  /** Position in the chain, from 1. Survives trimming, so a gap is visible. */
  seq: number;
  /** The hash of the previous entry. */
  prev: string;
  /** This entry's own hash, over everything above except itself. */
  hash: string;
}

/**
 * The bytes that get hashed.
 *
 * Keys are sorted, because `JSON.stringify` follows insertion order and two objects with the same
 * contents in a different order would hash differently — which would make a chain break on a
 * refactor rather than on tampering, and a log that cries wolf is a log nobody reads. `hash` itself
 * is excluded for the obvious reason.
 */
export function canonical(record: Record<string, unknown>): string {
  const entries = Object.entries(record)
    .filter(([key]) => key !== "hash")
    .sort(([a], [b]) => a.localeCompare(b));
  return JSON.stringify(entries);
}

export function hashOf(record: Record<string, unknown>): string {
  return createHash("sha256").update(canonical(record), "utf8").digest("hex");
}

/**
 * Attach an entry to the end of the chain.
 *
 * Takes the previous entry rather than the whole ledger: appending must not get slower as the log
 * grows, and it must not require holding five hundred records in memory to write one.
 */
export function link<T extends Record<string, unknown>>(record: T, previous: Chained | undefined): T & Chained {
  const seq = (previous?.seq ?? 0) + 1;
  const prev = previous?.hash ?? GENESIS;
  const body = { ...record, seq, prev };
  return { ...body, hash: hashOf(body) } as T & Chained;
}

/**
 * `altered` — an entry's own hash no longer matches its contents.
 * `broken-link` — an entry does not point at the one before it.
 * `gap` — a sequence number is missing, which is what deleting a row from the middle leaves behind.
 */
export type VerdictReason = "altered" | "broken-link" | "gap";

export interface ChainVerdict {
  ok: boolean;
  /** How many entries were checked and held. */
  checked: number;
  /** The `seq` of the first entry that does not hold. */
  brokenAt?: number;
  reason?: VerdictReason;
}

/**
 * Walk the chain oldest first and report the first link that does not hold.
 *
 * Tolerates exactly one thing: the ledger is capped, so the OLDEST entry kept normally points at an
 * entry that has been dropped. That is trimming, not tampering, and treating it as a break would
 * make the check useless the moment the cap is reached. Everything after that first entry is
 * checked in full, including that the sequence numbers run consecutively — deleting a record from
 * the middle and re-linking the rest would otherwise leave a chain that verifies with a hole in it.
 */
export function verifyChain(records: Array<Record<string, unknown> & Chained>): ChainVerdict {
  const ordered = [...records].sort((a, b) => a.seq - b.seq);
  let expectedPrev: string | undefined;
  let expectedSeq: number | undefined;

  for (const record of ordered) {
    const { hash, ...body } = record;
    if (hashOf(body) !== hash) return { ok: false, checked: ordered.length, brokenAt: record.seq, reason: "altered" };
    if (expectedSeq !== undefined && record.seq !== expectedSeq) {
      return { ok: false, checked: ordered.length, brokenAt: record.seq, reason: "gap" };
    }
    if (expectedPrev !== undefined && record.prev !== expectedPrev) {
      return { ok: false, checked: ordered.length, brokenAt: record.seq, reason: "broken-link" };
    }
    expectedPrev = record.hash;
    expectedSeq = record.seq + 1;
  }
  return { ok: true, checked: ordered.length };
}

/**
 * One JSON object per line, oldest first.
 *
 * The format every log shipper reads without being taught anything: Splunk, Elastic, Loki, and
 * `jq`. The hash and the link go out with it, so the copy in the SIEM can be verified against the
 * copy on the machine — which is the point of exporting at all.
 */
export function toJsonl(records: Array<Record<string, unknown> & Chained>): string {
  return [...records]
    .sort((a, b) => a.seq - b.seq)
    .map((r) => JSON.stringify(r))
    .join("\n");
}

export interface SyslogOptions {
  host: string;
  app?: string;
  /** RFC 5424 facility × 8 + severity. 13×8 + 6 = audit facility, informational. */
  priority?: number;
}

/**
 * RFC 5424 lines, for the estate that collects syslog rather than JSON.
 *
 * Structured data rather than a sentence, because a line a human has to parse with a regular
 * expression is a line that breaks silently when a field is added.
 */
export function toSyslog(records: Array<Record<string, unknown> & Chained>, opts: SyslogOptions): string {
  const priority = opts.priority ?? 110;
  const app = opts.app ?? "hivey-code";
  return [...records]
    .sort((a, b) => a.seq - b.seq)
    .map((r) => {
      const at = typeof r["at"] === "number" ? new Date(r["at"] as number).toISOString() : new Date().toISOString();
      const fields = Object.entries(r)
        .filter(([key]) => key !== "at")
        .map(([key, value]) => `${key}="${String(value).replace(/[\\\]"]/g, (c) => `\\${c}`)}"`)
        .join(" ");
      return `<${priority}>1 ${at} ${opts.host} ${app} - - [hivey@0 ${fields}]`;
    })
    .join("\n");
}
