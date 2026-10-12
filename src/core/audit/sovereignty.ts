// The report somebody shows an auditor.
//
// Everything needed for it already exists — the ledger says what left, the chain says whether the
// ledger was edited, the pseudonymizer says what was replaced. What did not exist was a way to hand
// all of it to somebody in one piece, over a period they choose, in a form they can check without
// trusting the person who produced it.
//
// Three things make it worth more than a screenshot of a panel:
//
//   • it STATES THE CHAIN'S VERDICT rather than assuming it. A report over a ledger whose links do
//     not hold says so, at the top, because that is the single most important line in it.
//   • it is SIGNED, so it cannot be edited after the fact by whoever was asked for it.
//   • its head can be TIMESTAMPED by an authority the organisation chooses, which is what closes
//     residue 9 of the threat model: a local chain proves nobody edited one line, and nothing tied
//     it to anything outside this machine, so rewriting the whole log from the beginning was
//     undetectable. A timestamp over the head answers "this digest existed at this moment", and a
//     rewritten log has a different head that no authority ever saw.
//
// ⚠️ And the limit, stated in the report itself rather than here only: a machine that signs its own
// report proves the report has not changed SINCE IT WAS ISSUED. It cannot prove the ledger it was
// built from was true — nothing on the machine can. The timestamp and the SIEM stream are the two
// things that reach outside, and a report says which of them it has.

import { hashOf, type Chained } from "./chain.js";

/** What the report is built from: ledger rows, already chained. */
export interface ReportRow extends Chained {
  at: number;
  provider: string;
  host: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  cachedTokens?: number;
  usd: number;
  redactions: number;
  redactionSummary: string;
  images?: number;
}

export interface Destination {
  host: string;
  provider: string;
  requests: number;
  /**
   * Tokens in and out, which is what the ledger records.
   *
   * ⚠️ Deliberately not called "bytes". The ledger has never recorded a byte count, and inventing
   * one from a token count would be a figure somebody quotes — the roadmap asks for "volume", and
   * the honest volume is the one that was measured.
   */
  promptTokens: number;
  completionTokens: number;
  usd: number;
  images: number;
  firstAt: number;
  lastAt: number;
}

export interface ChainVerdict {
  /** True when every link holds over the rows present. */
  intact: boolean;
  /** Gaps in the numbering: `[12, 13]` means those sequence numbers are missing. */
  missing: number[];
  /** The first row whose link does not hold, when one does not. */
  brokenAt?: number;
  /** The newest row's hash: what a timestamp is taken over. */
  head?: string;
  /** True when the oldest row is not sequence 1, which the 500-row cap makes ordinary. */
  truncated: boolean;
}

export interface Sovereignty {
  /** The window, as the user asked for it. */
  from: number;
  to: number;
  issuedAt: number;
  requests: number;
  destinations: Destination[];
  /** Pseudonymised categories and their counts, summed over the period: `{ EMAIL: 12, HOST: 3 }`. */
  categories: Record<string, number>;
  images: number;
  usd: number;
  chain: ChainVerdict;
  /** What this report does NOT establish. Part of the document, not of its documentation. */
  limits: string[];
}

/** `EMAIL x2, HOST x1` — the shape the ledger stores. Anything unparseable is counted as unknown. */
function countCategories(summary: string, into: Record<string, number>): void {
  for (const part of (summary ?? "").split(",")) {
    const m = /^\s*([A-Z_]+)\s*(?:x\s*(\d+))?\s*$/.exec(part);
    if (!m) {
      if (part.trim()) into["UNPARSED"] = (into["UNPARSED"] ?? 0) + 1;
      continue;
    }
    const kind = m[1]!;
    into[kind] = (into[kind] ?? 0) + (m[2] ? Number(m[2]) : 1);
  }
}

/**
 * Does the chain hold over these rows?
 *
 * Checked over the rows PRESENT, oldest first, and truncation is tolerated rather than reported as
 * tampering — the ledger is capped at 500 entries, so a check that failed on a full ledger would be
 * a check nobody could ever pass. What is NOT tolerated is a gap in the middle: that is exactly the
 * edit somebody would want to make, and it is the one thing re-chaining cannot hide.
 */
