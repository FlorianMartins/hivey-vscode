// The report may not invent a number.
//
// An evaluation harness breaks this rule by default: a sum over nothing is 0, an average over
// nothing is NaN, and both render as a figure somebody will quote. These tests exist to make the
// absence of a measurement look like an absence.

import { test } from "node:test";
import { readdirSync, readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { buildReport, emptyTotals, markdownReport, totalsFor, type RunRecord, type TaskOutcome } from "../src/core/eval/report.js";
import { CONFIGURATIONS, qualityTable, rowsFromOutcomes } from "../src/core/eval/table.js";

function run(over: Partial<RunRecord> = {}): RunRecord {
  return {
    model: "m",
    steps: 3,
    promptTokens: 1000,
    completionTokens: 200,
    usd: 0.01,
    stoppedBecause: "answer",
    truncated: false,
    tools: { read_file: 1, edit_file: 1 },
    ms: 4000,
    ...over,
  };
}

function outcome(over: Partial<TaskOutcome> = {}): TaskOutcome {
  return { task: "t", kind: "bug", model: "m", passed: true, seconds: 4, agentExit: 0, runs: [run()], ...over };
}

test("nothing measured is absent, not zero", () => {
  const t = totalsFor([]);
  assert.deepEqual(t, emptyTotals(0));
  assert.equal(t.passRate, undefined, "a pass rate over no tasks is not 0 %");
  assert.equal(t.steps, undefined);
  assert.equal(t.usd, undefined);
});

test("a task run with no reported run keeps its verdict and claims no figures", () => {
  const t = totalsFor([outcome({ runs: [] })]);
  assert.equal(t.passed, 1);
  assert.equal(t.passRate, 1);
  assert.equal(t.steps, undefined, "no run reported means no step count to report");
  assert.equal(t.promptTokens, undefined);
  assert.equal(t.usd, undefined);
});

test("an unpriced run is counted as unpriced, never as free", () => {
  const t = totalsFor([outcome({ runs: [run({ usd: undefined })] })]);
  assert.equal(t.usd, undefined, "a total over no priced run is not $0");
  assert.equal(t.unpriced, 1);
});

test("a cost total that could not price every run says so", () => {
  const t = totalsFor([outcome({ runs: [run({ usd: 0.02 }), run({ usd: undefined })] })]);
  assert.equal(t.usd, 0.02);
  assert.equal(t.unpriced, 1);
  const md = markdownReport(buildReport({ at: "now", endpoint: "http://x/v1", models: ["m"], outcomes: [outcome({ runs: [run({ usd: 0.02 }), run({ usd: undefined })] })] }));
  assert.match(md, /\+1 unpriced/, "a partial cost must be marked as a floor, not printed as a figure");
});

test("the quality signals are counted", () => {
  const t = totalsFor([
    outcome({ runs: [run({ stoppedBecause: "max-steps" })] }),
    outcome({ runs: [run({ truncated: true })] }),
    outcome({ runs: [run({ escalatedTo: "big" })] }),
  ]);
  assert.equal(t.outOfSteps, 1);
  assert.equal(t.truncated, 1);
  assert.equal(t.escalations, 1);
  assert.equal(t.steps, 9);
});

test("a report with no model reachable says it was not measured, with no table", () => {
  const md = markdownReport(buildReport({ at: "2026-10-02T00:00:00Z", endpoint: "", models: [], outcomes: [] }));
  assert.match(md, /Not measured/);
  assert.equal(/\| model \|/.test(md), false, "an empty run must not render a summary table");
  assert.equal(/0 %/.test(md), false, "0 % is a score, and nothing was scored");
});

test("a measured report carries the rate, the cost and the failures", () => {
  const outcomes = [
    outcome({ task: "a", passed: true }),
    outcome({ task: "b", kind: "ibmi", passed: false, why: "check said no", agentExit: 1, runs: [run({ steps: 11, stoppedBecause: "max-steps" })] }),
  ];
  const md = markdownReport(buildReport({ at: "now", endpoint: "http://x/v1", models: ["m"], outcomes }));
  assert.match(md, /50 %/);
  assert.match(md, /\*\*FAIL\*\*/);
  assert.match(md, /check said no/, "a failure must carry what the check printed");
  assert.match(md, /\| ibmi \|/, "the breakdown by kind is what tells an IBM i buyer anything");
});

test("the breakdown is per model and per kind, and each model sees only its own", () => {
  const report = buildReport({
    at: "now",
    endpoint: "http://x/v1",
    models: ["small", "big"],
    outcomes: [
      outcome({ task: "a", model: "small", passed: false }),
      outcome({ task: "a", model: "big", passed: true }),
      outcome({ task: "b", model: "big", kind: "ibmi", passed: true }),
    ],
  });
  const small = report.byModel.find((r) => r.model === "small")!;
  const big = report.byModel.find((r) => r.model === "big")!;
  assert.equal(small.totals.tasks, 1);
  assert.equal(small.totals.passed, 0);
  assert.equal(big.totals.passed, 2);
  assert.deepEqual(big.byKind.map((k) => k.kind), ["bug", "ibmi"]);
});

// ---------------------------------------------------------------------------
// The published comparison table (chantier 3.5).
//
// Same rule as the report, applied to the artefact somebody actually quotes, plus one that is
// specific to a table: a row must belong to exactly one configuration.

test("an unmeasured configuration reads as unmeasured, never as zero", () => {
  const md = qualityTable({ taskCount: 56, rows: [] });
  assert.match(md, /not measured/);
  // On the ROWS, not on the file: the prose explains that an unmeasured configuration must never
  // read `0 %`, so a negative grep over the whole document rejects the document for saying so. That
  // mistake has been made four times in this repository; a check on the table is the check meant.
  const cells = md.split("\n").filter((l) => l.startsWith("| `"));
  for (const line of cells) {
    assert.ok(!/\b0 %/.test(line), `an unmeasured configuration rendered as a score: ${line}`);
  }
  // And it still has to name what it would compare, or the committed file says nothing at all.
  for (const spec of CONFIGURATIONS) assert.ok(md.includes(spec.configuration), spec.configuration);
});

test("the table names no competitor it has not run", () => {
  const md = qualityTable({ taskCount: 56, rows: [] });
  // Mentioned in prose — the file explains the absence, which is the honest thing to publish — but
  // never as a row, which is what a reader reads as a measurement.
  for (const line of md.split("\n").filter((l) => l.startsWith("| `"))) {
    assert.ok(!/copilot|bob/i.test(line), `a competitor appears as a table row: ${line}`);
  }
});

test("an escalated run is not averaged into the bare model's row", () => {
  // Both of these came from one `--model m`, and only one of them is that model's own score.
  // Summed, the table would report 50 % for a configuration that scored 100 % and one that scored 0.
  const rows = rowsFromOutcomes([
    outcome({ passed: true }),
    outcome({ passed: false, runs: [run({ escalatedTo: "big" })] }),
  ]);
  assert.equal(rows.length, 2, "an escalated run and a bare one must not share a row");
  assert.equal(rows.find((r) => !r.configuration.includes("escalation"))?.totals.passRate, 1);
  assert.equal(rows.find((r) => r.configuration.includes("escalation"))?.totals.passRate, 0);
});

test("a cost nobody could price is not printed as free", () => {
  const rows = rowsFromOutcomes([outcome({ runs: [run({ usd: undefined })] })]);
  const md = qualityTable({ taskCount: 1, at: "2026-10-03", rows });
  assert.match(md, /not priced/);
  assert.ok(!/\$0\.0000/.test(md), "an unknown price must not render as $0.0000");
});

// The committed file, against the generator that produces it.
//
// This is the one that stops the artefact rotting. `eval/QUALITY.md` is read by people who will
// never run the harness, and a table that says "51 tasks" after five more were added is wrong in the
// quietest possible way — nothing fails, the number is simply no longer true. Regenerating it is one
// command; knowing that it needs regenerating is this test.
test("the committed quality table still describes the task set it was generated from", () => {
  const tasks = readdirSync("eval/tasks", { withFileTypes: true }).filter((d) => d.isDirectory()).length;
  const committed = readFileSync("eval/QUALITY.md", "utf8");
  // The count, not the whole file: a table somebody has actually MEASURED must be allowed to differ
  // from what the unmeasured generator emits, which is the entire point of generating it. What may
  // never differ is how many tasks it claims to be about.
  assert.ok(
    committed.includes(`(${tasks} tasks)`),
    `eval/QUALITY.md does not say ${tasks} tasks — run \`node scripts/evaluate.mjs --table eval/QUALITY.md\``,
  );
  // And whatever it says, it says it about the five configurations and about no competitor.
  for (const spec of CONFIGURATIONS) assert.ok(committed.includes(spec.configuration), spec.configuration);
  for (const line of committed.split("\n").filter((l) => l.startsWith("| `"))) {
    assert.ok(!/copilot|bob/i.test(line), `a competitor appears as a row of the committed table: ${line}`);
  }
});

test("a configuration is named by whoever ran it, not inferred from the model", () => {
  // The harness is given `--model`; the configuration is what somebody chose. Labelling a bare model
  // run `hivey/balanced` because it looked like one would be the table inventing its own subject.
  const rows = rowsFromOutcomes([outcome(), outcome({ passed: false })], "local only");
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.configuration, "local only");
  assert.equal(rows[0]!.totals.passRate, 0.5);
  // The escalation split survives the label, because it is a different configuration either way.
  const split = rowsFromOutcomes([outcome(), outcome({ runs: [run({ escalatedTo: "big" })] })], "local only");
  assert.deepEqual(split.map((r) => r.configuration).sort(), ["local only", "local only + escalation"]);
  // And with no label the row is the model, which is honest and less useful.
  assert.equal(rowsFromOutcomes([outcome()])[0]!.configuration, "m");
});

test("a measured table names the models behind its figures", () => {
  const md = qualityTable({
    taskCount: 1,
    at: "2026-10-03",
    endpoint: "http://127.0.0.1:11434/v1",
    models: ["qwen2.5-coder:7b"],
    rows: rowsFromOutcomes([outcome()], "local only"),
  });
  assert.match(md, /qwen2\.5-coder:7b/);
  assert.match(md, /127\.0\.0\.1:11434/);
});

test("a task where the model never acted is counted as such", () => {
  // The number that made a real measurement readable. 0 % says a model is not good enough; this says
  // whether it was wrong or whether it never tried — and only one of those is a modelling problem.
  const acted = outcome({ runs: [run({ steps: 3 })] });
  const idle = outcome({ passed: false, runs: [run({ steps: 0 })] });
  const silent = outcome({ passed: false, runs: [] });
  const t = totalsFor([acted, idle, silent]);
  assert.equal(t.neverActed, 2, "a task whose client reported nothing took no step either");
  assert.equal(totalsFor([acted]).neverActed, 0, "zero means it acted every time, which is a result");
  assert.equal(emptyTotals(0).neverActed, 0);
});
