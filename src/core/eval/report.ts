// What an evaluation run actually measured, and what it is not allowed to claim.
//
// The bench could already say pass or fail. That is the least interesting half of the question: a
// model that solves nine tasks out of ten in forty seconds each and a model that solves nine in
// nine minutes, twelve steps and three dollars are not the same product, and the second one is not
// shippable to somebody paying per token. So a run carries duration, tokens, cost, step count and
// whether anything was escalated.
//
// The rule that shapes this file is the one the roadmap states and that an evaluation harness
// breaks by default: **invent no score**. Every number here comes from a run that happened, and
// anything that did not happen is absent rather than zero. The difference matters because zero
// reads as a measurement — "this model cost nothing" — when the truth is "nobody asked it". So:
//
//   • a cost is reported only when the price of that model is known; otherwise it is unknown, and
//     the total says how many runs it could not account for;
//   • a bench run with no model reachable produces a report that says so, with no totals at all,
//     instead of a tidy table of zeros;
//   • a figure averaged over nothing is omitted, never rendered as 0.
//
// It lives in `core` because it is arithmetic and wording, which is exactly what can be checked
// without a model, a GPU or a network — and the harness that uses it is a script that cannot be
// unit-tested at all.

/** What one turn of the agent did. Produced by the terminal client, one line of JSON per turn. */
export interface RunRecord {
  model: string;
  /** Tool-calling rounds. A task solved in one step was understood; eleven is a model groping. */
  steps: number;
  promptTokens: number;
  completionTokens: number;
  /** Absent when this model's price is not in the catalogue — never 0 to mean "free". */
  usd?: number;
  stoppedBecause: "answer" | "max-steps" | "cancelled";
  /** The model ran out of output budget mid-sentence. */
  truncated: boolean;
  /** How many times each tool was called, by name. */
  tools: Record<string, number>;
  ms: number;
  /**
   * The model this turn was handed to after a failure, when that happened.
   *
   * Absent on the terminal client, which has no escalation path — the editor is where a proven
   * failure buys a bigger model. The field exists so a report of an editor run has somewhere to put
   * it, and `escalations` below counts only what was actually reported.
   */
  escalatedTo?: string;
}

/** One task, one model, from a clean copy to a verdict. */
export interface TaskOutcome {
  task: string;
  kind: string;
  model: string;
  passed: boolean;
  seconds: number;
  /** The agent's own exit code. Non-zero with `passed` true means it complained and worked anyway. */
  agentExit: number;
  /** One per turn the agent took. Empty when the client reported nothing. */
  runs: RunRecord[];
  /** The tail of the check's output, on failure only. */
  why?: string;
}

export interface Totals {
  tasks: number;
  passed: number;
  /** Absent when nothing was measured — never 0, which would read as "it failed everything". */
  passRate?: number;
  seconds: number;
  steps?: number;
  promptTokens?: number;
  completionTokens?: number;
  /** The sum over the runs whose price was known. */
  usd?: number;
  /** How many runs could not be priced. A total with this above zero is a floor, not a figure. */
  unpriced: number;
  /** Runs that ran out of steps, and runs cut off mid-sentence. Both are quality signals. */
  outOfSteps: number;
  truncated: number;
  escalations: number;
  /**
   * Tasks where the model took no tool step at all.
   *
   * The most informative number this harness produces, and it was not here until a real run needed
   * it. A score of 0 % says a model is not good enough; this says WHY — `qwen2.5-coder:7b` on Ollama
   * mostly does not act. It writes the change as a code block and asks whether it should proceed, so
   * the task is failed without an edit ever being attempted. A reader deciding whether a local model
   * can do agentic work needs that distinction far more than they need the percentage.
   *
   * A plain count, and 0 is meaningful: it means the model acted every time.
   */
  neverActed: number;
}

/** Nothing measured, stated as such. The one shape that must never be confused with a bad score. */
export function emptyTotals(tasks = 0): Totals {
  return { tasks, passed: 0, seconds: 0, unpriced: 0, outOfSteps: 0, truncated: 0, escalations: 0, neverActed: 0 };
}

/**
 * Add up what happened, leaving out what did not.
 *
 * A field is present only when at least one run reported it. That is the whole discipline of this
 * function: `steps: 0` would be a claim, and `steps` absent is the truth when no run was recorded.
 */
export function totalsFor(outcomes: TaskOutcome[]): Totals {
  const out = emptyTotals(outcomes.length);
  if (!outcomes.length) return out;
  out.passed = outcomes.filter((o) => o.passed).length;
  out.passRate = out.passed / outcomes.length;
  out.seconds = round1(outcomes.reduce((n, o) => n + o.seconds, 0));

  // Counted over TASKS, not runs, and before the early return: a task whose client reported nothing
  // took no step either, and "the model never acted" is exactly as true then.
  out.neverActed = outcomes.filter((o) => o.runs.reduce((n, r) => n + r.steps, 0) === 0).length;

  const runs = outcomes.flatMap((o) => o.runs);
  if (!runs.length) return out;
  out.steps = runs.reduce((n, r) => n + r.steps, 0);
  out.promptTokens = runs.reduce((n, r) => n + r.promptTokens, 0);
  out.completionTokens = runs.reduce((n, r) => n + r.completionTokens, 0);
  const priced = runs.filter((r) => typeof r.usd === "number");
  out.unpriced = runs.length - priced.length;
  // Only when something was priced. A sum of nothing is not $0.00, it is nothing.
  if (priced.length) out.usd = round4(priced.reduce((n, r) => n + (r.usd ?? 0), 0));
  out.outOfSteps = runs.filter((r) => r.stoppedBecause === "max-steps").length;
  out.truncated = runs.filter((r) => r.truncated).length;
  out.escalations = runs.filter((r) => r.escalatedTo).length;
  return out;
}

