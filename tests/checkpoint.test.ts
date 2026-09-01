// Going back to before you asked.
//
// Two properties carry this feature, and both are here: the FIRST capture of a file wins, so a
// checkpoint means "before the turn" rather than "somewhere in the middle of it"; and the caps are
// real, because snapshots are whole files living in the editor's shared workspace storage.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  canRestore,
  capture,
  describeRestore,
  MAX_CHECKPOINT_BYTES,
  MAX_FILE_BYTES,
  totalBytes,
  trimCheckpoints,
  type FileSnapshot,
} from "../src/core/session/checkpoint.js";

const WORDS = {
  files: (n: number) => `${n} files back`,
  created: (n: number) => `${n} deleted`,
  partial: "some changes were too large",
};

test("the first capture of a file wins", () => {
  // The property the whole feature rests on. A turn that edits one file four times must restore to
  // the state before the FIRST edit — the third is a state the repository was never in before the
  // question was asked.
  const snaps: FileSnapshot[] = [];
  const first = capture(snaps, "a.ts", "original");
  assert.equal(first.kind, "captured");
  if (first.kind === "captured") snaps.push(first.snapshot);

  assert.equal(capture(snaps, "a.ts", "after the first edit").kind, "already");
  assert.equal(snaps[0]!.before, "original");
});

test("a file that did not exist is recorded as absent, not as empty", () => {
  // Restoring must DELETE it. An empty string would leave a stray empty file behind on every
  // rollback of a turn that created something.
  const result = capture([], "new.ts", undefined);
  assert.equal(result.kind, "captured");
  if (result.kind === "captured") {
    assert.equal("before" in result.snapshot, false);
    assert.equal(result.snapshot.path, "new.ts");
  }
});

test("a file too large is refused, and the refusal is distinguishable", () => {
  const result = capture([], "big.ts", "x".repeat(MAX_FILE_BYTES + 1));
  assert.equal(result.kind, "too-big");
});

test("a turn that changes too much stops, rather than filling the storage", () => {
  const snaps: FileSnapshot[] = [];
  let refused = 0;
  for (let i = 0; i < 40; i++) {
    const r = capture(snaps, `f${i}.ts`, "y".repeat(MAX_FILE_BYTES - 1));
    if (r.kind === "captured") snaps.push(r.snapshot);
    else refused++;
  }
  assert.ok(refused > 0, "the cap has to bite");
  assert.ok(totalBytes(snaps) <= MAX_CHECKPOINT_BYTES);
});

test("accented text counts for more than its length", () => {
  // A cap measured in UTF-16 code units under-counts a file of French prose by half.
  assert.ok(totalBytes([{ path: "a", before: "ééé" }]) > 3);
});

// ── Not letting the history rot ──────────────────────────────────────────────────────────────

test("old checkpoints lose their files and keep their place", () => {
  const entries = Array.from({ length: 20 }, (_, i) => ({
    id: `e${i}`,
    role: "user" as const,
    checkpoint: [{ path: `f${i}.ts`, before: "x" }],
  }));
  const trimmed = trimCheckpoints(entries, 5);
  assert.equal(trimmed.length, 20, "no entry disappears from the transcript");
  assert.equal(trimmed.filter((e) => e.checkpoint).length, 5);
  assert.ok(trimmed[19]!.checkpoint, "the newest keeps its files");
  assert.equal(trimmed[0]!.checkpoint, undefined, "the oldest does not");
});

test("trimming leaves a short conversation alone", () => {
  const entries = [{ id: "a", role: "user" as const, checkpoint: [{ path: "f.ts", before: "x" }] }];
  assert.deepEqual(trimCheckpoints(entries, 5), entries);
});

test("an entry with no files offers no way back", () => {
  assert.equal(canRestore({ id: "a", role: "user" }), false);
  assert.equal(canRestore({ id: "a", role: "user", checkpoint: [] }), false);
  assert.equal(canRestore({ id: "a", role: "user", checkpoint: [{ path: "f.ts" }] }), true);
});

// ── Saying what will happen ──────────────────────────────────────────────────────────────────

test("the description separates files put back from files deleted", () => {
  // They are different consequences, and the second is the surprising one.
  const text = describeRestore([{ path: "a", before: "x" }, { path: "b" }], false, WORDS);
  assert.match(text, /1 files back/);
  assert.match(text, /1 deleted/);
});

test("a partial checkpoint says so before the button is pressed, not after", () => {
  assert.match(describeRestore([{ path: "a", before: "x" }], true, WORDS), /too large/);
  assert.doesNotMatch(describeRestore([{ path: "a", before: "x" }], false, WORDS), /too large/);
});
