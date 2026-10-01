// The knowledge base: what a note is, how one is found, and what stops the base becoming a pile.

import { test } from "node:test";
import assert from "node:assert/strict";
import { noteId, parseNote, serialiseNote, validId, type KnowledgeNote, parseSharedNote, sharedNoteId, sharedDocKind } from "../src/core/knowledge/note.js";
import { nearDuplicates, scoreNote, searchNotes, terms } from "../src/core/knowledge/search.js";
import { knowledgeIndex } from "../src/core/knowledge/index.js";

function note(id: string, title: string, body = "something true", tags: string[] = []): KnowledgeNote {
  return { id, title, tags, sources: [], body };
}

test("a note survives being written and read back", () => {
  // The agent corrects knowledge by reading a note, changing a paragraph and writing it back. A
  // serialiser that dropped a field would erase the sources of every note it touched.
  const original: KnowledgeNote = {
    id: "finance/invoice-settlement",
    title: "How an invoice is settled",
    tags: ["finance", "batch"],
    sources: ["src/billing/settle.ts", "a conversation with the accounts team"],
    updated: "2026-09-03",
    body: "The settlement job runs before the nightly batch.\n\nAmounts are in cents.",
  };
  const parsed = parseNote(original.id, serialiseNote(original));
  assert.deepEqual(parsed.problems, []);
  assert.deepEqual(parsed.note, original);
});

test("a note without a title is refused", () => {
  // The title is the only ambient part of a note: the index is a list of titles, so a note without
  // one can never be chosen, only stumbled upon.
  const parsed = parseNote("a/b", "---\ntags: x\n---\n\nbody");
  assert.equal(parsed.note, undefined);
  assert.match(parsed.problems.join(" "), /title/);
});

test("an id cannot climb out of the folder", () => {
  // The id becomes a path, and the model chooses the id.
  for (const bad of ["../secrets", "a/../../b", "/etc/passwd", "Finance/Invoices", "a b", ""]) {
    assert.equal(validId(bad), false, bad);
  }
  for (const good of ["finance", "finance/invoices", "ibm-i/rpg/free-form"]) {
    assert.equal(validId(good), true, good);
  }
});

test("only Markdown files are notes", () => {
  assert.equal(noteId("finance/invoices.md"), "finance/invoices");
  assert.equal(noteId("finance/invoices.txt"), undefined);
  assert.equal(noteId("../escape.md"), undefined);
});

test("the title outranks a passing mention", () => {
  // What gets looked up in a base like this is a NAME, and the note about that name is the one
  // whose title carries it.
  const about = note("finance/settlement", "Invoice settlement");
  const mentions = note("ops/nightly", "The nightly batch", "runs after invoice settlement finishes");
  const want = terms("invoice settlement");
  assert.ok(scoreNote(about, want) > scoreNote(mentions, want));
});

test("search returns the lines that matched, not the whole note", () => {
  // A hit has to be judgeable without paying for the note.
  const long = note("db/tables", "The tables", ["a", "b", "the amount is stored in cents", "c"].join("\n"));
  const [hit] = searchNotes([long], "cents");
  assert.ok(hit);
  assert.deepEqual(hit!.lines, ["the amount is stored in cents"]);
});

test("a note that says nothing about the query is not a hit", () => {
  assert.deepEqual(searchNotes([note("a/b", "Something else")], "invoice"), []);
});

test("the same subject under another name is caught before it is written twice", () => {
  // This is what keeps a base a base. Three notes about one rule leave the next reader choosing
  // between them, which is worse than having none.
  const existing = [note("finance/invoice-settlement", "How an invoice is settled")];
  const near = nearDuplicates(existing, "Invoice settlement", "finance/settlement-of-invoices");
  assert.equal(near.length, 1);
});

test("a different subject in the same domain is not a duplicate", () => {
  // The check has to be wrong in this direction rather than the other: refusing a legitimate new
  // note is a base that stops growing.
  const existing = [note("finance/invoice-settlement", "How an invoice is settled")];
  assert.deepEqual(nearDuplicates(existing, "Invoice numbering rules", "finance/invoice-numbering"), []);
});

