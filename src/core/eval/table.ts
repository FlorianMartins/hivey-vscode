// The comparison table, and the two things it must never contain.
//
// "Better than the alternatives" is a claim that needs a number behind it or it is marketing. This
// builds that number's table: each configuration somebody can actually choose — the local model
// alone, the local model with escalation, each preset — with the quality and the cost per task, in a
// file that lives in the repository so two runs can be diffed against each other.
//
// ⚠️ IT CARRIES NO COLUMN FOR COPILOT AND NONE FOR IBM BOB. Not because the comparison is unwelcome:
// because nobody here has run them on these tasks. A column filled in from somebody's published
// figure compares two different measurements, on different task sets, on different machines, on
// different days — and it would not survive the first question in the meeting where it is quoted.
// What it would take to add one honestly is printed instead, which is more useful than a number that
// cannot be defended.
//
// ⚠️ AND IT NEVER AVERAGES TWO CONFIGURATIONS INTO ONE ROW. The harness is given a model, not a
// configuration, and the same model run twice — once alone, once allowed to escalate — produces
// outcomes that look identical apart from one field. Summing them yields a quality nobody can
// reproduce, because it is the quality of neither setup. `rowsFromOutcomes` splits on that field,
// which is the only reason it exists rather than a one-line `groupBy`.
//
// The rest is the discipline `report.ts` already follows: a configuration nobody ran reads
// `not measured`, never `0 %`. Those are not the same and only one of them is a result.

import { totalsFor, type TaskOutcome, type Totals } from "./report.js";

export interface Measured {
  /** What somebody would choose: `local only`, `local + escalation`, `hivey/balanced`… */
  configuration: string;
  /** How it was reached, for the reader who wants to reproduce it. */
  detail?: string;
  totals: Totals;
}

export interface TableInput {
  /** Every distinct run timestamp behind these rows, when they come from more than one run. */
  span?: string[];
  /** When the figures were taken, and where from. Absent when nothing was. */
  at?: string;
  endpoint?: string;
  /** The models behind the figures, named so a reader can reproduce them. */
  models?: string[];
  /**
   * What is known to be wrong with these figures.
   *
   * ⚠️ The table could not say this, and it needed to. Three of the task prompts were corrupted for
   * months by shell interpolation — `` `any` `` reached the model as nothing at all — so every score
   * published from that set has a known defect, and the only ways to express it were to erase the
   * numbers (hiding a real measurement) or to leave them bare (presenting a known-flawed figure as
   * clean). Neither is honest. A caveat printed above the table is.
   */
  caveats?: string[];
  /** How many tasks the set holds, which is printed even when nothing ran. */
  taskCount: number;
  rows: Measured[];
}

/** The configurations the table lists whether or not anybody has measured them. */
export const CONFIGURATIONS: Array<{ configuration: string; detail: string }> = [
  { configuration: "local only", detail: "the model on your own machine, never escalated" },
  { configuration: "local + escalation", detail: "the same model, with a remote one bought only by a proven failure" },
  { configuration: "remote only", detail: "one named remote model, every turn, no local step" },
  // ⚠️ The ids as the product actually spells them. This list said `hivey/balanced` and `hivey/pro`,
  // which exist nowhere in it — the presets are `hivey/free`, `hivey` and `hivey/smart`. A table
  // naming configurations nobody can choose cannot be reproduced, and worse: the fix was announced
  // in the CHANGELOG three releases before it happened, because the edit that was supposed to make
  // it was a string replacement that silently matched nothing and was never checked.
  { configuration: "hivey/free", detail: "Hivey Free — free endpoints only" },
  { configuration: "hivey", detail: "Hivey Smart — a strong model where you feel it, a cheap one for the plumbing" },
  { configuration: "hivey/smart", detail: "Hivey Pro — the best of the catalogue on the hard work" },
];

/** The suffix that distinguishes an escalated run from the bare model. One place, so both agree. */
export const ESCALATED_SUFFIX = " + escalation";

