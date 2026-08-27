// Deciding what the agent may do without asking.
//
// The permission book already answers "has the user allowed THIS action before". This answers a
// different question, asked once and applying to everything after: "which parts of my machine is
// this thing allowed to touch without checking". A developer who has chosen to let an agent work
// through a refactor does not want forty dialogs; a developer who has not should not be one
// mistaken click away from a command running anywhere.
//
// Three scopes, and the middle one is the one worth having:
//
//   off        every change is asked. The default, and the right one for a first session.
//   workspace  changes INSIDE the open folder run; anything outside it is still asked.
//   all        nothing is asked. Genuinely dangerous, and named so.
//
// Alongside the scope there are two lists, and the order between them is the whole safety property:
//
//   DENIED   paths and commands the agent may never touch, whatever else is set.
//   ALLOWED  paths and commands that run without asking, whatever the scope.
//
// Refusals are evaluated first and cannot be overridden. Turning the scope up, or listing something
// as allowed, can never reach the denied list — which is what makes it safe to hand someone the
// dangerous scope at all.
//
// Two further rules hold whatever the scope, and neither is the user's to switch off here:
//
//   • THE PRIVACY BLOCK LIST STILL WINS. `.env`, keys, `secrets/**` are refused outright. A bypass
//     is about how often you are interrupted, never about what the agent may read or overwrite.
//   • THE EGRESS GATE IS UNTOUCHED. This governs what happens on the machine. What LEAVES it is a
//     separate question with a separate consent, and no setting here relaxes it.

export type ApprovalScope = "off" | "workspace" | "all";

export interface AutoApprovePolicy {
  scope: ApprovalScope;
  /** Extra paths allowed regardless of scope, as globs relative to the workspace root. */
  allowedPaths: string[];
  /** Command prefixes that may run without asking — `npm test`, `git status`. */
  allowedCommands: string[];
  /**
   * Paths the agent may never change, whatever the scope. Distinct from `blockedGlobs`, and the
   * distinction is real: the privacy list is about what may LEAVE the machine, this one about what
   * may be TOUCHED on it. Someone may be perfectly happy for the agent to read `migrations/` and
   * never to write it; someone may want `dist/` left alone without hiding it from the model.
   */
  deniedPaths: string[];
  /** Commands that may never run, whatever else is allowed. `git push`, `rm`, `kubectl`. */
  deniedCommands: string[];
  /** Never allowed, whatever the scope says. The privacy policy's own list. */
  blockedGlobs: string[];
}

export interface Request {
  tool: string;
  /** For a tool that touches a file. Relative to the workspace root when inside it. */
  path?: string;
  /** True when `path` resolves inside the open folder. The caller resolves this; globs cannot. */
  insidePath?: boolean;
  /** For `run_command` and friends. */
  command?: string;
}

export type Decision =
  | { allow: true; because: string }
  | { allow: false; because?: string };

/**
 * Whether this action can run without asking.
 *
 * Written to be read as a sequence of refusals followed by a sequence of permissions, because that
 * is the order the reasoning has to happen in: something forbidden must not become allowed further
 * down the function, however many scopes were switched on.
 */
export function autoApprove(policy: AutoApprovePolicy, request: Request, match: GlobMatcher): Decision {
  // ── Refusals first ──────────────────────────────────────────────────────────────────────────

  if (request.path && policy.blockedGlobs.some((glob) => match(request.path!, glob))) {
    return { allow: false, because: "the privacy policy excludes this path" };
  }

  if (request.path && policy.deniedPaths.some((glob) => match(request.path!, glob))) {
    return { allow: false, because: "this path is on your denied list" };
  }

  if (request.command) {
    // Denied prefixes use the same word-boundary rule as allowed ones, but a chained command is
    // treated in the opposite direction: an allowed prefix does not cover `npm test && rm -rf /`,
    // while a denied prefix must still catch `ls && git push`. A refusal that can be escaped by
    // adding `&&` is not a refusal.
    const denied = policy.deniedCommands.find((prefix) => commandContains(request.command!, prefix));
    if (denied) return { allow: false, because: `“${denied}” is on your denied list` };
  }

  // ── Then permissions ────────────────────────────────────────────────────────────────────────

  if (request.path && policy.allowedPaths.some((glob) => match(request.path!, glob))) {
    return { allow: true, because: "this path is on your allowed list" };
  }

  if (request.command) {
    const prefix = policy.allowedCommands.find((allowed) => commandMatches(request.command!, allowed));
    if (prefix) return { allow: true, because: `“${prefix}” is on your allowed list` };
  }

  switch (policy.scope) {
    case "all":
      return { allow: true, because: "approvals are switched off" };

    case "workspace":
      // A path outside the open folder is exactly the case this scope exists to keep asking about:
      // "let it work in my project" is not "let it work in my home directory".
      if (request.path) {
        return request.insidePath
          ? { allow: true, because: "inside the open folder" }
          : { allow: false, because: "outside the open folder" };
      }
      // A command has no path to check. `cd /` is a command inside the folder in every sense the
      // filesystem can see and in none that matters, so commands keep asking unless one of the
      // allowed prefixes covers them.
      return { allow: false, because: "a command can leave the folder whatever its working directory" };

    case "off":
    default:
      return { allow: false };
  }
}

export type GlobMatcher = (path: string, glob: string) => boolean;

/**
 * Whether a command is covered by an allowed prefix.
 *
 * Word-boundary matching, not `startsWith`. Allowing `git status` must not allow
 * `git status-and-then-something`, and — the case that matters — allowing `npm test` must not allow
 * `npm testpublish`. Chained commands are refused outright: `npm test && rm -rf /` starts with an
 * allowed prefix and is not an allowed command.
 */
export function commandMatches(command: string, allowed: string): boolean {
  const clean = command.trim();
  if (/[;&|`]|\$\(|\n/.test(clean)) return false;
  const prefix = allowed.trim();
  if (!prefix) return false;
  if (clean === prefix) return true;
  return clean.startsWith(prefix) && /\s/.test(clean.charAt(prefix.length));
}

/**
 * Whether a denied prefix appears anywhere in a command line.
 *
 * The mirror image of `commandMatches`, and deliberately not the same function. An ALLOWANCE must
 * be narrow: `npm test` permits `npm test --watch` and nothing chained after it. A REFUSAL must be
 * broad: if `git push` is denied, then `ls && git push` is denied, because a refusal that is escaped
 * by typing `&&` protects nobody. Same words, opposite appetites.
 */
export function commandContains(command: string, prefix: string): boolean {
  const needle = prefix.trim();
  if (!needle) return false;
  // Split on the shell operators that begin a new command, then apply the boundary rule to each.
  for (const part of command.split(/&&|\|\||[;&|\n]|\$\(|`/)) {
    const clean = part.trim();
    if (!clean) continue;
    if (clean === needle) return true;
    if (clean.startsWith(needle) && /\s/.test(clean.charAt(needle.length))) return true;
  }
  return false;
}

/** A short description of the policy, for the interface. */
export function describeScope(scope: ApprovalScope): string {
  switch (scope) {
    case "all":
      return "Every action runs without asking, anywhere on this machine.";
    case "workspace":
      return "Changes inside the open folder run without asking. Commands, and anything outside it, are still asked.";
    case "off":
    default:
      return "Every change is asked for.";
  }
}