test("the index fits in its budget and says what it left out", () => {
  // The index is paid for on every turn. Silently truncating it would teach the model that anything
  // unlisted does not exist — and it would stop searching.
  const many = Array.from({ length: 400 }, (_, i) => note(`d/n-${i}`, `A note about subject number ${i}`, "body", ["tag"]));
  const index = knowledgeIndex(many, 300);
  assert.ok(index.listed > 0 && index.listed < 400);
  assert.equal(index.omitted, 400 - index.listed);
  assert.match(index.text, /knowledge_search/);
  assert.match(index.text, new RegExp(`${index.omitted} more`));
});

test("an empty base produces no ambient text at all", () => {
  // A heading announcing a knowledge base with nothing in it sends the model looking where there is
  // nothing to find.
  assert.equal(knowledgeIndex([], 1200).text, "");
});

test("the newest notes are the ones that fit", () => {
  const older = { ...note("a/old", "Old"), updated: "2020-01-01" };
  const newer = { ...note("a/new", "New"), updated: "2026-09-03" };
  const index = knowledgeIndex([older, newer], 60);
  assert.match(index.text, /a\/new/);
});

// ── A folder somebody pointed this at ───────────────────────────────────────────────────────────
//
// Internal documentation is ordinary Markdown. It has no `---` header with a `title:` in it, and
// nobody is going back to add one to four hundred wiki pages — so running a share through the
// strict parser returns "no header" for every file, and a folder of documentation reads as an empty
// knowledge base with four hundred problems in it.

test("a plain Markdown page is readable, and titled by its first heading", () => {
  const parsed = parseSharedNote("creation-client", "# Création d'un client\n\nÉtape 1 : …\n");
  assert.equal(parsed.problems.length, 0, parsed.problems.join("; "));
  assert.equal(parsed.note?.title, "Création d'un client");
  assert.match(parsed.note?.body ?? "", /Étape 1/);
});

test("with no heading, the file name is the title", () => {
  // A guess that lets a page be found is worth more than a rule that hides it: the index the model
  // reads is a list of titles, and a page with no title can never be chosen.
  const parsed = parseSharedNote("procedures/creation_client", "Étape 1 : ouvrir l'écran.\n");
  assert.equal(parsed.note?.title, "creation client");
});

test("a note written in the strict format is still read as one, wherever it lives", () => {
  // Somebody may well keep their team's notes on a share. The header is honored when it is there.
  const strict = "---\ntitle: Settlement job\ntags: batch\n---\n\nIt runs at 22:00.\n";
  const parsed = parseSharedNote("settlement", strict);
  assert.equal(parsed.note?.title, "Settlement job");
  assert.deepEqual(parsed.note?.tags, ["batch"]);
});

test("an empty file is not a note", () => {
  assert.ok(parseSharedNote("blank", "   \n").problems.length);
});

test("a document is identified by what it is, not by whether it was named for us", () => {
  // `noteId` requires `.md` and an id that is already lowercase and unaccented, because the bases
  // this extension writes are written by it. A folder of internal documentation is not: its files
  // are called `Création d'un client.docx`, and refusing them for their name would refuse the
  // feature. The id is folded; the title keeps the original.
  assert.equal(sharedNoteId("Création d'un client.docx"), "creation-d-un-client");
  assert.equal(sharedNoteId("Procédures/Clôture mensuelle.pdf"), "procedures/cloture-mensuelle");
  assert.equal(sharedNoteId("notes.md"), "notes");
  assert.equal(sharedNoteId("budget.xlsx"), undefined, "a spreadsheet is not documentation we can read");
  assert.equal(sharedNoteId("photo.png"), undefined);
});

test("the kind decides how it is read", () => {
  assert.equal(sharedDocKind("a.md"), "text");
  assert.equal(sharedDocKind("A.TXT"), "text");
  assert.equal(sharedDocKind("Création.docx"), "docx");
  assert.equal(sharedDocKind("manuel.PDF"), "pdf");
  assert.equal(sharedDocKind("archive.zip"), undefined);
});
