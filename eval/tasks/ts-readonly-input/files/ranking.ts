// Order the rows for display.

export interface Row {
  label: string;
  score: number;
}

export function ranked(rows: Row[]): Row[] {
  rows.sort((a, b) => b.score - a.score);
  return rows;
}