export function verifyChain(rows: ReportRow[]): ChainVerdict {
  const ordered = [...rows].sort((a, b) => a.seq - b.seq);
  if (!ordered.length) return { intact: true, missing: [], truncated: false };

  const missing: number[] = [];
  for (let i = 1; i < ordered.length; i++) {
    for (let seq = ordered[i - 1]!.seq + 1; seq < ordered[i]!.seq; seq++) missing.push(seq);
  }

  let brokenAt: number | undefined;
  for (let i = 0; i < ordered.length; i++) {
    const row = ordered[i]!;
    const expected = hashOf(row as unknown as Record<string, unknown>);
    if (expected !== row.hash) {
      brokenAt = row.seq;
      break;
    }
    const previous = ordered[i - 1];
    // Only when the two are adjacent: across a gap there is nothing to compare against, and the gap
    // is already reported.
    if (previous && previous.seq === row.seq - 1 && row.prev !== previous.hash) {
      brokenAt = row.seq;
      break;
    }
  }

  return {
    intact: brokenAt === undefined && missing.length === 0,
    missing,
    ...(brokenAt === undefined ? {} : { brokenAt }),
    head: ordered[ordered.length - 1]!.hash,
    truncated: ordered[0]!.seq > 1,
  };
}

/** What a report cannot establish. In the document, because a reader of the document needs it. */
export const REPORT_LIMITS = [
  "this report is signed by THIS MACHINE, so the signature proves it has not changed since it was issued — not that the ledger it was built from was true",
  "the chain shows whether any single row was edited; it cannot show that the whole ledger was not rewritten from the beginning, which is what the timestamp below and the SIEM stream are for",
  "the ledger holds the most recent entries only, so a period older than the retention is reported as truncated rather than as empty",
  "volume is counted in TOKENS, which is what the ledger records — not in bytes, which it has never recorded",
  "nothing here can see a request made by another tool on this machine; it is this extension's own record of its own traffic",
];

export function sovereignty(rows: ReportRow[], window: { from: number; to: number }, issuedAt = Date.now()): Sovereignty {
  const inWindow = rows.filter((r) => r.at >= window.from && r.at <= window.to);
  const byHost = new Map<string, Destination>();
  const categories: Record<string, number> = {};
  let images = 0;
  let usd = 0;

  for (const row of inWindow) {
    const key = `${row.provider}@${row.host}`;
    const found = byHost.get(key) ?? {
      host: row.host,
      provider: row.provider,
      requests: 0,
      promptTokens: 0,
      completionTokens: 0,
      usd: 0,
      images: 0,
      firstAt: row.at,
      lastAt: row.at,
    };
    found.requests += 1;
    found.promptTokens += row.promptTokens || 0;
    found.completionTokens += row.completionTokens || 0;
    found.usd += row.usd || 0;
    found.images += row.images ?? 0;
    found.firstAt = Math.min(found.firstAt, row.at);
    found.lastAt = Math.max(found.lastAt, row.at);
    byHost.set(key, found);
    countCategories(row.redactionSummary, categories);
    images += row.images ?? 0;
    usd += row.usd || 0;
  }

  return {
    from: window.from,
    to: window.to,
    issuedAt,
    requests: inWindow.length,
    // Busiest first: the question is "where did most of it go".
    destinations: [...byHost.values()].sort((a, b) => b.requests - a.requests),
    categories,
    images,
    usd: Math.round(usd * 10_000) / 10_000,
    // Over the WHOLE ledger, not the window: a chain is only meaningful end to end, and a report
    // that checked one week's links would miss an edit made in the week before.
    chain: verifyChain(rows),
    limits: REPORT_LIMITS,
  };
}

/**
 * The bytes that get signed and timestamped.
 *
 * The report serialised with its keys sorted, for the same reason the chain hashes that way: two
 * objects with the same contents in a different order must not produce two different signatures.
 */
export function reportBytes(report: Sovereignty): Buffer {
  return Buffer.from(stable(report as unknown as Record<string, unknown>), "utf8");
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stable(v)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}
