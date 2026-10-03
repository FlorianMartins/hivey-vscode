// A branch and a directory of its own, so a background task cannot disturb the one being worked in.
//
// The isolation that matters here is not the container — that is about commands — it is the WORKING
// TREE. A background agent editing the same files as the person who started it produces a conflict
// nobody asked for, in the middle of their own edit, with no indication of which change was whose.
// A `git worktree` gives the task its own directory and its own branch at the cost of one command.
//
// ⚠️ And the agent never pushes. Not "is discouraged from pushing": there is no tool for it, the
// branch stays local, and a test reads this module to check that no git invocation here is a push.
// A background agent that pushes is a background agent that put code on a server while its author
// was at lunch.

/**
 * A branch name from what the task was asked to do.
 *
 * Prefixed, so the branches a person made and the branches an agent made are never confused in a
 * list — which is what somebody needs when they come back to nine of them.
 */
export function branchName(task: string, now = new Date()): string {
  const slug = task
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/, "");
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
  return `hivey/${slug || "task"}-${stamp}`;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/**
 * The git arguments that create the worktree, in order.
 *
 * `--detach` is deliberately NOT used: a named branch is what makes the work findable afterwards,
 * and a detached head is work somebody has to rescue. The branch is created from the current HEAD
 * rather than from a remote, because fetching is a network operation a background task has no
 * business performing.
 */
export function createWorktreeArgv(path: string, branch: string): string[] {
  return ["worktree", "add", "-b", branch, path, "HEAD"];
}

/** Removing it. `--force` because the task may have left files git does not know about. */
export function removeWorktreeArgv(path: string): string[] {
  return ["worktree", "remove", "--force", path];
}

/** What changed, as a diff against the branch point. The report a person reads when they come back. */
export function diffArgv(): string[] {
  return ["diff", "HEAD", "--stat"];
}

/** The full patch, for the editor to open. */
export function patchArgv(): string[] {
  return ["diff", "HEAD"];
}

/**
 * Everything git is allowed to be asked to do from a background task.
 *
 * An allow-list, and the reason is the same as plan mode's: a new git call is powerless until it is
 * named here, and `push` is not here and is not going to be.
 */
export const ALLOWED_GIT = new Set(["worktree", "diff", "status", "add", "commit", "stash", "rev-parse"]);

export function gitAllowed(argv: string[]): boolean {
  const verb = argv[0] ?? "";
  return ALLOWED_GIT.has(verb);
}