/**
 * Group measured outcomes into rows, keeping escalated runs apart from bare ones.
 *
 * The split is the point. An outcome whose runs include an escalation was produced by a different
 * configuration than one that stayed local, whatever `--model` said, and a table that adds them
 * together reports a figure that belongs to neither.
 */
export function rowsFromOutcomes(outcomes: TaskOutcome[], label?: string): Measured[] {
  const groups = new Map<string, TaskOutcome[]>();
  for (const outcome of outcomes) {
    const escalated = outcome.runs.some((r) => Boolean(r.escalatedTo));
    // The harness is given a model; a configuration is what somebody CHOSE, and only the person
    // running it knows which one this was. So the label is passed in, and it falls back to the model
    // name — which is honest, if less useful, and never pretends a bare model run was a preset.
    const key = `${label ?? outcome.model}${escalated ? ESCALATED_SUFFIX : ""}`;
    const list = groups.get(key) ?? [];
    list.push(outcome);
    groups.set(key, list);
  }
  return [...groups.entries()].map(([configuration, list]) => ({ configuration, totals: totalsFor(list) }));
}

/**
 * How many timed-out tasks a set may hold and still state a rate.
 *
 * ⚠️ A judgement, and it is derived rather than picked. ADR-0034 measured this bench's own noise at
 * three tasks — 48, 47 and 50 on three identical series — and set the rule that a difference under
 * three tasks is not a result. Timeouts are the same kind of quantity: each one is a task whose
 * outcome is unknown, so a set holding more of them than the noise floor can no longer be told apart
 * from the series it would be compared with. Below the floor they are left as failures, because a
 * task the agent genuinely cannot finish IS a failure and the published runs carried two and three.
 *
 * Expressed as an absolute count rather than a share, because that is how the noise was measured.
 */
export const TIMEOUT_NOISE_TASKS = 3;

function quality(totals: Totals): string {
  // A refused task says nothing about the model, so a set containing any cannot state a rate. It
  // says how many were refused instead — which tells the reader what to fix to get a number.
  if (totals.refused) return `${totals.refused} refused — no rate`;
  // ⚠️⚠️ And neither does a task the clock killed. Found on 2026-10-06: a `hivey/free` series came
  // back with 55 % of its tasks killed at 180 s because the free endpoint had become much slower,
  // and every one of them counted as a model failure. The same preset had scored 32/62 two days
  // before. A number produced that way measures the provider's throughput and publishes it as the
  // model's quality — which is worse than publishing nothing, because it looks like a measurement.
  if (totals.timedOut > TIMEOUT_NOISE_TASKS) return `${totals.timedOut} timed out — no rate`;
  if (totals.passRate === undefined) return "not measured";
  return `${Math.round(totals.passRate * 100)} %`;
}

function cost(totals: Totals): string {
  if (totals.usd === undefined) return totals.unpriced ? "not priced" : "—";
  const each = totals.tasks ? totals.usd / totals.tasks : 0;
  return `$${totals.usd.toFixed(4)} ($${each.toFixed(4)}/task)${totals.unpriced ? ` +${totals.unpriced} unpriced` : ""}`;
}

function row(configuration: string, totals: Totals): string {
  // "never acted" sits next to the score because it is what makes the score readable: a model that
  // failed because it never attempted an edit is a different thing from one that attempted and was
  // wrong, and only one of those is improved by a better model.
  const idle = totals.tasks ? `${totals.neverActed}/${totals.tasks}` : "—";
  // "Claimed done" is the honesty gap: finished cleanly, and the check failed anyway. A model that
  // fails loudly costs a turn; one that fails while reporting success costs the trust that makes
  // the tool usable.
  const claimed = totals.tasks ? `${totals.claimedDone}/${totals.tasks}` : "—";
  return `| \`${configuration}\` | ${totals.passed}/${totals.tasks} | ${quality(totals)} | ${idle} | ${claimed} | ${totals.seconds.toFixed(0)} s | ${cost(totals)} |`;
}

const NOT_MEASURED = (configuration: string) => `| \`${configuration}\` | — | not measured | — | — | — | — |`;

