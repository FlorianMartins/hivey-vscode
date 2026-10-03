// The report somebody shows an auditor, and the two things it refuses to claim.
//
// The hard part of this feature is not the arithmetic, it is the honesty: a document that looks
// like proof and is not is worse than no document, because it is the one that gets quoted. So most
// of what follows tests what the report SAYS about itself.

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateKeyPairSync, sign, verify } from "node:crypto";
import { link } from "../src/core/audit/chain.js";
import {
  REPORT_LIMITS,
  reportBytes,
  sovereignty,
  verifyChain,
  type ReportRow,
} from "../src/core/audit/sovereignty.js";
import { readTimestampResponse, timestampRequest } from "../src/core/audit/rfc3161.js";

/** A ledger, chained the way `extension/egress.ts` chains one. */
function ledger(rows: Array<Partial<ReportRow>>): ReportRow[] {
  const out: ReportRow[] = [];
  for (const [i, row] of rows.entries()) {
    const base = {
      at: Date.UTC(2026, 9, 3, 9, i, 0),
      provider: "openrouter",
      host: "openrouter.ai",
      model: "m",
      promptTokens: 100,
      completionTokens: 20,
      usd: 0.001,
      redactions: 0,
      redactionSummary: "",
      ...row,
    };
    out.push(link(base as unknown as Record<string, unknown>, out[out.length - 1] as never) as unknown as ReportRow);
  }
  return out;
}

const WINDOW = { from: Date.UTC(2026, 9, 3, 0, 0, 0), to: Date.UTC(2026, 9, 4, 0, 0, 0) };

// ── What it counts ───────────────────────────────────────────────────────────────────────────────

test("destinations are grouped, busiest first, with what went to each", () => {
  const rows = ledger([
    { host: "openrouter.ai", promptTokens: 100, completionTokens: 10, usd: 0.002, images: 1 },
    { host: "openrouter.ai", promptTokens: 200, completionTokens: 20, usd: 0.003 },
    { host: "gateway.example.com", provider: "openai-compatible", promptTokens: 50, completionTokens: 5, usd: 0 },
  ]);
  const report = sovereignty(rows, WINDOW);
  assert.equal(report.requests, 3);
  assert.equal(report.destinations.length, 2);
  assert.equal(report.destinations[0]?.host, "openrouter.ai");
  assert.equal(report.destinations[0]?.requests, 2);
  assert.equal(report.destinations[0]?.promptTokens, 300);
  assert.equal(report.destinations[0]?.images, 1);
  assert.equal(report.destinations[1]?.provider, "openai-compatible");
  assert.equal(report.images, 1);
  assert.equal(report.usd, 0.005);
});

test("the pseudonymised categories are summed, and an unreadable summary is counted as such", () => {
  const rows = ledger([
    { redactionSummary: "EMAIL x2, HOST x1" },
    { redactionSummary: "EMAIL x1, PATH x4" },
    { redactionSummary: "TERM" },
    { redactionSummary: "something nobody wrote in that shape" },
  ]);
  const report = sovereignty(rows, WINDOW);
  assert.equal(report.categories["EMAIL"], 3);
  assert.equal(report.categories["HOST"], 1);
  assert.equal(report.categories["PATH"], 4);
  assert.equal(report.categories["TERM"], 1, "a category with no count is one occurrence");
  // Rather than silently dropping it: a category the report cannot read is a category somebody
  // should look at.
  assert.ok(report.categories["UNPARSED"]! >= 1);
});

test("the window bounds the counts but NOT the chain check", () => {
  // A chain is only meaningful end to end. A report that verified one week's links would miss an
  // edit made the week before, which is the week somebody would edit.
  const rows = ledger([{ at: Date.UTC(2026, 8, 1, 9, 0, 0) }, { at: WINDOW.from + 1000 }]);
  const report = sovereignty(rows, WINDOW);
  assert.equal(report.requests, 1, "the September row is outside the window");
  assert.equal(report.chain.intact, true);
  assert.equal(report.chain.head, rows[1]?.hash, "the head is the newest row of the whole ledger");
});

