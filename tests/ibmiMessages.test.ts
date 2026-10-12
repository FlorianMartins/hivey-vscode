// What does CPF4131 mean, and what does this shop do about it?
//
// Two answers of different authority in one result. The tests that matter are the ones that keep
// them apart: an internal note is what this company decided, possibly in 2011, and presenting it
// with the authority of an IBM manual is the failure mode worth preventing.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  citedIds,
  formatMessage,
  messageFiles,
  messageSql,
  notesCiting,
  readMessage,
  validMessageId,
} from "../src/core/ibmi/messages.js";
import { cell } from "../src/core/ibmi/sql.js";
import { toolsForMode } from "../src/core/session/modes.js";
import type { Tool } from "../src/core/agent/loop.js";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// ── Which file ───────────────────────────────────────────────────────────────────────────────────

test("each prefix goes to the message file IBM puts it in", () => {
  assert.deepEqual(messageFiles("CPF4131"), [{ library: "QSYS", name: "QCPFMSG" }]);
  assert.deepEqual(messageFiles("MCH1210"), [{ library: "QSYS", name: "QCPFMSG" }]);
  assert.deepEqual(messageFiles("RNF7030"), [{ library: "QSYS", name: "QRNXMSG" }]);
  assert.deepEqual(messageFiles("SQL0204"), [{ library: "QSYS", name: "QSQLMSG" }]);
});

test("an unknown prefix is looked for everywhere rather than refused", () => {
  // One query is cheap; a model that cannot explain the error in front of it is not.
  const files = messageFiles("ZZZ9999");
  assert.ok(files.length > 1, "an unknown prefix must still be looked for");
  assert.ok(files.some((f) => f.name === "QCPFMSG"));
  // And without the same file twice, because several prefixes share QCPFMSG.
  assert.equal(new Set(files.map((f) => f.name)).size, files.length);
});

test("an identifier is three letters and four digits, and nothing else", () => {
  assert.equal(validMessageId("CPF4131"), true);
  assert.equal(validMessageId("cpf4131"), true);
  for (const bad of ["CP4131", "CPFX131", "CPF41311", "CPF413", "4131CPF", ""]) {
    assert.equal(validMessageId(bad), false, bad);
  }
});

test("the query cannot be ended by a quote in a name", () => {
  const sql = messageSql({ library: "QSYS", name: "QCPFMSG" }, "CPF4131");
  assert.match(sql, /QSYS2\.MESSAGE_FILE_DATA/);
  assert.match(sql, /MESSAGE_FILE_LIBRARY => 'QSYS'/);
  assert.match(sql, /MESSAGE_ID = 'CPF4131'/);
  assert.match(messageSql({ library: "Q'SYS", name: "Q'MSG" }, "CPF4131"), /'Q''SYS'/);
});

// ── Reading IBM's answer ─────────────────────────────────────────────────────────────────────────

test("the second-level text is kept, because it is the half nobody reads and everybody needs", () => {
  const rows = [
    {
      MESSAGE_ID: "CPF4131",
      SEVERITY: 40,
      MESSAGE_TEXT: "Level check on file CUSTMAST in library DEVCFC.",
      MESSAGE_SECOND_LEVEL_TEXT: "Cause . . . . . : The record format has changed. Recovery . . . : Recompile.",
    },
  ];
  const message = readMessage(rows, { library: "QSYS", name: "QCPFMSG" }, cell);
  assert.equal(message?.id, "CPF4131");
  assert.equal(message?.severity, 40);
  assert.match(message?.help ?? "", /Recompile/);
  assert.deepEqual(message?.file, { library: "QSYS", name: "QCPFMSG" });
});

test("an empty answer is nothing, and a missing severity does not become zero", () => {
  assert.equal(readMessage([], { library: "QSYS", name: "QCPFMSG" }, cell), undefined);
  const thin = readMessage([{ MESSAGE_ID: "CPF4131", MESSAGE_TEXT: "x" }], { library: "QSYS", name: "QCPFMSG" }, cell);
  assert.equal(thin?.severity, undefined, "a severity nobody reported must not read as 0");
});

// ── The house documentation ──────────────────────────────────────────────────────────────────────

test("the identifiers a document cites are found, and only real ones", () => {
  const text = [
    "# Reprise après un level check",
    "Quand CPF4131 apparaît dans le journal, relancer la compilation.",
    "Voir aussi SQL0204 et MCH1210. Le lot ABC1234 n'est pas un message.",
    "Ni ISO9001, ni A1234.",
  ].join("\n");
  // ABC1234 and ISO9001 are three letters and four digits, so they ARE matched: the pattern cannot
  // tell a message identifier from a batch name, and this test records that rather than pretending
  // otherwise. What it must not match is a two-letter or five-digit shape.
  const ids = citedIds(text);
  assert.ok(ids.includes("CPF4131"));
  assert.ok(ids.includes("SQL0204"));
  assert.ok(ids.includes("MCH1210"));
  assert.equal(ids.includes("A1234"), false);
});

