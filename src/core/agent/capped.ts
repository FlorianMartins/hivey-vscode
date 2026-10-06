// Saying when a result was cut short.
//
// ⚠️ The lesson this project already paid for once, applied everywhere it applies. `read_file`
// returned the head of a long file and said nothing, so a model working on a 6,500-line file could
// not reach what it needed and resorted to `sed` through `run_command` — slower, approval-gated, and
// where a real session started going wrong.
//
// `search_text` and `list_files` have exactly the same shape: a cap, silently applied. A search that
// returns sixty matches of two hundred and does not say so has told the model there are sixty. The
// model then reasons about a complete picture it does not have — and that is worse than an error,
// because nothing looks wrong.

export interface Capped {
  /** How many were returned. */
  shown: number;
  /** The cap that applied, when one did. */
  cap: number;
  /** True when there is reason to think more existed. */
  hitCap: boolean;
}

/**
 * What to append when a result was cut, and nothing when it was not.
 *
 * @param what the unit, in the plural: "matches", "files".
 * @param narrower what the model can do about it, in its own vocabulary.
 */
export function describeCap(result: Capped, what: string, narrower: string): string {
  if (!result.hitCap) return "";
  return `\n\n[stopped at ${result.cap} ${what}; there are probably more. ${narrower}]`;
}

/** Whether a collector that stops at `cap` actually stopped there. */
export function cappedAt(shown: number, cap: number): Capped {
  return { shown, cap, hitCap: shown >= cap };
}