/**
 * What the same configuration scored on separate runs.
 *
 * ⚠️ This exists because of a number that was nearly published as a finding. Three runs of ONE
 * configuration, on the same tasks and the same build, scored 48, 47 and 50 — a spread of three
 * tasks with nothing changed between them. A single run is therefore not evidence of a gap smaller
 * than that, and a table that printed one run per row invited exactly that mistake: the reader sees
 * 79 % against 84 % and concludes something the data cannot support.
 *
 * Reported rather than averaged. An average of three runs hides the spread, and the spread is the
 * thing a reader needs in order to know what the percentage is worth.
 */
function spread(rows: Measured[]): string[] {
  const byName = new Map<string, Measured[]>();
  for (const r of rows) byName.set(r.configuration, [...(byName.get(r.configuration) ?? []), r]);
  const repeated = [...byName.entries()].filter(([, list]) => list.length > 1);
  if (!repeated.length) return [];
  const lines = repeated.map(([name, list]) => {
    const scores = list.map((r) => `${r.totals.passed}/${r.totals.tasks}`).join(", ");
    const passes = list.map((r) => r.totals.passed);
    const width = Math.max(...passes) - Math.min(...passes);
    return `- \`${name}\`: ${scores} — a spread of ${width} task(s) with nothing changed between runs.`;
  });
  return [
    "### What the same configuration scored twice",
    "",
    "Run to run, on the same tasks and the same build:",
    "",
    ...lines,
    "",
    "**So a difference smaller than that spread is not a result.** A single run of a configuration",
    "cannot establish a gap of a few tasks, and a table showing one run per row invites exactly that",
    "mistake — the reader sees two percentages and concludes something the data does not support.",
    "Reported rather than averaged: an average hides the spread, and the spread is what tells you what",
    "the percentage is worth.",
    "",
  ];
}

/**
 * When these figures were taken, over however many runs they came from.
 *
 * A table whose rows are separate runs has no single date. Naming one is wrong in the direction that
 * matters: a reader quoting the table would attribute every row to a day three of them were not
 * measured on.
 *
 * @param at the run timestamp the caller considers current.
 * @param span every distinct timestamp the rows came from.
 */
export function describeWhen(at?: string, span?: string[]): string {
  const dates = [...new Set((span ?? []).filter(Boolean))].sort();
  if (dates.length > 1) {
    return `Measured over ${dates.length} runs between ${dates[0]} and ${dates[dates.length - 1]}`;
  }
  return `Taken ${at ?? dates[0] ?? "(no date recorded)"}`;
}

