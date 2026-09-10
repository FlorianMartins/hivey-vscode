// A unified diff, written here because the project ships no runtime dependency.
//
// What it is for decides what is tested: the diff is read by a MODEL, to know what a previous
// attempt changed. So the format has to be the one every model has seen a million of, the line
// numbers have to be right (a model that trusts a wrong `@@` edits the wrong place), and it must
// not fall over on a large file — the failure that would take the whole extension host with it.

import { test } from "node:test";
import assert from "node:assert/strict";
import { changedLines, diffLines, unifiedDiff } from "../src/core/text/diff.js";

test("identical texts produce nothing at all", () => {
  assert.equal(unifiedDiff("a.ts", "one\ntwo\n", "one\ntwo\n"), "");
  assert.equal(changedLines("same", "same"), 0);
});

test("a one-line change names the line it changed", () => {
  const before = "const a = 1;\nconst b = 2;\nconst c = 3;\n";
  const after = "const a = 1;\nconst b = 22;\nconst c = 3;\n";
  const diff = unifiedDiff("src/app.ts", before, after);
  assert.match(diff, /^--- a\/src\/app\.ts\n\+\+\+ b\/src\/app\.ts\n/);
  assert.match(diff, /^@@ -1,3 \+1,3 @@$/m);
  assert.match(diff, /^-const b = 2;$/m);
  assert.match(diff, /^\+const b = 22;$/m);
  assert.match(diff, /^ const a = 1;$/m, "context lines carry a leading space, as the format requires");
});

test("the line numbers are the ones a reader would count", () => {
  // A model that trusts a wrong hunk header edits the wrong place, and the mistake is invisible
  // until someone opens the file.
  const before = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`).join("\n");
  const after = before.replace("line 12", "LINE 12");
  const diff = unifiedDiff("f.txt", before, after);
  const header = /@@ -(\d+),(\d+) \+(\d+),(\d+) @@/.exec(diff);
  assert.ok(header, `no hunk header in:\n${diff}`);
  assert.equal(header![1], "9", "three lines of context before line 12 starts the hunk at 9");
  assert.equal(header![2], "7", "three before, the change, three after");
});

test("two changes far apart are two hunks; two changes close together are one", () => {
  const before = Array.from({ length: 40 }, (_, i) => `l${i}`).join("\n");
  const far = before.replace("l2", "X").replace("l30", "Y");
  assert.equal((unifiedDiff("f", before, far).match(/^@@/gm) ?? []).length, 2);

  const near = before.replace("l10", "X").replace("l13", "Y");
  const merged = unifiedDiff("f", before, near);
  assert.equal((merged.match(/^@@/gm) ?? []).length, 1, "overlapping context printed the same lines twice");
  assert.equal((merged.match(/^ l11$/gm) ?? []).length, 1);
});

test("insertions and deletions at the edges of a file are found", () => {
  assert.match(unifiedDiff("f", "b\nc\n", "a\nb\nc\n"), /^\+a$/m);
  assert.match(unifiedDiff("f", "a\nb\nc\n", "a\nb\n"), /^-c$/m);
  assert.match(unifiedDiff("f", "", "new\n"), /^\+new$/m);
  assert.match(unifiedDiff("f", "gone\n", ""), /^-gone$/m);
});

test("a trailing newline is not a phantom last line", () => {
  const changes = diffLines("a\nb\n", "a\nb\n");
  assert.deepEqual(
    changes.map((c) => c.op),
    ["same", "same"],
  );
});

test("a huge file does not build a table with a billion cells in it", () => {
  // The failure this prevents is not a wrong answer, it is the extension host dying. Twenty
  // thousand lines against twenty thousand lines is four hundred million cells in the textbook
  // algorithm; here the identical head and tail are stripped first, so the comparison is one line
  // against one line.
  const big = Array.from({ length: 20000 }, (_, i) => `line ${i}`).join("\n");
  const edited = big.replace("line 9999", "CHANGED");
  const started = Date.now();
  const diff = unifiedDiff("big.txt", big, edited);
  assert.ok(Date.now() - started < 2000, "stripping the common head and tail did not happen");
  assert.match(diff, /^\+CHANGED$/m);
  assert.equal((diff.match(/^@@/gm) ?? []).length, 1);
});

test("two large texts with nothing in common are reported coarsely rather than not at all", () => {
  // No common head, no common tail, both sides past the ceiling: the honest answer is "this block
  // became that block", which is a worse diff and an answer. The alternative is an editor that
  // freezes.
  const a = Array.from({ length: 3000 }, (_, i) => `a${i}`).join("\n");
  const b = Array.from({ length: 3000 }, (_, i) => `b${i}`).join("\n");
  const started = Date.now();
  const diff = unifiedDiff("x", a, b);
  assert.ok(Date.now() - started < 2000);
  assert.match(diff, /^-a0$/m);
  assert.match(diff, /^\+b0$/m);
});

test("an enormous diff is cut, and says so", () => {
  const before = Array.from({ length: 400 }, (_, i) => `x${i}`).join("\n");
  const after = Array.from({ length: 400 }, (_, i) => `y${i}`).join("\n");
  const cut = unifiedDiff("f", before, after, { maxChars: 500 });
  assert.ok(cut.length <= 520, `still ${cut.length} characters`);
  assert.match(cut, /diff truncated/);
});
