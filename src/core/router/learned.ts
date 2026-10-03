// Choosing a model from what has actually happened in THIS repository.
//
// The router's own escalation already decides on evidence rather than on a guess
// ([ADR-0009](../../../docs/adr/0009-escalader-sur-un-echec-constate.md)): the local model tries, the
// tests decide, and only a proven failure buys a paid call. What it cannot do is remember. Every
// conversation starts from the same assumption, so a repository where the 7B model succeeds nine
// times out of ten pays for the same first attempt as one where it has never once worked.
//
// This remembers. Per repository, per kind of task, per model: how many times it was tried and how
// many times `verifyTurn` came back green. The router then picks the CHEAPEST model whose observed
// rate clears a threshold — which is the whole point, because the expensive model is always the safe
// choice and always the wrong default.
//
// Three properties make this defensible rather than clever, and each has a test:
//
//   NEVER OUTSIDE WHAT THE USER ALLOWED. The candidates are passed in, already filtered by the
//   user's own settings and the organisation's policy. Nothing here can produce a model that is not
//   on that list, however good its record.
//   NEVER TRUSTED TOO EARLY. One success is not a rate. Below a minimum number of attempts a model
//   has no record, and "no record" is not "bad" — it falls back to the configured order.
//   ALWAYS EXPLAINED WITH THE REAL NUMBERS. "Chosen: 9 of 10 in this repository" is a sentence
//   somebody can disagree with. "Chosen by the learned router" is one they can only distrust.

/** One model's record for one kind of task in one repository. */
export interface Record_ {
  repo: string;
  kind: string;
  model: string;
  attempts: number;
  successes: number;
  /** When it was last tried, so a stale record can be aged out by the caller. */
  lastAt: number;
}

export type Stats = Record_[];

/** The kinds a turn is classified into. Deliberately few: a finer split never reaches a sample size. */
export type TaskKind = "edit" | "ask" | "ibmi" | "test";

export interface Candidate {
  model: string;
  provider: string;
  /** Dollars per million input tokens, from the generated catalogue. 0 for a local model. */
  price: number;
}

export interface Choice {
  model: string;
  provider: string;
  /** The sentence the panel shows. Carries the counts, never a verdict without them. */
  why: string;
  /** True when this was an exploration rather than the best-known choice. */
  exploring: boolean;
}

export interface Policy {
  /** The observed rate a model must clear to be chosen over a more expensive one. */
  threshold: number;
  /** Attempts below which a model has no record at all. */
  minAttempts: number;
  /** The share of turns that deliberately try something other than the best-known choice. */
  explore: number;
}

export const DEFAULT_POLICY: Policy = {
  // High, because the cost of being wrong is a wasted turn AND a paid escalation — so the cheap
  // model has to be reliably right, not merely often right.
  threshold: 0.8,
  // Five, which is enough for 4/5 to mean something and few enough to be reached in a morning.
  minAttempts: 5,
  // One turn in ten. Enough to notice that a model got better after an upgrade; small enough that
  // somebody who never looks at this does not pay for it.
  explore: 0.1,
};

export function find(stats: Stats, key: { repo: string; kind: string; model: string }): Record_ | undefined {
  return stats.find((r) => r.repo === key.repo && r.kind === key.kind && r.model === key.model);
}

/** The observed rate, or nothing when there is not enough to have one. */
export function rate(record: Record_ | undefined, minAttempts: number): number | undefined {
  if (!record || record.attempts < minAttempts) return undefined;
  return record.successes / record.attempts;
}

/**
 * One more observation.
 *
 * Returns a new array rather than mutating: the caller persists it, and a mutation that happened
 * before a failed write is a count nobody can reconcile.
 */
export function observe(
  stats: Stats,
  key: { repo: string; kind: string; model: string },
  ok: boolean,
  now = Date.now(),
): Stats {
  const existing = find(stats, key);
  if (!existing) return [...stats, { ...key, attempts: 1, successes: ok ? 1 : 0, lastAt: now }];
  return stats.map((r) =>
    r === existing
      ? { ...r, attempts: r.attempts + 1, successes: r.successes + (ok ? 1 : 0), lastAt: now }
      : r,
  );
}

