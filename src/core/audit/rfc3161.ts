// A trusted timestamp over the head of the audit chain.
//
// The chain makes tampering visible: change one entry and every entry after it has the wrong link.
// What it cannot do is stop somebody rewriting the WHOLE log from the beginning, because nothing
// ties it to anything outside this machine — that is residue 9 of the threat model, written down and
// assumed since 0.39.0.
//
// An RFC 3161 timestamp closes it, and closes it with the smallest possible disclosure: the
// authority is sent **one hash** and nothing else. It answers one question — "this digest existed at
// this moment" — and that is exactly the question a rewritten log cannot answer, because rewriting
// produces a different head and no authority ever saw it.
//
// ⚠️ WHAT THIS DOES AND DOES NOT DO, because the difference matters and is easy to overstate. It
// BUILDS the request, sends it, and keeps the response token verbatim. It does **not** verify the
// authority's signature: doing that properly means a full CMS implementation and a trust store of
// the organisation's own authorities, and an extension that claimed to verify while doing something
// weaker would be worse than one that does not claim it. Verification is a separate act, performed
// by whoever is auditing, with their own trust anchor:
//
//     openssl ts -verify -in head.tsr -queryfile head.tsq -CAfile their-tsa-ca.pem
//
// The token is the evidence. We obtain it and keep it; they check it.

import { createHash } from "node:crypto";

// ── A DER writer, in as few lines as the job needs ───────────────────────────────────────────────

/**
 * A DER length, which is where a hand-rolled encoder usually goes wrong.
 *
 * Under 128 the length is the byte itself. From 128 up it is `0x80 | n` followed by n big-endian
 * bytes — and the subtlety is that those bytes must be the SHORTEST representation, with no leading
 * zero, or the encoding is BER and a strict parser rejects it.
 */
function length(n: number): Buffer {
  if (n < 0x80) return Buffer.from([n]);
  const bytes: number[] = [];
  let left = n;
  while (left > 0) {
    bytes.unshift(left & 0xff);
    left >>>= 8;
  }
  return Buffer.from([0x80 | bytes.length, ...bytes]);
}

function tlv(tag: number, body: Buffer): Buffer {
  return Buffer.concat([Buffer.from([tag]), length(body.length), body]);
}

const sequence = (...parts: Buffer[]): Buffer => tlv(0x30, Buffer.concat(parts));
const octetString = (body: Buffer): Buffer => tlv(0x04, body);
const boolean = (value: boolean): Buffer => tlv(0x01, Buffer.from([value ? 0xff : 0x00]));
const nullValue = (): Buffer => tlv(0x05, Buffer.alloc(0));

/**
 * A positive INTEGER.
 *
 * The leading zero is not optional: DER integers are signed, so a value whose top bit is set needs a
 * 0x00 in front or it is a negative number. A nonce is random, so half of them hit this.
 */
function integer(value: Buffer | number): Buffer {
  let bytes = typeof value === "number" ? Buffer.from(trim(value)) : Buffer.from(value);
  // Strip leading zeroes, then put exactly one back if the top bit is set.
  let at = 0;
  while (at < bytes.length - 1 && bytes[at] === 0) at++;
  bytes = bytes.subarray(at);
  if (bytes.length && (bytes[0]! & 0x80) !== 0) bytes = Buffer.concat([Buffer.from([0]), bytes]);
  if (!bytes.length) bytes = Buffer.from([0]);
  return tlv(0x02, bytes);
}

function trim(value: number): number[] {
  const bytes: number[] = [];
  let left = Math.max(0, Math.trunc(value));
  do {
    bytes.unshift(left & 0xff);
    left = Math.floor(left / 256);
  } while (left > 0);
  return bytes;
}

/**
 * An OBJECT IDENTIFIER from its dotted form.
 *
 * The first two arcs share a byte (40 × first + second), and every arc after that is base-128 with
 * the continuation bit set on all but the last byte.
 */
function objectIdentifier(dotted: string): Buffer {
  const arcs = dotted.split(".").map(Number);
  if (arcs.length < 2 || arcs.some((a) => !Number.isFinite(a) || a < 0)) {
    throw new Error(`not an object identifier: ${dotted}`);
  }
  const body: number[] = [40 * arcs[0]! + arcs[1]!];
  for (const arc of arcs.slice(2)) {
    const base128: number[] = [arc & 0x7f];
    let left = arc >>> 7;
    while (left > 0) {
      base128.unshift((left & 0x7f) | 0x80);
      left >>>= 7;
    }
    body.push(...base128);
  }
  return tlv(0x06, Buffer.from(body));
}

/** SHA-256, as an AlgorithmIdentifier. The NULL parameter is what every TSA expects to see. */
const SHA256_OID = "2.16.840.1.101.3.4.2.1";

// ── The request ──────────────────────────────────────────────────────────────────────────────────

export interface TimestampRequest {
  /** The DER bytes to POST, with `content-type: application/timestamp-query`. */
  der: Buffer;
  /** The digest that was asked about, hex. Kept so the report can state what was timestamped. */
  digest: string;
  /** The nonce, hex. A response carrying a different one is a response to somebody else's request. */
  nonce: string;
}

