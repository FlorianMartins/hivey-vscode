// Going back to before you asked.
//
// The agent edits files. Approving each edit one at a time is the safety net for a change you can
// see; it is no help at all for a change you approved and then, three answers later, decided was
// the wrong direction. Undo in the editor unwinds edits one keystroke at a time across however many
// files were touched, in an order nobody remembers.
//
// A checkpoint is the answer: the content of every file the agent was about to change, captured the
// moment before it changed it, attached to the QUESTION that led there. Restoring one puts the
// files back and rewinds the conversation to just before that question — which is the unit people
// actually think in ("undo that whole idea"), not the unit the filesystem thinks in.
//
// Two properties this file exists to guarantee:
//
//   • THE FIRST CAPTURE WINS. A turn that edits the same file four times must restore to the state
//     before the FIRST edit, not the third. Capturing on every write would make a checkpoint mean
//     "somewhere in the middle of that turn", which is not a state the repository was ever in.
//   • IT CANNOT EAT THE STORAGE. Snapshots are whole file contents living in the editor's
//     workspace state, which is a shared, modest budget. Left alone they would grow without limit
//     and take the conversation history down with them, so the caps below are load-bearing rather
//     than defensive.

/** One file as it stood before a turn touched it. `before` absent means it did not exist. */
export interface FileSnapshot {
  /** Workspace-relative, so a checkpoint survives the folder being moved. */
  path: string;
  before?: string;
}

/** A file bigger than this is not snapshotted: see `SKIPPED` for what that means. */
export const MAX_FILE_BYTES = 128 * 1024;
/** Total across one checkpoint. A single turn that rewrites a generated bundle stops here. */
export const MAX_CHECKPOINT_BYTES = 1024 * 1024;
/** How many questions back you can go. Older checkpoints keep their entry and lose their files. */
export const MAX_CHECKPOINTS = 12;

export type CaptureResult =
  | { kind: "captured"; snapshot: FileSnapshot }
  | { kind: "already" }
  | { kind: "too-big" }
  | { kind: "full" };

/**
 * Add a file to a checkpoint being built, if it belongs there.
 *
 * Returns what happened rather than a boolean, because the three refusals mean different things to
 * the person who will later press Restore: one is "we have it", one is "this file is too big to
 * hold", one is "this turn changed too much". A checkpoint that silently omitted a file would
 * restore a repository to a state that never existed, which is worse than not offering to restore
 * at all — so the caller is expected to mark the checkpoint partial and say so.
 */
export function capture(existing: FileSnapshot[], path: string, before: string | undefined): CaptureResult {
  // The first capture wins: this is the property that makes a checkpoint mean "before the turn".
  if (existing.some((s) => s.path === path)) return { kind: "already" };

  const size = before ? byteLength(before) : 0;
  if (size > MAX_FILE_BYTES) return { kind: "too-big" };
  if (totalBytes(existing) + size > MAX_CHECKPOINT_BYTES) return { kind: "full" };

  return { kind: "captured", snapshot: before === undefined ? { path } : { path, before } };
}

export function totalBytes(snapshots: FileSnapshot[]): number {
  return snapshots.reduce((sum, s) => sum + (s.before ? byteLength(s.before) : 0), 0);
}

/** UTF-16 code units are not bytes, and a file of accented prose is half again as big as it looks. */
function byteLength(text: string): number {
  // `Buffer` is not available in the webview and `TextEncoder` is not free on a megabyte of text,
  // so this is the cheap estimate: ASCII counts one, everything else counts two. It over-counts
  // Latin-1 accents slightly and under-counts nothing that matters, which is the right direction
  // for a cap.
  let bytes = 0;
  for (let i = 0; i < text.length; i++) bytes += text.charCodeAt(i) < 128 ? 1 : 2;
  return bytes;
}

export interface CheckpointBearer {
  id: string;
  role: "user" | "assistant";
  checkpoint?: FileSnapshot[];
  /** True when something the turn changed could not be held. Restoring is then partial, and says so. */
  checkpointPartial?: boolean;
}

/**
 * Drop the file contents of every checkpoint but the most recent few.
 *
 * The entries keep their place in the transcript; what they lose is the ability to restore. That
 * asymmetry is deliberate — a conversation must not become unopenable because it once edited a lot
 * of files, and the twelfth question back is not one anybody rolls back to.
 */
export function trimCheckpoints<T extends CheckpointBearer>(entries: T[], keep = MAX_CHECKPOINTS): T[] {
  const withCheckpoints = entries.filter((e) => e.checkpoint?.length);
  if (withCheckpoints.length <= keep) return entries;
  const doomed = new Set(withCheckpoints.slice(0, withCheckpoints.length - keep).map((e) => e.id));
  return entries.map((e) => {
    if (!doomed.has(e.id)) return e;
    const { checkpoint, checkpointPartial, ...rest } = e;
    return rest as T;
  });
}

/** Whether an entry offers a way back. */
export function canRestore(entry: CheckpointBearer): boolean {
  return Boolean(entry.checkpoint?.length);
}

/**
 * What restoring this checkpoint will do, in the user's terms.
 *
 * Shown in the confirmation, because restoring OVERWRITES files that may have been edited by hand
 * since — which is the one thing about this feature that can lose work, and therefore the one thing
 * that must be stated before it happens rather than explained afterwards.
 */
export function describeRestore(
  snapshots: FileSnapshot[],
  partial: boolean,
  words: {
    files: (n: number) => string;
    created: (n: number) => string;
    partial: string;
  },
): string {
  const created = snapshots.filter((s) => s.before === undefined).length;
  const lines = [words.files(snapshots.length - created)];
  if (created) lines.push(words.created(created));
  if (partial) lines.push(words.partial);
  return lines.join(" ");
}
