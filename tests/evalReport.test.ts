// The report may not invent a number.
//
// An evaluation harness breaks this rule by default: a sum over nothing is 0, an average over
// nothing is NaN, and both render as a figure somebody will quote. These tests exist to make the
// absence of a measurement look like an absence.

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildReport, emptyTotals, markdownReport, totalsFor, type RunRecord, type TaskOutcome } from "../src/core/eval/report.js";

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