export interface Report {
  at: string;
  /** The address the models were reached at, or empty when none was given. */
  endpoint: string;
  models: string[];
  outcomes: TaskOutcome[];
  /** Per model, then per kind within that model. */
  byModel: Array<{ model: string; totals: Totals; byKind: Array<{ kind: string; totals: Totals }> }>;
  /** True when no model was reachable and the bench only checked itself. */
  measured: boolean;
}

export function buildReport(input: {
  at: string;
  endpoint: string;
  models: string[];
  outcomes: TaskOutcome[];
}): Report {
  const byModel = input.models.map((model) => {
    const mine = input.outcomes.filter((o) => o.model === model);
    const kinds = [...new Set(mine.map((o) => o.kind))].sort();
    return {
      model,
      totals: totalsFor(mine),
      byKind: kinds.map((kind) => ({ kind, totals: totalsFor(mine.filter((o) => o.kind === kind)) })),
    };
  });
  return { ...input, byModel, measured: input.outcomes.length > 0 };
}

/** A figure, or an em dash. Never a zero standing in for an absence. */
function num(value: number | undefined, digits = 0): string {
  if (value === undefined) return "—";
  return digits ? value.toFixed(digits) : String(value);
}

function money(totals: Totals): string {
  if (totals.usd === undefined) return totals.unpriced ? "not priced" : "—";
  // A total that could not account for every run is a floor, and says so rather than rounding the
  // problem away. A reader comparing two models on price must know one of them is incomplete.
  return `$${totals.usd.toFixed(4)}${totals.unpriced ? ` (+${totals.unpriced} unpriced)` : ""}`;
}

function percent(rate: number | undefined): string {
  return rate === undefined ? "—" : `${Math.round(rate * 100)} %`;
}

/**
 * The report somebody reads.
 *
 * Markdown rather than a rendered page, because the thing that has to survive is the comparison
 * between two nights, and a table in a repository can be diffed.
 */
export function markdownReport(report: Report): string {
  const lines: string[] = ["# Evaluation report", ""];
  lines.push(`Run at ${report.at}.`, "");

  if (!report.measured) {
    // The honest empty report. The alternative — a table of zeros — is read as a score by everyone
    // who sees it, and the roadmap forbids inventing one.
    lines.push(
      "**Not measured.** No model was reachable, so no task was run and this report carries no",
      "figures. The task set itself is still checked on every commit: each check must fail on the",
      "untouched fixture and pass on the reference solution.",
      "",
    );
    return `${lines.join("\n")}\n`;
  }

  lines.push(`Endpoint: \`${report.endpoint || "(none)"}\`. Models: ${report.models.map((m) => `\`${m}\``).join(", ")}.`, "");
  lines.push("## Summary", "");
  lines.push("| model | passed | rate | time | steps | tokens in | tokens out | cost | out of steps | truncated | escalations |");
  lines.push("| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |");
  for (const row of report.byModel) {
    const t = row.totals;
    lines.push(
      `| \`${row.model}\` | ${t.passed}/${t.tasks} | ${percent(t.passRate)} | ${num(t.seconds, 1)} s | ${num(t.steps)} | ` +
        `${num(t.promptTokens)} | ${num(t.completionTokens)} | ${money(t)} | ${t.outOfSteps} | ${t.truncated} | ${t.escalations} |`,
    );
  }
  lines.push("");

  for (const row of report.byModel) {
    lines.push(`## \`${row.model}\``, "");
    lines.push("| kind | passed | rate | time | steps | cost |");
    lines.push("| --- | --- | --- | --- | --- | --- |");
    for (const k of row.byKind) {
      lines.push(
        `| ${k.kind} | ${k.totals.passed}/${k.totals.tasks} | ${percent(k.totals.passRate)} | ` +
          `${num(k.totals.seconds, 1)} s | ${num(k.totals.steps)} | ${money(k.totals)} |`,
      );
    }
    lines.push("");
    lines.push("| task | result | time | steps | tokens | cost |");
    lines.push("| --- | --- | --- | --- | --- | --- |");
    for (const o of report.outcomes.filter((x) => x.model === row.model)) {
      const t = totalsFor([o]);
      const tokens =
        t.promptTokens === undefined ? "—" : `${t.promptTokens}+${t.completionTokens ?? 0}`;
      lines.push(
        `| \`${o.task}\` | ${o.passed ? "pass" : "**FAIL**"} | ${num(o.seconds, 1)} s | ${num(t.steps)} | ${tokens} | ${money(t)} |`,
      );
    }
    lines.push("");
    const failed = report.outcomes.filter((x) => x.model === row.model && !x.passed);
    if (failed.length) {
      lines.push("### What the failures said", "");
      for (const o of failed) {
        lines.push(`**\`${o.task}\`** — agent exit ${o.agentExit}`, "", "```", (o.why ?? "(no output)").trim().slice(-1200), "```", "");
      }
    }
  }
  return `${lines.join("\n")}\n`;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function round4(n: number): number {
  return Math.round(n * 10_000) / 10_000;
}

/**
 * The comparison table, re-exported so the harness has one bundle to import.
 *
 * `esbuild` builds this file alone into `dist/eval-report.mjs`; a second entry point would mean two
 * bundles that can disagree about the arithmetic they share.
 */
export { qualityTable, rowsFromOutcomes, CONFIGURATIONS, ESCALATED_SUFFIX, type Measured, type TableInput } from "./table.js";
