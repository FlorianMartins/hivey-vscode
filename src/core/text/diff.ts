// A unified diff, without a diff library.
//
// Two things need one. When a local model's attempt fails and the question is handed to a larger
// model, the single most useful thing to send is not the transcript but WHAT WAS CHANGED and what
// the change broke — a remote model reading a diff and an error starts where the local one stopped
// instead of starting over. And predicting the next edit means describing the last few, which is
// the same shape.
//
// The interesting constraint is memory. The textbook algorithm is a table of `before × after`
// cells: on two thousand-line files that is a million cells, on two twenty-thousand-line files it
// is four hundred million and the extension host dies. Real edits are local, so the fix is to stop
// pretending otherwise: strip the identical head and tail first — which on a one-line change leaves
// one line on each side — and fall back to "this block became that block" when what remains is
// still too large to compare properly. A coarse diff is a worse diff; a crashed editor is not a
// diff at all.

export type Op = "same" | "add" | "del";

export interface Change {
  op: Op;
  text: string;
}

/**
 * Above this many lines on either side, after the common head and tail are removed, the two halves
 * are reported as one replacement rather than compared line by line. It bounds the table at a few
 * million cells, which is milliseconds and a few megabytes.
 */
const MAX_LCS_LINES = 1500;

function splitLines(text: string): string[] {
  if (text === "") return [];
  const lines = text.split("\n");
  // A trailing newline is a property of the file, not a final empty line to diff against.
  if (lines[lines.length - 1] === "") lines.pop();
  return lines;
}

/**
 * The line-by-line difference between two texts.
 *
 * Deletions before insertions inside a changed region, because that is the order every reviewer
 * reads a diff in and the order every tool prints one.
 */
export function diffLines(before: string, after: string): Change[] {
  const a = splitLines(before);
  const b = splitLines(after);

  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head++;
  let tail = 0;
  while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++;

  const midA = a.slice(head, a.length - tail);
  const midB = b.slice(head, b.length - tail);

  const out: Change[] = [];
  for (let i = 0; i < head; i++) out.push({ op: "same", text: a[i]! });

  if (midA.length > MAX_LCS_LINES || midB.length > MAX_LCS_LINES) {
    for (const line of midA) out.push({ op: "del", text: line });
    for (const line of midB) out.push({ op: "add", text: line });
  } else {
    out.push(...lcsDiff(midA, midB));
  }

  for (let i = a.length - tail; i < a.length; i++) out.push({ op: "same", text: a[i]! });
  return out;
}

/** The classic longest-common-subsequence table, on a region small enough to afford one. */
function lcsDiff(a: string[], b: string[]): Change[] {
  const n = a.length;
  const m = b.length;
  if (n === 0) return b.map((text) => ({ op: "add" as const, text }));
  if (m === 0) return a.map((text) => ({ op: "del" as const, text }));

  // One row per line of `a`, so the walk-back below can read the whole table.
  const table: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    const row = table[i]!;
    const next = table[i + 1]!;
    for (let j = m - 1; j >= 0; j--) {
      row[j] = a[i] === b[j] ? next[j + 1]! + 1 : Math.max(next[j]!, row[j + 1]!);
    }
  }

  const out: Change[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ op: "same", text: a[i]! });
      i++;
      j++;
    } else if (table[i + 1]![j]! >= table[i]![j + 1]!) {
      out.push({ op: "del", text: a[i]! });
      i++;
    } else {
      out.push({ op: "add", text: b[j]! });
      j++;
    }
  }
  while (i < n) out.push({ op: "del", text: a[i++]! });
  while (j < m) out.push({ op: "add", text: b[j++]! });
  return out;
}

export interface UnifiedOptions {
  /** Unchanged lines kept around each change. Three is what every tool uses. */
  context?: number;
  /** Hard ceiling on the result, so one enormous edit cannot fill a prompt. */
  maxChars?: number;
}

/**
 * A unified diff, in the format every model has read a million of.
 *
 * The format is not a nicety: `@@` hunks with `+`/`-` lines are what the training data contains, and
 * a model handed an invented format spends its attention decoding the format instead of the change.
 */
export function unifiedDiff(path: string, before: string, after: string, opts: UnifiedOptions = {}): string {
  if (before === after) return "";
  const context = opts.context ?? 3;
  const changes = diffLines(before, after);

  // Where each hunk starts and ends, in terms of the change list.
  const interesting: number[] = [];
  changes.forEach((c, i) => {
    if (c.op !== "same") interesting.push(i);
  });
  if (!interesting.length) return "";

  const hunks: Array<{ from: number; to: number }> = [];
  for (const i of interesting) {
    const from = Math.max(0, i - context);
    const to = Math.min(changes.length - 1, i + context);
    const last = hunks[hunks.length - 1];
    // Touching hunks are one hunk: two changes four lines apart with three lines of context each
    // would otherwise print the same lines twice.
    if (last && from <= last.to + 1) last.to = Math.max(last.to, to);
    else hunks.push({ from, to });
  }

  const lines: string[] = [`--- a/${path}`, `+++ b/${path}`];
  let oldLine = 1;
  let newLine = 1;
  const startOf: Array<{ old: number; new: number }> = [];
  for (const c of changes) {
    startOf.push({ old: oldLine, new: newLine });
    if (c.op !== "add") oldLine++;
    if (c.op !== "del") newLine++;
  }

  for (const hunk of hunks) {
    const slice = changes.slice(hunk.from, hunk.to + 1);
    const oldCount = slice.filter((c) => c.op !== "add").length;
    const newCount = slice.filter((c) => c.op !== "del").length;
    const start = startOf[hunk.from]!;
    lines.push(`@@ -${start.old},${oldCount} +${start.new},${newCount} @@`);
    for (const c of slice) lines.push(`${c.op === "add" ? "+" : c.op === "del" ? "-" : " "}${c.text}`);
  }

  const text = lines.join("\n");
  const max = opts.maxChars;
  if (max && text.length > max) return `${text.slice(0, max)}\n…(diff truncated)`;
  return text;
}

/** How much a change actually changed, for deciding whether it is worth describing at all. */
export function changedLines(before: string, after: string): number {
  return diffLines(before, after).filter((c) => c.op !== "same").length;
}
