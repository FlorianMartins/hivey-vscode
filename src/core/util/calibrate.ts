// Learning what a token is, from the provider that counts them.
//
// `estimateTokens` guesses from character classes, because shipping a real BPE tokenizer means a
// multi-megabyte vocabulary per model family and a runtime dependency this project does not have.
// The guess is deliberately pessimistic, and pessimism has a price: the budget refuses a request
// that would have been affordable, and the context manager compacts a conversation that still fits.
//
// But every answer comes back carrying `usage.prompt_tokens` — the provider's own count of the text
// we just estimated. Pairing the two is a free measurement, and a handful of them is enough: after
// ten requests the factor for a given model is within a few per cent, which is far better than any
// heuristic over character classes can be, because it learns THAT model's tokenizer rather than an
// average of all of them.
//
// Three properties make this safe to trust:
//   • per model, because a factor learned from an English-heavy Claude conversation does not
//     describe a Qwen model reading RPG fixed-format source;
//   • bounded, so one absurd sample — a provider that reports usage for a cached prefix, a request
//     that failed halfway — cannot move the estimate somewhere useless;
//   • it decays towards new evidence rather than averaging for ever, so a user who switches from
//     prose to a monorepo of minified JavaScript is followed rather than outvoted by their history.

export interface Sample {
  /** What `estimateTokens` said about the exact messages that were sent. */
  estimated: number;
  /** What the provider counted for them. */
  actual: number;
}

export interface ModelCalibration {
  /** Multiply an estimate by this to get the provider's number. */
  factor: number;
  samples: number;
}

export type Calibration = Record<string, ModelCalibration>;

/**
 * How far the factor is allowed to travel.
 *
 * An estimate that is out by more than this is not a tokenizer difference, it is a bug or a
 * provider reporting something other than what we sent — a cached prefix billed as zero, a system
 * prompt the gateway injected. Clamping means the worst case is the uncalibrated behaviour we
 * already had, rather than a budget that refuses everything or lets everything through.
 */
export const MIN_FACTOR = 0.4;
export const MAX_FACTOR = 2.5;

/** Below this, a sample is noise: the per-message framing dominates and the ratio means nothing. */
const MIN_TOKENS = 200;

/**
 * How fast the factor follows new evidence.
 *
 * A plain average would need dozens of samples to move after a user changes what they work on. An
 * exponential average with this weight is within a few per cent after about ten requests and still
 * tracks a change afterwards.
 */
const WEIGHT = 0.25;

export function factorFor(table: Calibration, model: string): number {
  return table[model]?.factor ?? 1;
}

/** The estimate, corrected by what this model's provider has actually been counting. */
export function calibrate(table: Calibration, model: string, estimated: number): number {
  return Math.ceil(estimated * factorFor(table, model));
}

/**
 * Fold one measurement in, and return the new table.
 *
 * Returns the table unchanged — the same object — when the sample says nothing, so a caller can
 * cheaply tell whether anything is worth persisting.
 */
export function observe(table: Calibration, model: string, sample: Sample): Calibration {
  if (!model) return table;
  if (!Number.isFinite(sample.estimated) || !Number.isFinite(sample.actual)) return table;
  if (sample.estimated < MIN_TOKENS || sample.actual < MIN_TOKENS) return table;

  const ratio = sample.actual / sample.estimated;
  // A ratio outside the plausible band is not evidence about tokenization. Discarded rather than
  // clamped: clamping would let a stream of nonsense drag the factor to the edge and hold it there.
  if (ratio < MIN_FACTOR || ratio > MAX_FACTOR) return table;

  const current = table[model];
  const factor = current ? current.factor * (1 - WEIGHT) + ratio * WEIGHT : ratio;
  return {
    ...table,
    [model]: {
      factor: Math.min(MAX_FACTOR, Math.max(MIN_FACTOR, factor)),
      samples: (current?.samples ?? 0) + 1,
    },
  };
}

/** What the panel says about it: an honest label, or nothing when nothing has been learned yet. */
export function describeCalibration(table: Calibration, model: string): string | undefined {
  const entry = table[model];
  if (!entry || entry.samples < 3) return undefined;
  const percent = Math.round((entry.factor - 1) * 100);
  if (Math.abs(percent) < 3) return `token estimate calibrated on ${entry.samples} requests (accurate)`;
  return `token estimate calibrated on ${entry.samples} requests (${percent > 0 ? "+" : ""}${percent}%)`;
}

/** Drop models nobody uses any more, so the stored table cannot grow without bound. */
export function prune(table: Calibration, keep = 40): Calibration {
  const entries = Object.entries(table);
  if (entries.length <= keep) return table;
  const best = entries.sort((a, b) => b[1].samples - a[1].samples).slice(0, keep);
  return Object.fromEntries(best);
}
