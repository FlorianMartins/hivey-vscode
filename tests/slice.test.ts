// Reading part of a file, and saying what was left out.
//
// From a real session on a 6,500-line file: « read_file coupe le fichier avant la zone utile. Je lis
// les deux passages par une commande. » The tool took a path and nothing else, returned the head, and
// said "truncated if very large" in its description — so on any file long enough to matter the model
// could not reach what it needed, and shelled out to `sed`. A tool that truncates without saying how
// to continue has told the model the file ends there.

import { test } from "node:test";
import assert from "node:assert/strict";
import { describeSlice, sliceLines } from "../src/core/fs/slice.js";

const FILE = Array.from({ length: 200 }, (_, i) => `line ${i + 1}`).join("\n");

test("a whole small file comes back whole, and says nothing about it", () => {
  // A note on every read is noise that teaches the model to skip the notes that matter.
  const slice = sliceLines("a\nb\nc");
  assert.equal(slice.text, "a\nb\nc");
  assert.equal(describeSlice(slice, "x.ts"), "");
});

test("a range is honoured, 1-based and inclusive at both ends", () => {
  const slice = sliceLines(FILE, 10, 12);
  assert.equal(slice.text, "line 10\nline 11\nline 12");
  assert.equal(slice.from, 10);
  assert.equal(slice.to, 12);
  assert.equal(slice.total, 200);
});

test("the notice says where you are and how to read on", () => {
  // ⚠️ The second half of the fix, and as important as the range: without the next call spelled out,
  // a model that has been handed lines 1-40 of 200 has no reason to believe there are 160 more.
  const said = describeSlice(sliceLines(FILE, 1, 40), "src/guilde.js");
  assert.match(said, /lines 1-40 of 200/);
  assert.match(said, /from: 41/);
  assert.match(said, /src\/guilde\.js/);
});

test("the last slice offers no next page, because there is none", () => {
  const said = describeSlice(sliceLines(FILE, 190, 200), "x.ts");
  assert.match(said, /lines 190-200 of 200/);
  assert.equal(/Read on/.test(said), false);
});

test("a budget cuts at a line boundary, never mid-line", () => {
  // ⚠️ Half a line of source reads as a syntax error that is not there, and a model that believes it
  // will "fix" something nobody broke.
  const slice = sliceLines(FILE, 1, 200, 40);
  assert.equal(slice.truncated, true);
  assert.equal(slice.text.endsWith("\n"), false);
  for (const line of slice.text.split("\n")) assert.match(line, /^line \d+$/);
});

test("a budget smaller than one line still returns that line", () => {
  // Returning nothing because the first line does not fit is a tool that answers "the file is empty".
  const slice = sliceLines("a very long single line indeed", 1, 1, 5);
  assert.equal(slice.text, "a very long single line indeed");
});

test("a range outside the file is clamped rather than refused", () => {
  // A model guessing "line 9000" of a 200-line file has made an ordinary mistake, and the useful
  // answer is the end of the file plus a notice, not an error.
  const slice = sliceLines(FILE, 9000, 9999);
  assert.equal(slice.from, 200);
  assert.equal(slice.to, 200);
  assert.equal(slice.text, "line 200");
});

test("a reversed range is read forwards", () => {
  const slice = sliceLines(FILE, 50, 10);
  assert.equal(slice.from, 50);
  assert.equal(slice.to, 50);
});