const notes = [
  {
    id: "exploitation/level-check",
    title: "Reprise après un level check",
    body: "## Procédure\nUn CPF4131 sur CUSTMAST signifie que le format a changé.\nRecompiler les appelants, puis relancer le lot de nuit.",
  },
  { id: "finance/arrondi", title: "Arrondi des factures", body: "Rien à voir avec un message." },
];

test("the house notes citing an identifier are found, with the line that cites it", () => {
  const found = notesCiting(notes, "CPF4131");
  assert.equal(found.length, 1);
  assert.equal(found[0]?.title, "Reprise après un level check");
  // The citing line AND the one after it: a procedure is written as "CPF4131 — then do X", and the
  // X is on the next line as often as not.
  assert.match(found[0]?.excerpt ?? "", /le format a changé/);
  assert.match(found[0]?.excerpt ?? "", /Recompiler les appelants/);
});

test("a search for something that is not an identifier finds nothing", () => {
  // Otherwise "a" would match every note in the base.
  assert.deepEqual(notesCiting(notes, "a"), []);
  assert.deepEqual(notesCiting(notes, ""), []);
});

// ── The two authorities, kept apart ──────────────────────────────────────────────────────────────

const ibm = readMessage(
  [{ MESSAGE_ID: "CPF4131", SEVERITY: 40, MESSAGE_TEXT: "Level check on file CUSTMAST.", MESSAGE_SECOND_LEVEL_TEXT: "Recovery: recompile." }],
  { library: "QSYS", name: "QCPFMSG" },
  cell,
);

test("IBM's text comes first and is labelled as IBM's", () => {
  const text = formatMessage("CPF4131", ibm, notesCiting(notes, "CPF4131"));
  const ibmAt = text.indexOf("IBM's text");
  const houseAt = text.indexOf("Your own documentation");
  assert.ok(ibmAt >= 0 && ibmAt < houseAt, "the fact goes before the house decision");
  assert.match(text, /from QSYS\/QCPFMSG/);
  assert.match(text, /severity 40/);
  assert.match(text, /Cause and recovery, as IBM describes it/);
});

test("the house notes are labelled as the organisation's, and as possibly out of date", () => {
  const text = formatMessage("CPF4131", ibm, notesCiting(notes, "CPF4131"));
  assert.match(text, /Your own documentation mentions CPF4131 in 1 note\(s\)/);
  assert.match(text, /your organisation's, not IBM's/);
  assert.match(text, /may be out of date/);
  assert.match(text, /Say which of the two you are relying on/);
});

test("no house note is said plainly, so silence is not read as agreement", () => {
  const text = formatMessage("CPF4131", ibm, []);
  assert.match(text, /does not mention CPF4131/);
});

test("an identifier IBM does not have is reported as not found, with where was looked", () => {
  const text = formatMessage("ZZZ9999", undefined, []);
  assert.match(text, /not found in any message file I looked in/);
  assert.match(text, /QCPFMSG/);
});

test("a message file that could not be read is a gap, not an absence", () => {
  const text = formatMessage("CPF4131", undefined, [], ["QSYS/QCPFMSG (not authorised)"]);
  assert.match(text, /What I could not read: QSYS\/QCPFMSG \(not authorised\)/);
  // And it does not then claim to have looked everywhere.
  assert.equal(/\(QSYS\/QCPFMSG, QRNXMSG/.test(text), false);
});

// ── Where it sits ────────────────────────────────────────────────────────────────────────────────

test("the message tool reads, so it is available in plan mode", () => {
  const tools = ["ibmi_message", "ibmi_command"].map(
    (name): Tool => ({
      schema: { name, description: name, parameters: { type: "object", properties: {} } },
      approval: () => false,
      run: async () => ({ content: "ok" }),
    }),
  );
  const planned = toolsForMode(tools, "plan").map((t) => t.schema.name);
  assert.deepEqual(planned, ["ibmi_message"]);
});

test("the tool is wired, and asks both halves", () => {
  const source = readFileSync(join("src", "extension", "integrations", "ibmi.ts"), "utf8");
  assert.match(source, /name: "ibmi_message"/);
  assert.match(source, /return \[[^\]]*\bmessage\b[^\]]*\]/, "declared but never returned");
  // IBM's half and the house half.
  assert.match(source, /messageSql\(file, id\)/, "it never asks the message file");
  assert.match(source, /notesCiting\(await store\.list\(\), id\)/, "it never asks the internal documentation");
  // And a base that is not configured is not an error: the answer just says so.
  assert.match(source, /const store = knowledgeStore\(readSettings\(\)\);/);
});
