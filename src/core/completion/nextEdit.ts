// The edit you are about to make somewhere else.
//
// Completion answers "what comes next at the cursor". It is the wrong question about half the time,
// because most editing is not writing new code — it is propagating a change: you rename a field and
// four call sites now say the old name, you add a parameter and the callers are wrong, you change a
// return type and the error handling below no longer compiles. The cursor is in none of those
// places, so a cursor completion cannot help with any of them, and the user goes hunting.
//
// What makes this affordable is the same thing that makes completion affordable here: the model
// that answers it is the one already running on the machine, so a suggestion that turns out to be
// wrong costs a few hundred milliseconds of a laptop's own GPU and nothing else. That is why this
// is deliberately NOT offered on a paid endpoint unless somebody asks for it — a feature that fires
// on every pause in typing is the most expensive shape a remote request can take, and it is exactly
// the shape this project exists to argue against.
//
// The other half is what makes it safe: the model proposes an exact snippet to find and what to put
// in its place, and every proposal is checked against the file before it is ever shown. A snippet
// that does not appear, appears more than once, or lands on the line being typed is discarded
// without a word. A wrong suggestion the user has to notice and reject is worse than no suggestion.

import { unifiedDiff } from "../text/diff.js";

/** One change, as the editor saw it happen. */
export interface EditEvent {
  path: string;
  /** Milliseconds since the epoch. */
  at: number;
  before: string;
  after: string;
}

/**
 * How far back a change still counts as "what I am doing now".
 *
 * Thirty seconds is roughly one thought. Longer and the prediction starts describing work that is
 * finished, which produces suggestions to undo things the user deliberately did.
 */
export const RECENT_MS = 30_000;

/** The most recent edits still worth describing, oldest first. */
export function recentEdits(events: EditEvent[], now: number, windowMs = RECENT_MS): EditEvent[] {
  return events.filter((e) => now - e.at <= windowMs).sort((a, b) => a.at - b.at);
}

/**
 * What the user has just done, as diffs.
 *
 * One diff per file rather than one per keystroke: an edit journal records every change, and a
 * hundred single-character diffs describe typing rather than intent. Collapsing to first-seen-before
 * against last-seen-after turns "t, to, tot, tota, total" into "→ total", which is the thing worth
 * telling a model about.
 */
export function describeRecentWork(events: EditEvent[], now: number, maxChars = 2000): string {
  const recent = recentEdits(events, now);
  if (!recent.length) return "";

  const first = new Map<string, string>();
  const last = new Map<string, string>();
  for (const event of recent) {
    if (!first.has(event.path)) first.set(event.path, event.before);
    last.set(event.path, event.after);
  }

  const diffs: string[] = [];
  let budget = maxChars;
  for (const [path, before] of first) {
    if (budget <= 0) break;
    const diff = unifiedDiff(path, before, last.get(path) ?? before, { context: 2, maxChars: budget });
    if (!diff) continue;
    budget -= diff.length;
    diffs.push(diff);
  }
  return diffs.join("\n\n");
}

export interface NextEditRequest {
  /** The file the user is in. */
  path: string;
  /** Its full text, as it stands now. */
  text: string;
  /** The line the cursor is on, zero-based. Nothing is ever proposed here. */
  cursorLine: number;
  /** What the user has just changed, from `describeRecentWork`. */
  recentWork: string;
  languageId: string;
}

/**
 * The prompt, and why it is shaped like a tool call rather than like a diff.
 *
 * Asking a 7B model for a unified diff produces something that looks like a diff and does not
 * apply: the line numbers are invented and the context lines are approximations. Asking for a
 * snippet to find and its replacement gives it a job it is actually good at — copying a few lines
 * out of a file it can see — and gives us a proposal that can be checked exactly. If the snippet is
 * not in the file, there is nothing to argue about.
 */
export function buildNextEditPrompt(req: NextEditRequest): string {
  return [
    `You are looking at ${req.path} (${req.languageId}).`,
    "",
    "The developer has just made this change:",
    "",
    req.recentWork,
    "",
    "Here is the file as it now stands:",
    "",
    "<<<FILE",
    req.text,
    "FILE",
    "",
    "Somewhere ELSE in this file there is probably one more edit that follows from what they just",
    "did: a call site that still uses the old name, a branch that no longer matches, an import that",
    "is now unused or now missing. Find at most ONE such place and answer with exactly this, and",
    "nothing else:",
    "",
    "FIND",
    "<the exact lines to replace, copied character for character from the file>",
    "REPLACE",
    "<what those lines should say instead>",
    "END",
    "",
    `Rules: the FIND block must appear exactly once in the file and must not be on line ${req.cursorLine + 1},`,
    "where the developer is typing. Keep it short — a few lines at most. If there is no such edit,",
    "answer with the single word NONE.",
  ].join("\n");
}

export interface NextEdit {
  find: string;
  replace: string;
}

/** Pull the proposal out of whatever the model wrapped it in. */
export function parseNextEdit(answer: string): NextEdit | undefined {
  const text = answer.replace(/```[a-z]*\n?/gi, "").trim();
  if (/^NONE\b/i.test(text)) return undefined;
  const match = /FIND\s*\n([\s\S]*?)\nREPLACE\s*\n([\s\S]*?)(?:\nEND\b|$)/i.exec(text);
  if (!match) return undefined;
  const find = match[1] ?? "";
  const replace = match[2] ?? "";
  // A proposal that changes nothing is not a proposal; an empty FIND would match everywhere.
  if (!find.trim() || find === replace) return undefined;
  return { find, replace };
}

export type Rejection = "not-found" | "ambiguous" | "at-cursor" | "unchanged" | "too-large";

export interface Checked {
  ok: boolean;
  /** Character offset of the match, when there is exactly one. */
  offset?: number;
  why?: Rejection;
}

/** Above this the "suggestion" is a rewrite, and a rewrite is not something to accept blind. */
const MAX_FIND_LINES = 12;

/**
 * Is this proposal one we can show?
 *
 * Every rejection here is silent. The model is running on a laptop and is wrong a fair amount of
 * the time; a suggestion the user has to read and dismiss costs them more attention than the
 * feature saves, so anything that does not check out is simply never drawn.
 */
export function checkNextEdit(edit: NextEdit, text: string, cursorLine: number): Checked {
  if (edit.find === edit.replace) return { ok: false, why: "unchanged" };
  if (edit.find.split("\n").length > MAX_FIND_LINES) return { ok: false, why: "too-large" };

  const first = text.indexOf(edit.find);
  if (first < 0) return { ok: false, why: "not-found" };
  if (text.indexOf(edit.find, first + 1) >= 0) return { ok: false, why: "ambiguous" };

  // The line the user is typing on belongs to completion, not to this. Two things suggesting edits
  // to the same line at the same time is a fight the user has to referee.
  const startLine = text.slice(0, first).split("\n").length - 1;
  const endLine = startLine + edit.find.split("\n").length - 1;
  if (cursorLine >= startLine - 1 && cursorLine <= endLine + 1) return { ok: false, why: "at-cursor" };

  return { ok: true, offset: first };
}

/** A one-line summary for the hint the editor shows, e.g. "rename to totalCents". */
export function summarise(edit: NextEdit): string {
  const from = edit.find.trim().split("\n")[0]?.trim() ?? "";
  const to = edit.replace.trim().split("\n")[0]?.trim() ?? "";
  const short = (s: string): string => (s.length > 48 ? `${s.slice(0, 47)}…` : s);
  if (!to) return `remove ${short(from)}`;
  return `${short(from)} → ${short(to)}`;
}