/** The table, as the file that gets committed. */
export function qualityTable(input: TableInput): string {
  const measured = new Map(input.rows.map((r) => [r.configuration, r]));
  const lines: string[] = [
    "# Measured quality",
    "",
    "What each configuration scores on this repository's own evaluation set",
    `(${input.taskCount} tasks). Regenerate with \`node scripts/evaluate.mjs --table eval/QUALITY.md\`.`,
    "",
  ];

  if (input.caveats?.length) {
    lines.push("> **Read these figures with the following in mind.**", ">");
    for (const caveat of input.caveats) lines.push(`> - ${caveat}`);
    lines.push("");
  }

  if (!input.rows.length) {
    lines.push(
      "## Nothing here has been measured",
      "",
      "**No figure below has been taken.** No model was reachable from the machine this was last",
      "generated on, so every cell would have been invented — and a table of invented numbers is the",
      "one artefact of this project that would be worth less than nothing, because it is the one",
      "somebody quotes.",
      "",
      "What does exist is the thing that makes a score mean anything: every task's check is proven to",
      "**fail on its untouched fixture** and to **pass on its reference solution**, on every commit.",
      "A task set that is honest in both directions is the hard half. What is missing is a machine",
      "with a model on it.",
      "",
      "```bash",
      "npm run build",
      "node scripts/evaluate.mjs \\",
      "  --url http://127.0.0.1:11434/v1 --model qwen2.5-coder:7b \\",
      "  --table eval/QUALITY.md",
      "```",
      "",
      "## The configurations it will compare",
      "",
      "| configuration | how |",
      "| --- | --- |",
      ...CONFIGURATIONS.map((c) => `| \`${c.configuration}\` | ${c.detail} |`),
      "",
    );
  } else {
    lines.push(
      // ⚠️ `at` is ONE date and the rows can come from several runs, days apart — each row is its
      // own measurement, and the harness let the last file read win. "Taken 3 October" above a row
      // measured on the 4th is the quietest kind of false statement: nobody checks a header. When
      // the runs disagree, the header says the range instead of picking one.
      `${describeWhen(input.at, input.span)}${input.endpoint ? ` against \`${input.endpoint}\`` : ""}` +
        `${input.models?.length ? ` with \`${input.models.join("`, `")}\`` : ""}.`,
      "",
      "| configuration | passed | quality | never acted | claimed done | model time | cost |",
      "| --- | --- | --- | --- | --- | --- | --- |",
      ...CONFIGURATIONS.map((spec) => {
        const found = measured.get(spec.configuration);
        return found ? row(spec.configuration, found.totals) : NOT_MEASURED(spec.configuration);
      }),
      // A configuration somebody measured that is not one of the five still belongs in the table:
      // the usual case is a model name, which is what `--model` actually gives the harness.
      ...input.rows
        .filter((r) => !CONFIGURATIONS.some((c) => c.configuration === r.configuration))
        .map((r) => row(r.configuration, r.totals)),
      "",
      ...spread(input.rows),
      "### How to read it",
      "",
      "**never acted** is how many of those tasks the model finished without taking a single tool",
      "step. It is here because a score on its own does not say whether a model was wrong or whether",
      "it never tried, and those are different problems: one is answered by a better model, the other",
      "by the client and the prompt. A configuration with a low score and a high *never acted* has not",
      "been measured on its reasoning at all.",
      "",
      "**claimed done** is how many of those failures the agent reported as a success — it exited",
      "cleanly and the check failed anyway. It is the number that decides whether a tool can be left",
      "alone: a model that fails loudly costs you a turn, one that fails while claiming success costs",
      "the trust that makes it usable.",
      "",
      "**model time** is the sum of the task durations, **not** how long the run took. The harness runs",
      "several tasks at once, so the wall clock is a fraction of this — about a sixth at the default",
      "concurrency. The column was called *time* and read as a duration, which is why it now says what",
      "it is: a figure whose name invites the wrong reading is a figure that will be misread.",
      "",
      "**not priced** is not free. A local endpoint bills nothing and costs electricity and time; the",
      "time is in the table and the price is absent rather than written as $0.00.",
      "",
      "To reproduce it, or to measure a configuration that reads *not measured*:",
      "",
      "```bash",
      "npm run build",
      "node scripts/evaluate.mjs \\",
      `  --url ${input.endpoint ?? "http://127.0.0.1:11434/v1"} --model ${input.models?.[0] ?? "qwen2.5-coder:7b"} \\`,
      '  --as "local only" --table eval/QUALITY.md',
      "```",
      "",
      "`--as` names the configuration, because the harness is given a model and only the person",
      "running it knows which setup that model was standing in for. `--from <results.json>` rebuilds",
      "this document from a run that already happened, which matters when a run takes half an hour.",
      "",
    );
  }

  lines.push(
    "## What this table deliberately leaves out",
    "",
    "**No column for GitHub Copilot and none for IBM Bob.** Not because the comparison is unwelcome —",
    "it is the comparison this product exists to win — but because nobody here has run them on these",
    "tasks. A column filled in from a published figure compares two different measurements, on",
    "different task sets, on different machines, on different days.",
    "",
    "What it would take to add one honestly: the same tasks, through that product, on this machine, on",
    "the same day, with the same checks deciding pass and fail. That is a day's work and it is worth",
    "doing. Until somebody does it, the column is absent rather than estimated.",
    "",
    "**And no figure that was not measured.** A configuration nobody ran reads `not measured`, never",
    "`0 %`.",
    "",
  );
  return lines.join("\n");
}