/**
 * The model to try first.
 *
 * `candidates` is the user's own authorised set, cheapest first is NOT assumed — it is sorted here,
 * because the caller's order is the configuration's order and the question being answered is about
 * price.
 *
 * `random` is injected so the exploration is testable. A feature whose behaviour depends on an
 * untestable coin flip is a feature nobody can reason about when it surprises them.
 */
export function choose(
  stats: Stats,
  input: { repo: string; kind: string; candidates: Candidate[]; policy?: Policy; random?: () => number },
): Choice | undefined {
  const candidates = [...input.candidates].sort((a, b) => a.price - b.price || a.model.localeCompare(b.model));
  if (!candidates.length) return undefined;
  const policy = input.policy ?? DEFAULT_POLICY;
  const random = input.random ?? Math.random;

  const withRates = candidates.map((candidate) => {
    const record = find(stats, { repo: input.repo, kind: input.kind, model: candidate.model });
    return { candidate, record, rate: rate(record, policy.minAttempts) };
  });

  // Exploration first, and only among models that have no record yet: spending a turn re-measuring a
  // model with forty attempts behind it buys nothing, while a model nobody has tried is the only
  // thing a measurement can be about.
  const unmeasured = withRates.filter((x) => x.rate === undefined);
  if (unmeasured.length && random() < policy.explore) {
    const pick = unmeasured[0]!;
    return {
      model: pick.candidate.model,
      provider: pick.candidate.provider,
      why: pick.record
        ? `trying ${pick.candidate.model} again: ${pick.record.successes} of ${pick.record.attempts} here so far, which is not enough to judge`
        : `trying ${pick.candidate.model}: nothing is known about it in this repository yet`,
      exploring: true,
    };
  }

  // Then the cheapest model whose observed rate clears the threshold.
  const good = withRates.find((x) => x.rate !== undefined && x.rate >= policy.threshold);
  if (good) {
    return {
      model: good.candidate.model,
      provider: good.candidate.provider,
      why: `${good.record!.successes} of ${good.record!.attempts} in this repository`,
      exploring: false,
    };
  }

  // Nothing has a good enough record. The configured order wins, and the reason says so — including
  // when a cheap model has been TRIED and found wanting, which is the sentence somebody needs.
  const first = input.candidates[0]!;
  const measured = withRates.filter((x) => x.rate !== undefined);
  const worst = measured
    .filter((x) => x.candidate.model !== first.model)
    .map((x) => `${x.candidate.model} ${x.record!.successes}/${x.record!.attempts}`);
  return {
    model: first.model,
    provider: first.provider,
    why: worst.length
      ? `your configured model: ${worst.join(", ")} here, under the ${Math.round((input.policy ?? DEFAULT_POLICY).threshold * 100)} % needed`
      : "your configured model: nothing cheaper has a record here yet",
    exploring: false,
  };
}

/**
 * How a turn is classified.
 *
 * From what the turn DID rather than from what was asked, because what was asked is a sentence and
 * what it did is a fact. A turn that edited files is an `edit` whatever its phrasing.
 */
export function classify(tools: string[]): TaskKind {
  if (tools.some((t) => t.startsWith("ibmi_"))) return "ibmi";
  if (tools.some((t) => t === "write_file" || t === "edit_file")) return "edit";
  if (tools.some((t) => t === "run_command" || t === "ibmi_test")) return "test";
  return "ask";
}

/** Every record for one repository, for the "forget what you learned here" command. */
export function forget(stats: Stats, repo: string): Stats {
  return stats.filter((r) => r.repo !== repo);
}

/** What the user is shown when they ask what has been learned. */
export function describe(stats: Stats, repo: string, minAttempts: number): string {
  const mine = stats.filter((r) => r.repo === repo).sort((a, b) => b.attempts - a.attempts);
  if (!mine.length) return "Nothing has been measured in this repository yet.";
  return mine
    .map((r) => {
      const observed = rate(r, minAttempts);
      return `${r.kind} · ${r.model}: ${r.successes}/${r.attempts}${observed === undefined ? " (not enough to judge)" : ` (${Math.round(observed * 100)} %)`}`;
    })
    .join("\n");
}
