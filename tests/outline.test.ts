// What is sent when an attached file does not fit.

import { test } from "node:test";
import assert from "node:assert/strict";
import { fileExcerpt } from "../src/core/context/outline.js";
import { estimateTokens } from "../src/core/util/tokens.js";

/** A module far larger than any sane attachment budget, with a landmark at the very bottom. */
function bigModule(): string {
  const middle = Array.from(
    { length: 400 },
    (_, i) => `export function helper${i}(value: string): string {\n  // padding padding padding padding padding\n  return value + "${i}";\n}\n`,
  ).join("\n");
  return `import { join } from "node:path";\n\n${middle}\nexport function theLastThingInTheFile(): number {\n  return 42;\n}\n`;
}

test("a file that fits is sent as it is", () => {
  const text = "export const a = 1;\n";
  const excerpt = fileExcerpt("src/a.ts", text, 4_000);
  assert.equal(excerpt.body, text);
  assert.equal(excerpt.outlined, false);
});

test("a file that does not fit keeps its budget", () => {
  const excerpt = fileExcerpt("src/big.ts", bigModule(), 2_000);
  assert.ok(estimateTokens(excerpt.body) <= 2_200, `${estimateTokens(excerpt.body)} tokens for a 2 000 budget`);
});

test("the last symbol of a huge file is still visible, which head-truncation could never do", () => {
  // The defect this replaces. Cutting a 3 000-line module to its first N lines tells the model
  // about the imports and the first two functions and HIDES the existence of everything else — so
  // it answers about a file it believes it has read. The outline costs a fraction of the same
  // tokens and names every declaration in the file.
  const excerpt = fileExcerpt("src/big.ts", bigModule(), 2_000);
  assert.ok(excerpt.outlined, "the file was truncated rather than outlined");
  assert.match(
    excerpt.body,
    /theLastThingInTheFile/,
    "the end of the file is invisible, which is exactly what sending the head does",
  );
});

test("the head of the file survives beside the outline", () => {
  // Both halves matter: the outline says what is in the file, the head says how it starts.
  const excerpt = fileExcerpt("src/big.ts", bigModule(), 2_000);
  assert.match(excerpt.body, /import \{ join \}/);
});

test("prose has nothing to outline, and its head is the right answer", () => {
  const prose = "This is a long report about nothing in particular. ".repeat(2_000);
  const excerpt = fileExcerpt("docs/report.md", prose, 500);
  assert.equal(excerpt.outlined, false);
  assert.ok(estimateTokens(excerpt.body) <= 600);
});
