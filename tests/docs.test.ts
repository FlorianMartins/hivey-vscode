// Reading a Word document and a PDF without shipping a parser as a dependency.
//
// The project refused both until now, and the reason written down was sound: "attaching mojibake
// would be worse than refusing it, because the model would confidently answer about the noise."
// What changed is the premise, not the principle — the internal documentation these are meant to
// reach IS in those formats, so refusing them refuses the feature. The principle survives as a
// check on the OUTPUT rather than a rule about the extension.

import { test } from "node:test";
import assert from "node:assert/strict";
import { deflateRawSync, deflateSync } from "node:zlib";
import { readZipEntry } from "../src/core/docs/zip.js";
import { docxText, wordXmlToText } from "../src/core/docs/docx.js";
import { pdfText } from "../src/core/docs/pdf.js";

// ── A ZIP, built here so the reader is tested against bytes rather than against a fixture ────────

function zip(entries: Array<{ name: string; body: Buffer; deflate?: boolean }>): Buffer {
  const locals: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const stored = entry.deflate ? deflateRawSync(entry.body) : entry.body;
    const method = entry.deflate ? 8 : 0;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(stored.length, 18);
    local.writeUInt32LE(entry.body.length, 22);
    local.writeUInt16LE(name.length, 26);
    locals.push(local, name, stored);

    const dir = Buffer.alloc(46);
    dir.writeUInt32LE(0x02014b50, 0);
    dir.writeUInt16LE(method, 10);
    dir.writeUInt32LE(stored.length, 20);
    dir.writeUInt32LE(entry.body.length, 24);
    dir.writeUInt16LE(name.length, 28);
    dir.writeUInt32LE(offset, 42);
    central.push(dir, name);

    offset += local.length + name.length + stored.length;
  }
  const body = Buffer.concat(locals);
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(body.length, 16);
  return Buffer.concat([body, directory, end]);
}

test("an entry is found whether it is stored or deflated", () => {
  const archive = zip([
    { name: "a.txt", body: Buffer.from("stored") },
    { name: "word/document.xml", body: Buffer.from("deflated"), deflate: true },
  ]);
  assert.equal(readZipEntry(archive, "a.txt")?.toString(), "stored");
  assert.equal(readZipEntry(archive, "word/document.xml")?.toString(), "deflated");
  assert.equal(readZipEntry(archive, "nothing"), undefined);
});

// ── Word ────────────────────────────────────────────────────────────────────────────────────────

test("a Word document reads as its prose", () => {
  const xml =
    '<w:document><w:body><w:p><w:r><w:t>Création d&apos;un client</w:t></w:r></w:p>' +
    "<w:p><w:r><w:t>Étape 1 : ouvrir </w:t></w:r><w:r><w:t>TSTCFC</w:t></w:r></w:p></w:body></w:document>";
  const file = zip([{ name: "word/document.xml", body: Buffer.from(xml, "utf8"), deflate: true }]);
  const text = docxText(file);
  assert.match(text ?? "", /Création d'un client/);
  assert.match(text ?? "", /Étape 1 : ouvrir TSTCFC/, "two runs of one sentence were not joined");
});

test("paragraphs separate, and a table's cells do not run together", () => {
  const xml = "<w:p><w:r><w:t>one</w:t></w:r></w:p><w:tc><w:r><w:t>a</w:t></w:r></w:tc><w:tc><w:r><w:t>b</w:t></w:r></w:tc>";
  const text = wordXmlToText(xml);
  assert.match(text, /^one\n/);
  assert.match(text, /a\tb/);
});

test("a file that is not a Word document is refused rather than guessed at", () => {
  assert.equal(docxText(Buffer.from("not a zip at all")), undefined);
  assert.equal(docxText(zip([{ name: "other.xml", body: Buffer.from("<x/>") }])), undefined);
});

// ── PDF ─────────────────────────────────────────────────────────────────────────────────────────

/** A PDF with one content stream, compressed or not, holding the given operators. */
function pdf(content: string, { compress = false } = {}): Buffer {
  const body = compress ? deflateSync(Buffer.from(content, "latin1")) : Buffer.from(content, "latin1");
  const head = `%PDF-1.4\n1 0 obj\n<< /Length ${body.length}${compress ? " /Filter /FlateDecode" : ""} >>\nstream\n`;
  return Buffer.concat([Buffer.from(head, "latin1"), body, Buffer.from("\nendstream\nendobj\n%%EOF\n", "latin1")]);
}

const SENTENCE = "The settlement job runs at 22:00 and writes to the archive library. ".repeat(6);

test("a PDF with a text layer reads as its text", () => {
  const ops = SENTENCE.split(". ")
    .filter(Boolean)
    .map((line) => `BT /F1 12 Tf (${line.replace(/[()]/g, "")}.) Tj ET T*`)
    .join("\n");
  const out = pdfText(pdf(ops));
  assert.ok(out.confident, out.why);
  assert.match(out.text, /settlement job runs at 22:00/);
});

test("a compressed content stream is read too", () => {
  const ops = SENTENCE.split(". ")
    .filter(Boolean)
    .map((line) => `BT (${line.replace(/[()]/g, "")}.) Tj ET T*`)
    .join("\n");
  const out = pdfText(pdf(ops, { compress: true }));
  assert.ok(out.confident, out.why);
  assert.match(out.text, /archive library/);
});

test("kerning inside a TJ array becomes a space, not nothing", () => {
  const out = pdfText(pdf(`BT [(Cr) -300 (éation) -300 (du) -300 (client)] TJ ET`));
  assert.match(out.text, /Cr éation du client|Création du client/);
});

test("a scan — no text layer at all — is refused, not attached empty", () => {
  const out = pdfText(pdf("q 612 0 0 792 0 0 cm /Im0 Do Q"));
  assert.equal(out.confident, false);
  assert.match(out.why ?? "", /no text layer/);
});

test("something that is not a PDF is refused", () => {
  assert.equal(pdfText(Buffer.from("hello")).confident, false);
});

test("an encrypted PDF is refused rather than half-read", () => {
  const file = Buffer.concat([Buffer.from("%PDF-1.4\n/Encrypt 9 0 R\n", "latin1"), pdf("BT (x) Tj ET").subarray(9)]);
  const out = pdfText(file);
  assert.equal(out.confident, false);
  assert.match(out.why ?? "", /encrypted/);
});

test("glyph indices read as characters are not offered as the document", () => {
  // The case the old blanket refusal was really protecting against: a subset font whose strings are
  // glyph numbers. What comes out looks like text to a string function and like nothing to a reader,
  // and a model would answer about it with complete confidence.
  const junk = Array.from({ length: 400 }, (_, i) => String.fromCharCode(1 + (i % 25))).join("");
  const out = pdfText(pdf(`BT (${junk}) Tj ET`));
  assert.equal(out.confident, false, "unreadable bytes were offered as the document");
  assert.match(out.why ?? "", /does not read as text/);
});
