// A log that can be checked rather than only believed.
//
// The claim being tested is narrow and worth stating exactly: this does not make tampering
// impossible, it makes it visible. Every test below is a way somebody might try to change the
// record of what left the machine, and the verdict that must come back.

import { test } from "node:test";
import assert from "node:assert/strict";
import { canonical, GENESIS, hashOf, link, toJsonl, toSyslog, verifyChain, type Chained } from "../src/core/audit/chain.js";

type Row = Record<string, unknown> & Chained;

function ledger(n: number): Row[] {
  const rows: Row[] = [];
  for (let i = 0; i < n; i++) {
    const body: Record<string, unknown> = { at: 1_700_000_000 + i, host: "openrouter.ai", model: "m", usd: 0.01 * i };
    rows.push(link(body, rows[rows.length - 1]) as Row);
  }
  return rows;
}

test("a chain built honestly holds", () => {
  const verdict = verifyChain(ledger(5));
  assert.equal(verdict.ok, true, JSON.stringify(verdict));
  assert.equal(verdict.checked, 5);
});

test("the first entry points at nothing, and every later one at its predecessor", () => {
  const rows = ledger(3);
  assert.equal(rows[0]!.prev, GENESIS);
  assert.equal(rows[1]!.prev, rows[0]!.hash);
  assert.equal(rows[2]!.prev, rows[1]!.hash);
  assert.deepEqual(rows.map((r) => r.seq), [1, 2, 3]);
});

test("changing what a request cost is caught", () => {
  // The obvious edit: somebody who spent more than they should have.
  const rows = ledger(5);
  rows[2] = { ...rows[2]!, usd: 0 };
  const verdict = verifyChain(rows);
  assert.equal(verdict.ok, false);
  assert.equal(verdict.brokenAt, 3);
  assert.equal(verdict.reason, "altered");
});

test("re-hashing the altered entry does not save it — the next link still points at the old one", () => {
  // The less obvious edit, and the reason the chain exists at all: you cannot fix one entry, you
  // have to rewrite every entry after it.
  const rows = ledger(5);
  const forged = { ...rows[2]!, usd: 0 };
  rows[2] = { ...forged, hash: hashOf({ ...forged, hash: undefined }) } as Row;
  const verdict = verifyChain(rows);
  assert.equal(verdict.ok, false);
  assert.ok(verdict.brokenAt === 3 || verdict.brokenAt === 4, `broke at ${verdict.brokenAt}`);
});

test("deleting an entry from the middle is caught even when the rest still links up", () => {
  // Without the sequence check, dropping a row and leaving the others alone would leave a chain
  // that verifies with a hole in it — which is the edit somebody actually wants to make.
  const rows = ledger(5);
  const withHole = [rows[0]!, rows[1]!, rows[3]!, rows[4]!];
  const verdict = verifyChain(withHole);
  assert.equal(verdict.ok, false);
  // A gap in the sequence, which is exactly what a deletion leaves behind.
  assert.equal(verdict.reason, "gap");
  assert.equal(verdict.brokenAt, 4);
});

test("trimming the oldest entries is not tampering", () => {
  // The ledger is capped, so the oldest entry kept normally points at one that has been dropped.
  // Treating that as a break would make the check useless the moment the cap is reached.
  const rows = ledger(10).slice(4);
  assert.equal(verifyChain(rows).ok, true);
});

test("the order the rows are stored in does not matter", () => {
  // The ledger is held newest-first for the report; the chain is oldest-first by definition.
  const rows = ledger(5);
  assert.equal(verifyChain([...rows].reverse()).ok, true);
});

test("the same content in a different key order hashes the same", () => {
  // Otherwise a chain breaks when somebody reorders a struct, and a log that cries wolf is a log
  // nobody reads.
  assert.equal(canonical({ b: 2, a: 1 }), canonical({ a: 1, b: 2 }));
  assert.equal(hashOf({ b: 2, a: 1 }), hashOf({ a: 1, b: 2 }));
});

test("the export carries the proof with it", () => {
  // A copy in the SIEM that cannot be checked against the copy on the machine is just a copy.
  const rows = ledger(3);
  const lines = toJsonl(rows).split("\n");
  assert.equal(lines.length, 3);
  const first = JSON.parse(lines[0]!);
  assert.equal(first.seq, 1);
  assert.ok(first.hash && first.prev, "the link did not survive the export");
  assert.equal(verifyChain(lines.map((l) => JSON.parse(l) as Row)).ok, true);
});

test("syslog lines are RFC 5424 shaped and escape what would break them", () => {
  const body: Record<string, unknown> = { at: 1_700_000_000_000, note: 'a "quoted" ]bracket' };
  const rows = [link(body, undefined) as Row];
  const line = toSyslog(rows, { host: "workstation" });
  assert.match(line, /^<\d+>1 \d{4}-\d{2}-\d{2}T/);
  assert.match(line, /workstation hivey-code - - \[hivey@0 /);
  assert.match(line, /\\"quoted\\"/, "a quote inside a value would end the field early");
  assert.match(line, /\\]bracket/, "a bracket inside a value would end the element early");
});
