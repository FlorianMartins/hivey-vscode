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
  /** When the figures were taken, and where from. Absent when nothing was. */
  at?: string;
  endpoint?: string;
  /** How many tasks the set holds, which is printed even when nothing ran. */
  taskCount: number;
  rows: Measured[];
}

/** The configurations the table lists whether or not anybody has measured them. */
export const CONFIGURATIONS: Array<{ configuration: string; detail: string }> = [
  { configuration: "local only", detail: "the model on your own machine, never escalated" },
  { configuration: "local + escalation", detail: "the same model, with a remote one bought only by a proven failure" },
  { configuration: "hivey/free", detail: "the free-tier preset" },
  { configuration: "hivey/balanced", detail: "the everyday preset" },
  { configuration: "hivey/pro", detail: "the preset that spends in order to be right" },
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
export function rowsFromOutcomes(outcomes: TaskOutcome[]): Measured[] {
  const groups = new Map<string, TaskOutcome[]>();
  for (const outcome of outcomes) {
    const escalated = outcome.runs.some((r) => Boolean(r.escalatedTo));
    const key = `${outcome.model}${escalated ? ESCALATED_SUFFIX : ""}`;
    const list = groups.get(key) ?? [];
    list.push(outcome);
    groups.set(key, list);
  }
  return [...groups.entries()].map(([configuration, list]) => ({ configuration, totals: totalsFor(list) }));
}

function quality(totals: Totals): string {
  if (totals.passRate === undefined) return "not measured";
  return `${Math.round(totals.passRate * 100)} %`;
}

function cost(totals: Totals): string {
  if (totals.usd === undefined) return totals.unpriced ? "not priced" : "—";
  const each = totals.tasks ? totals.usd / totals.tasks : 0;
  return `$${totals.usd.toFixed(4)} ($${each.toFixed(4)}/task)${totals.unpriced ? ` +${totals.unpriced} unpriced` : ""}`;
}

function row(configuration: string, totals: Totals): string {
  return `| \`${configuration}\` | ${totals.passed}/${totals.tasks} | ${quality(totals)} | ${totals.seconds.toFixed(0)} s | ${cost(totals)} |`;
}

const NOT_MEASURED = (configuration: string) => `| \`${configuration}\` | — | not measured | — | — |`;

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
      `Taken ${input.at ?? "(no date recorded)"}${input.endpoint ? ` against \`${input.endpoint}\`` : ""}.`,
      "",
      "| configuration | passed | quality | time | cost |",
      "| --- | --- | --- | --- | --- |",
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
