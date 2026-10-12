// Order the rows for display.

export interface Row {
  label: string;
  score: number;
}

/**
 * `sort` reorders in place and returns the same array, so a function that looked pure destroyed
 * the caller's order — and the symptom appeared in whatever read that array next, never here.
 * `readonly` is what makes the compiler say so rather than a comment asking nicely.
 */
export function ranked(rows: readonly Row[]): Row[] {
  return [...rows].sort((a, b) => b.score - a.score);
}