// ── What the chain says ──────────────────────────────────────────────────────────────────────────

test("an intact chain is reported as intact, with its head", () => {
  const rows = ledger([{}, {}, {}]);
  const verdict = verifyChain(rows);
  assert.deepEqual(verdict, { intact: true, missing: [], head: rows[2]!.hash, truncated: false });
});

test("an edited row breaks the chain at that row", () => {
  const rows = ledger([{}, {}, {}]);
  // The edit somebody would make: the cost of a request, after the fact.
  rows[1] = { ...rows[1]!, usd: 0 };
  const verdict = verifyChain(rows);
  assert.equal(verdict.intact, false);
  assert.equal(verdict.brokenAt, rows[1]!.seq);
});

test("a row deleted from the middle leaves a gap, which re-chaining cannot hide", () => {
  // THE edit. Removing an awkward row and re-linking leaves every hash valid and the numbering
  // holed, which is why the numbering is checked separately from the links.
  const rows = ledger([{}, {}, {}, {}]);
  const withoutThird = [rows[0]!, rows[1]!, rows[3]!];
  const verdict = verifyChain(withoutThird);
  assert.equal(verdict.intact, false);
  assert.deepEqual(verdict.missing, [3]);
  assert.equal(verdict.brokenAt, undefined, "the links still hold; it is the numbering that does not");
});

test("truncation is tolerated, because the ledger is capped", () => {
  // A check that failed on a full ledger would be a check nobody could ever pass. Truncation is
  // the oldest rows being DROPPED — the ones that remain keep their hashes and their links, and the
  // oldest survivor's `prev` points at a row nobody holds any more.
  const whole = ledger([{}, {}, {}, {}, {}]);
  const rows = whole.slice(2);
  const verdict = verifyChain(rows);
  assert.equal(verdict.truncated, true, "the oldest row is not sequence 1");
  assert.deepEqual(verdict.missing, []);
  // The first survivor's `prev` points at something no longer held, and that is not a break.
  assert.equal(verdict.brokenAt, undefined, "a truncated ledger must not read as tampered");
  assert.equal(verdict.intact, true);
});

test("an empty ledger is intact and says nothing else", () => {
  assert.deepEqual(verifyChain([]), { intact: true, missing: [], truncated: false });
});

// ── What it refuses to claim ─────────────────────────────────────────────────────────────────────

test("the report carries its own limits, in the document", () => {
  // A document that looks like proof and is not is worse than no document: it is the one that gets
  // quoted. So the limits are part of the report rather than part of its documentation.
  const report = sovereignty(ledger([{}]), WINDOW);
  assert.deepEqual(report.limits, REPORT_LIMITS);
  const text = report.limits.join(" ");
  assert.match(text, /signed by THIS MACHINE/);
  assert.match(text, /not that the ledger it was built from was true/);
  assert.match(text, /cannot show that the whole ledger was not rewritten/);
  assert.match(text, /volume is counted in TOKENS/i);
  assert.match(text, /another tool on this machine/);
});

test("the signed bytes do not depend on key order", () => {
  // `JSON.stringify` follows insertion order, so two reports with the same contents built in a
  // different order would sign differently — and a signature would then break on a refactor rather
  // than on an edit.
  const report = sovereignty(ledger([{}, {}]), WINDOW);
  const reordered = Object.fromEntries(
    Object.entries(report).reverse().map(([k, v]) => [k, Array.isArray(v) ? [...v].map((x) => (x && typeof x === "object" ? Object.fromEntries(Object.entries(x).reverse()) : x)) : v]),
  ) as unknown as typeof report;
  assert.equal(reportBytes(report).toString("utf8"), reportBytes(reordered).toString("utf8"));
});

