// Putting back what a COMMAND changed, which no checkpoint can hold.
//
// Florian: « le restore to checkpoint semble pas fonctionnel globalement, il faudrait qu'il fasse un
// flash du ou des programmes avant la modification pour y revenir par la suite ».
//
// A checkpoint is built in `confirmEdit`, so it holds exactly what the edit tools touched. A command
// is opaque — `prettier --write`, `sed -i`, a build that regenerates a stylesheet, or an agent that
// resorted to `node -e` because `edit_file` was failing — and nothing knows which files it will
// rewrite before it runs. So those turns had nothing to put back, truthfully, and the dialog said so.
//
// ⚠️ The snapshot it wants already exists, and it is not ours: a git working tree IS the file's
// previous state, kept by something built for the job. A file that was UNMODIFIED when the turn began
// can be put back exactly, by discarding its working-tree changes. No shell, no copy of the
// repository, no new format — the editor's own Git extension does it.
//
// What this deliberately will NOT touch:
//
//   • a file the user had already modified before the turn started. Discarding its changes would
//     throw away their work to undo ours, which is a worse outcome than not undoing ours.
//   • a file the checkpoint already holds. Two mechanisms racing to restore one file is how one of
//     them wins by accident.
//   • an untracked file. Git has no previous state for something it has never seen, so there is
//     nothing to go back to — and the dialog has to say that rather than imply the turn was undone.

export interface GitRestorePlan {
  /** Paths git can put back exactly, because they were unmodified when the turn began. */
  restorable: string[];
  /** Changed during the turn, and left alone because the user's own edits were already in them. */
  keptBecauseYours: string[];
}

/**
 * What git can and cannot undo for this turn.
 *
 * @param dirtyBefore paths that already had working-tree changes when the turn started.
 * @param dirtyNow paths that have working-tree changes now.
 * @param snapshotted paths the checkpoint already holds, which restore by their own route.
 */
export function planGitRestore(
  dirtyBefore: Iterable<string>,
  dirtyNow: Iterable<string>,
  snapshotted: Iterable<string> = [],
): GitRestorePlan {
  const before = new Set(dirtyBefore);
  const held = new Set(snapshotted);
  const restorable: string[] = [];
  const keptBecauseYours: string[] = [];
  for (const path of new Set(dirtyNow)) {
    if (held.has(path)) continue;
    if (before.has(path)) keptBecauseYours.push(path);
    else restorable.push(path);
  }
  // Sorted, so the dialog listing them reads the same twice and a test can compare it.
  return { restorable: restorable.sort(), keptBecauseYours: keptBecauseYours.sort() };
}
