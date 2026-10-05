// Reading part of a file, and saying what was left out.
//
// ⚠️ From a real session on a 6,500-line file, in the model's own words:
//
//     « read_file coupe le fichier avant la zone utile. Je lis les deux passages par une commande. »
//     « Le fichier est coupé avant la zone qui m'intéresse. »
//     « La sortie a été tronquée au milieu. »
//
// `read_file` took a path and nothing else, returned the head of the file, and said "truncated if
// very large" in its description. So on any file big enough to matter the model could not reach the
// part it needed, and did the only thing left: shell out to `sed` and `grep`, which is slower, costs
// approvals, and is where that session started going wrong.
//
// Two things fix it, and the second is as important as the first: a RANGE, so there is a way to ask
// for the rest — and a truncation notice that says the file's real length and the exact call that
// would fetch the next part. A tool that truncates without saying how to continue has told the model
// the file ends there.

export interface Slice {
  text: string;
  /** 1-based, inclusive. What was actually returned. */
  from: number;
  to: number;
  /** Lines in the whole file. */
  total: number;
  /** True when the range asked for was cut to fit the budget. */
  truncated: boolean;
}

/**
 * Take lines `from`..`to` of a text, within a budget.
 *
 * @param from 1-based and inclusive; anything below 1 means the beginning.
 * @param to 1-based and inclusive; absent means the end of the file.
 * @param maxChars the budget. The range is cut at a LINE boundary, never mid-line: half a line of
 *   source is worse than one line fewer, because it reads as a syntax error that is not there.
 */
export function sliceLines(text: string, from?: number, to?: number, maxChars = 24_000): Slice {
  const lines = text.split("\n");
  const total = lines.length;
  const start = Math.max(1, Math.min(from ?? 1, total));
  const end = Math.max(start, Math.min(to ?? total, total));
  const wanted = lines.slice(start - 1, end);

  let used = 0;
  const kept: string[] = [];
  for (const line of wanted) {
    // +1 for the newline that will join them.
    if (used + line.length + 1 > maxChars && kept.length) break;
    kept.push(line);
    used += line.length + 1;
  }
  return {
    text: kept.join("\n"),
    from: start,
    to: start + kept.length - 1,
    total,
    truncated: kept.length < wanted.length,
  };
}

/**
 * What to tell the model about what it did not get.
 *
 * Returns nothing when the whole file came back, because a note on every read is noise that teaches
 * the model to skip the notes that matter.
 */
export function describeSlice(slice: Slice, path: string): string {
  const whole = slice.from === 1 && slice.to === slice.total;
  if (whole && !slice.truncated) return "";
  const next = slice.to < slice.total ? ` Read on with read_file({ path: "${path}", from: ${slice.to + 1} }).` : "";
  return `\n\n[lines ${slice.from}-${slice.to} of ${slice.total}.${next}]`;
}