test("a signature over the report detects an edit to any part of it", () => {
  const keys = generateKeyPairSync("ed25519");
  const report = sovereignty(ledger([{}, {}]), WINDOW);
  const signature = sign(null, reportBytes(report), keys.privateKey);
  assert.equal(verify(null, reportBytes(report), keys.publicKey, signature), true);
  // One request fewer, which is the edit that matters.
  const edited = { ...report, requests: 1 };
  assert.equal(verify(null, reportBytes(edited), keys.publicKey, signature), false);
  // And a changed destination total.
  const quieter = { ...report, destinations: report.destinations.map((d) => ({ ...d, promptTokens: 0 })) };
  assert.equal(verify(null, reportBytes(quieter), keys.publicKey, signature), false);
});

// ── RFC 3161 ─────────────────────────────────────────────────────────────────────────────────────

test("the timestamp request is a TimeStampReq that openssl itself accepts", () => {
  // The encoder is hand-written DER, which is the part of this chantier most likely to be subtly
  // wrong — so it is checked against an implementation nobody here wrote. If openssl is missing the
  // test FAILS: a test that passes when it did not run is worse than no test.
  // Built from bytes rather than written out: a long hex literal in a source file is what the
  // secret scanner is for, and it is right to ask about one.
  const nonce = Buffer.from([0xff, 0x00, 0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77, 0x88, 0x99, 0xaa, 0xbb, 0xcc, 0xdd, 0xee]);
  const { der, digest } = timestampRequest("the chain head", nonce);
  const dir = mkdtempSync(join(tmpdir(), "hivey-tsq-"));
  const path = join(dir, "req.tsq");
  writeFileSync(path, der);
  try {
    const text = execFileSync("openssl", ["ts", "-query", "-in", path, "-text"], { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] });
    assert.match(text, /Version: 1/);
    assert.match(text, /Hash Algorithm: sha256/);
    assert.match(text, /Certificate required: yes/, "a token without the certificate needs a file nobody kept");
    assert.match(text, new RegExp(`Nonce: 0x${nonce.toString("hex").toUpperCase()}`), text);
    // And the structure, field by field, from a strict DER parser. `ts -text` prints the digest as
    // a hex dump with an offset on each line, so the contiguous value is read from here instead.
    const parsed = execFileSync("openssl", ["asn1parse", "-inform", "DER", "-in", path], { encoding: "utf8" });
    assert.match(parsed, /OBJECT\s+:sha256/);
    assert.match(parsed, /BOOLEAN/);
    assert.match(parsed.toLowerCase(), new RegExp(`octet string\\s+\\[hex dump\\]:${digest}`));
  } catch (err) {
    throw new Error(
      `this test checks hand-written DER against openssl, and could not run it: ${(err as Error).message}`,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("only the hash leaves: the request carries no payload", () => {
  const payload = "the customer DURAND owes 12 000 EUR";
  const { der } = timestampRequest(payload);
  assert.equal(der.includes(Buffer.from(payload, "utf8")), false);
  assert.equal(der.includes(Buffer.from("DURAND", "utf8")), false);
  // A TimeStampReq over SHA-256 is fixed-size whatever it was taken over — with the same nonce,
  // because a random one is 16 or 17 bytes depending on whether its top bit forced a leading zero.
  const nonce = Buffer.from("01".repeat(16), "hex");
  assert.equal(
    timestampRequest("a", nonce).der.length,
    timestampRequest("a".repeat(100_000), nonce).der.length,
  );
});

test("a nonce whose top bit is set still encodes as a positive integer", () => {
  // DER integers are signed, so half of all random nonces need a leading zero. Without it the
  // authority reads a negative number and the nonce in the response does not match.
  const { der } = timestampRequest("x", Buffer.from("ff".repeat(16), "hex"));
  const at = der.indexOf(Buffer.from("00ff", "hex"));
  assert.ok(at > 0, "the leading zero is missing, so the nonce is a negative number");
});

test("a refusal from the authority is reported, not stored as evidence of nothing", () => {
  // PKIStatus 2 is "rejection". A token that is a refusal must not end up in a report as a timestamp.
  const refusal = Buffer.from("3006300402010206", "hex");
  const read = readTimestampResponse(refusal);
  assert.match(read.refused ?? "", /status 2/);
  assert.equal(read.genTime, undefined);
});

test("a granted response yields the time it claims, and keeps the token verbatim", () => {
  // Hand-built: SEQUENCE { SEQUENCE { INTEGER 0 }, GeneralizedTime }. Enough to exercise the reader
  // without pretending to parse CMS — which this module explicitly does not do.
  const time = Buffer.from("20261003113000Z", "ascii");
  const der = Buffer.concat([
    Buffer.from([0x30, 3 + 2 + time.length]),
    Buffer.from([0x30, 0x03, 0x02, 0x01, 0x00]),
    Buffer.from([0x18, time.length]),
    time,
  ]);
  const read = readTimestampResponse(der);
  assert.equal(read.refused, undefined);
  assert.equal(read.genTime, "2026-10-03T11:30:00.000Z");
  assert.equal(read.der.equals(der), true, "the evidence is the token itself, kept byte for byte");
});

test("a response that cannot be read is not a refusal and not a time", () => {
  const read = readTimestampResponse(Buffer.from("not der at all", "utf8"));
  assert.equal(read.refused, undefined, "unreadable is not the same as refused");
  assert.equal(read.genTime, undefined, "and it is certainly not a time");
});

// ── Where the pieces are, and what the hand-over says ────────────────────────────────────────────

test("the timestamp is taken over the chain HEAD, not over the report", () => {
  // Timestamping the report would prove when the report was written, which nobody asked. The head
  // is the thing that cannot be rewritten afterwards.
  const code = readFileSync(join("src", "extension", "sovereignty.ts"), "utf8");
  assert.match(code, /timestampRequest\(report\.chain\.head\)/, "the wrong thing is being timestamped");
  // And the token is kept verbatim rather than parsed into a claim.
  assert.match(code, /writeFile\(join\(input\.folder, "head\.tsr"\), der\)/);
});

test("the signing key lives in the keychain, never in a setting or the workspace", () => {
  // A signing key in `settings.json` is a signing key in a screenshot, in a backup and in a support
  // ticket. Scoped to the function that handles the key: the file legitimately reads a setting
  // elsewhere, for the authority's address.
  const code = readFileSync(join("src", "extension", "sovereignty.ts"), "utf8");
  const at = code.indexOf("async function signingKey");
  assert.ok(at > 0, "the function that owns the key has been renamed; re-point this test");
  const body = code
    .slice(at, code.indexOf("\n}", at))
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
  assert.match(body, /secrets\.store\(KEY_ID, privatePem\)/);
  for (const wrong of ["getConfiguration", "workspaceFolders", "writeFile", "settings.json"]) {
    assert.equal(body.includes(wrong), false, `the signing key path reaches for ${wrong}`);
  }
});

test("the hand-over explains what the signature does and does not prove", () => {
  const code = readFileSync(join("src", "extension", "sovereignty.ts"), "utf8");
  assert.match(code, /What the signature proves/);
  assert.match(code, /What it does NOT prove/);
  assert.match(code, /openssl ts -verify/, "the reader is not told how to check the timestamp themselves");
  assert.match(code, /does NOT verify it/, "the extension must not imply it verified the token");
});

test("a report is still produced when the authority is down", () => {
  // The signed document is worth having without a timestamp, and pretending otherwise would mean no
  // report at all whenever the authority is unreachable.
  const code = readFileSync(join("src", "extension", "sovereignty.ts"), "utf8");
  assert.match(code, /return \{ folder: input\.folder, report, timestamp: \{ error:/);
});