/**
 * A TimeStampReq over one digest.
 *
 * `certReq` is true: the authority includes its certificate in the token, which is what makes the
 * token verifiable later by somebody who has the CA but not the leaf. A token without it is a token
 * that needs a second file nobody kept.
 */
export function timestampRequest(payload: string | Buffer, nonce: Buffer = randomNonce()): TimestampRequest {
  const digest = createHash("sha256")
    .update(typeof payload === "string" ? Buffer.from(payload, "utf8") : payload)
    .digest();
  const der = sequence(
    integer(1),
    sequence(sequence(objectIdentifier(SHA256_OID), nullValue()), octetString(digest)),
    integer(nonce),
    boolean(true),
  );
  return { der, digest: digest.toString("hex"), nonce: nonce.toString("hex") };
}

function randomNonce(): Buffer {
  const bytes = new Uint8Array(16);
  (globalThis.crypto ?? (require("node:crypto") as typeof import("node:crypto")).webcrypto).getRandomValues(bytes);
  return Buffer.from(bytes);
}

// ── Reading just enough of the response ──────────────────────────────────────────────────────────

export interface TimestampToken {
  /** The whole response, verbatim, for `openssl ts -verify`. This is the evidence. */
  der: Buffer;
  /** The time the authority says it was, when it could be read. */
  genTime?: string;
  /** The authority's own status text when it REFUSED, which is the case worth reporting. */
  refused?: string;
}

/**
 * Was the request granted, and what time does the token claim?
 *
 * Deliberately shallow. The status is at a known place — the first INTEGER of the response — and a
 * non-zero status means the authority refused, which has to be reported rather than stored as
 * evidence of nothing. The `genTime` is then found as the first GeneralizedTime in the token, which
 * is a search rather than a parse: a full walk through CMS SignedData to reach it would be most of
 * the code needed to verify the signature, and this module explicitly does not verify.
 *
 * ⚠️ So `genTime` is INFORMATIONAL — what the report prints so a human recognises the date. The
 * authoritative value is inside the signed token, and reading it is the auditor's job.
 */
export function readTimestampResponse(der: Buffer): TimestampToken {
  const status = firstInteger(der);
  // RFC 3161: 0 granted, 1 granted with modifications. Anything else is a refusal.
  if (status !== undefined && status !== 0 && status !== 1) {
    return { der, refused: `the authority answered status ${status}` };
  }
  const genTime = firstGeneralizedTime(der);
  return { der, ...(genTime ? { genTime } : {}) };
}

/** The first INTEGER at the top level of the outer SEQUENCE: PKIStatusInfo's status. */
function firstInteger(der: Buffer): number | undefined {
  if (der[0] !== 0x30) return undefined;
  const outer = contents(der, 0);
  if (!outer) return undefined;
  // The first field of a TimeStampResp is PKIStatusInfo, itself a SEQUENCE starting with the status.
  if (der[outer.start] !== 0x30) return undefined;
  const info = contents(der, outer.start);
  if (!info) return undefined;
  if (der[info.start] !== 0x02) return undefined;
  const value = contents(der, info.start);
  if (!value || value.end - value.start > 4) return undefined;
  let n = 0;
  for (let i = value.start; i < value.end; i++) n = n * 256 + der[i]!;
  return n;
}

/** `YYYYMMDDHHMMSS[.fff]Z`, as an ISO string. Searched for rather than walked to — see above. */
function firstGeneralizedTime(der: Buffer): string | undefined {
  for (let i = 0; i < der.length - 2; i++) {
    if (der[i] !== 0x18) continue;
    const span = contents(der, i);
    if (!span) continue;
    const text = der.subarray(span.start, span.end).toString("ascii");
    const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(?:\.(\d{1,6}))?Z$/.exec(text);
    if (!m) continue;
    const [, y, mo, d, h, mi, s, frac] = m;
    const iso = `${y}-${mo}-${d}T${h}:${mi}:${s}.${(frac ?? "0").padEnd(3, "0").slice(0, 3)}Z`;
    if (Number.isFinite(new Date(iso).getTime())) return iso;
  }
  return undefined;
}

/** Where a TLV's contents begin and end, or nothing when the length is not readable. */
function contents(der: Buffer, at: number): { start: number; end: number } | undefined {
  const first = der[at + 1];
  if (first === undefined) return undefined;
  if (first < 0x80) {
    const start = at + 2;
    return start + first <= der.length ? { start, end: start + first } : undefined;
  }
  const count = first & 0x7f;
  if (count === 0 || count > 4) return undefined; // indefinite length is not DER
  let size = 0;
  for (let i = 0; i < count; i++) {
    const byte = der[at + 2 + i];
    if (byte === undefined) return undefined;
    size = size * 256 + byte;
  }
  const start = at + 2 + count;
  return start + size <= der.length ? { start, end: start + size } : undefined;
}
