// The file the model most likely meant, when the one it named does not exist.
//
// ⚠️ A real session spent a dozen steps on `skincare-page.js` — a file that does not exist — when the
// project has `skinator-page.js`: the model had mixed up two words that look alike, and every error
// it got ("cannot open file", "no such file") told it the file was missing, never which one was there.
// Naming the near miss is what lets it see its own typo.

/** Edit distance between two names, case-insensitive. */
export function nameDistance(a: string, b: string): number {
  const x = a.toLowerCase();
  const y = b.toLowerCase();
  let prev = Array.from({ length: y.length + 1 }, (_, j) => j);
  for (let i = 1; i <= x.length; i++) {
    const cur = [i];
    for (let j = 1; j <= y.length; j++) {
      cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (x[i - 1] === y[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[y.length]!;
}

/**
 * The closest of `names` to `wanted`, if it is close enough to be a misspelling of it — at most
 * two edits, or two fifths of the name for longer names. Ties go to the first one listed.
 */
export function nearestName(wanted: string, names: readonly string[]): string | undefined {
  const budget = Math.max(2, Math.floor(wanted.length * 0.4));
  let best: { name: string; d: number } | undefined;
  for (const name of names) {
    if (name === wanted) continue;
    const d = nameDistance(wanted, name);
    if (d <= budget && (!best || d < best.d)) best = { name, d };
  }
  return best?.name;
}
