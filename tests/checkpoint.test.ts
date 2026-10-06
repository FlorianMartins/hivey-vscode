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
  turnBoundary,
  type FileSnapshot,
  restoreIsComplete,
  transcriptPieces,
} from "../src/core/session/checkpoint.js";

const WORDS = {
  commands: (n: number) => `${n} commands not undone`,
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

test("the transcript's FIRST question still offers a way back", () => {
  // ⚠️ The defect this pins, reported by Florian: "sur le premier message d'une conversation il n'y
  // a pas de reverse possible". The transcript drew the restore on the separating line between two
  // turns, and skipped that line above the first question — correctly, there being nothing above it
  // to separate. The restore went with it, so no conversation could undo its opening turn: the one
  // turn where the agent works on an untouched repository, and therefore the one most worth undoing.
  const opening = turnBoundary("user", true);
  assert.equal(opening?.restore, true, "the first question must be restorable");
  assert.equal(opening?.line, false, "and must not draw a line it has nothing to separate from");
});

test("a later question gets both the line and the way back", () => {
  assert.deepEqual(turnBoundary("user", false), { restore: true, line: true });
});

test("an answer starts no turn, so it gets neither", () => {
  // The boundary belongs to the question. Drawing it on the answer would put a restore between a
  // question and its own reply, which is not a point the conversation was ever at.
  assert.equal(turnBoundary("assistant", false), undefined);
  assert.equal(turnBoundary("assistant", true), undefined);
});

test("a restore that leaves a command's work behind says so", () => {
  // ⚠️ The hole a checkpoint cannot cover. It is built in `confirmEdit`, so it holds exactly what
  // the EDIT TOOLS touched; nothing knows which files `prettier --write`, `sed -i` or a build that
  // regenerates a stylesheet will rewrite before they run. Restoring puts the tool edits back and
  // leaves the rest, and the dialog has to say that before the button is pressed, not after.
  const said = describeRestore([{ path: "a.ts", before: "x" }], false, WORDS, 3);
  assert.match(said, /1 files back/);
  assert.match(said, /3 commands not undone/);
});

test("no commands, no sentence about commands", () => {
  const said = describeRestore([{ path: "a.ts", before: "x" }], false, WORDS, 0);
  assert.equal(/commands/.test(said), false);
});

test("restoreIsComplete is false as soon as anything was left out", () => {
  // The two holes are different and either one is enough to make a rollback partial.
  assert.equal(restoreIsComplete({ id: "1", role: "user" }), true);
  assert.equal(restoreIsComplete({ id: "1", role: "user", checkpointPartial: true }), false);
  assert.equal(restoreIsComplete({ id: "1", role: "user", checkpointCommands: 1 }), false);
});

test("the transcript draws a restore above the FIRST question", () => {
  // ⚠️⚠️ The assertion that should have existed three reports ago. `turnBoundary` had a test saying
  // the opening turn is restorable, and it could not see whether the renderer called it, skipped the
  // entry first, or drew anything at all. Reported false three times while the code said true.
  const pieces = transcriptPieces([
    { id: "q1", role: "user" },
    { id: "a1", role: "assistant" },
    { id: "q2", role: "user" },
    { id: "a2", role: "assistant" },
  ]);
  assert.deepEqual(pieces, [
    { kind: "rule", id: "q1", opening: true },
    { kind: "entry", id: "q1", first: true },
    { kind: "entry", id: "a1", first: false },
    { kind: "rule", id: "q2", opening: false },
    { kind: "entry", id: "q2", first: false },
    { kind: "entry", id: "a2", first: false },
  ]);
  // ⚠️ `first` decides WHERE the way back is drawn, and the two places are not interchangeable: the
  // opening question has no bar above it to put a label on, so it carries an icon in its own header,
  // and every other turn carries the words "Restore Checkpoint" on its bar. Asked for in exactly
  // those terms. Computing "am I the first?" in the renderer instead would be the untested loop this
  // whole function exists to replace.
});

test("a conversation of one question still offers its way back", () => {
  // The state a fresh conversation is in for its entire first turn — and the turn where the agent
  // works on an untouched repository, so the one most worth undoing.
  const pieces = transcriptPieces([{ id: "q1", role: "user" }]);
  assert.deepEqual(pieces, [
    { kind: "rule", id: "q1", opening: true },
    { kind: "entry", id: "q1", first: true },
  ]);
});

test("the answer being streamed is left to the live turn, and does not consume `first`", () => {
  // A streaming entry is drawn elsewhere. If skipping it also advanced the "is this the first entry"
  // flag, the opening question would lose its rule the moment an answer began arriving.
  const pieces = transcriptPieces([
    { id: "a0", role: "assistant", streaming: true },
    { id: "q1", role: "user" },
  ]);
  assert.deepEqual(pieces, [
    { kind: "rule", id: "q1", opening: true },
    // And it is still the FIRST, so it still carries the header control. A streaming answer that
    // consumed the flag would leave the opening question with no way back at all.
    { kind: "entry", id: "q1", first: true },
  ]);
});

test("a search that hides the first question makes the next visible one the opening", () => {
  // Whatever is drawn first is what has nothing above it, so that is where the line is dropped —
  // otherwise a filtered transcript opens with a rule separating it from nothing.
  const pieces = transcriptPieces(
    [
      { id: "q1", role: "user" },
      { id: "q2", role: "user" },
    ],
    { visible: (id) => id === "q2" },
  );
  assert.deepEqual(pieces, [
    { kind: "rule", id: "q2", opening: true },
    { kind: "entry", id: "q2", first: true },
  ]);
});
