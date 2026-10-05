// A snippet the model wrote, inside a file somebody else wrote.
//
// From a real session on a French codebase: « Le fichier contient des caractères accentués que ma
// copie ne reproduit pas à l'identique. Je découpe donc l'édition en petits morceaux sans accents. »
// The model had worked the cause out and was routing around it, writing ever smaller edits that
// avoided the letters it could not reproduce — which is what a defect that costs a whole session
// looks like from the inside.

import { test } from "node:test";
import assert from "node:assert/strict";
import { findUnique } from "../src/core/text/findText.js";

/** `é` as one code point, and as `e` + combining acute. Identical on screen, different strings. */
const NFC = "caractéristique";
const NFD = "caractéristique";

test("an exact snippet is found exactly, and says it needed nothing", () => {
  const found = findUnique("const a = 1;\nconst b = 2;\n", "const b = 2;");
  assert.ok("start" in found);
  assert.equal(found.normalized, false);
  assert.equal("const a = 1;\nconst b = 2;\n".slice(found.start, found.end), "const b = 2;");
});

test("a snippet written in the other normalisation is still found", () => {
  // ⚠️ The defect. The file holds one form, the model emits the other, they render identically, and
  // `indexOf` returns -1 — so the tool said "that snippet does not appear in the file" about a
  // snippet plainly in the file.
  const text = `const nom = "${NFD}";\n`;
  const found = findUnique(text, `const nom = "${NFC}";`);
  assert.ok("start" in found, "the decomposed file should match the composed snippet");
  assert.equal(found.normalized, true, "and it should say it took normalising");
  // The offsets must point into the ORIGINAL text, which is what gets replaced.
  assert.equal(text.slice(found.start, found.end), `const nom = "${NFD}";`);
});

test("and the other way round", () => {
  const text = `const nom = "${NFC}";\n`;
  const found = findUnique(text, `const nom = "${NFD}";`);
  assert.ok("start" in found);
  assert.equal(text.slice(found.start, found.end), `const nom = "${NFC}";`);
});

test("the offsets are right when the match runs to the very end", () => {
  // The map needs one entry past the end, or a snippet ending the file loses its last character.
  const text = `x = "${NFD}"`;
  const found = findUnique(text, `"${NFC}"`);
  assert.ok("start" in found);
  assert.equal(text.slice(found.start, found.end), `"${NFD}"`);
});

test("a snippet that is genuinely absent is absent", () => {
  assert.deepEqual(findUnique("const a = 1;", "const zzz = 9;"), { problem: "absent" });
  assert.deepEqual(findUnique("anything", ""), { problem: "absent" });
});

test("two occurrences are refused, literally or after normalising", () => {
  // ⚠️ The uniqueness rule has to survive normalisation. Two snippets differing only by normalisation
  // ARE the same text to a reader, so picking one would edit a place the model did not mean.
  const twice = findUnique("a\na\n", "a");
  assert.ok("problem" in twice && twice.problem === "ambiguous");

  // ⚠️ And after normalising, when there is no literal match at all: two decomposed occurrences are
  // two places, and composing them must not collapse that into one arbitrary choice.
  const bothDecomposed = `x = "${NFD}";\ny = "${NFD}";\n`;
  const twoNorm = findUnique(bothDecomposed, `"${NFC}"`);
  assert.ok("problem" in twoNorm && twoNorm.problem === "ambiguous");
});

test("a unique literal match is taken even when the file also holds the other form", () => {
  // The rule is "literal first, and literal wins". A file with one composed and one decomposed
  // occurrence has exactly one match for a composed snippet, and taking it keeps the tool
  // predictable — the alternative is refusing an edit that is unambiguous as written.
  const mixed = `x = "${NFC}";\ny = "${NFD}";\n`;
  const found = findUnique(mixed, `"${NFC}"`);
  assert.ok("start" in found);
  assert.equal(found.normalized, false);
  assert.equal(mixed.slice(found.start, found.end), `"${NFC}"`);
});

test("an exact match wins over a normalised one", () => {
  // The literal path stays exact: normalising is a fallback, not the rule. A file holding both forms
  // and a snippet matching one of them literally must take the literal one.
  const text = `${NFD}\n${NFC}\n`;
  const found = findUnique(text, NFD);
  assert.ok("start" in found);
  assert.equal(found.normalized, false);
  assert.equal(found.start, 0, "the literal occurrence is the one at the top");
});
