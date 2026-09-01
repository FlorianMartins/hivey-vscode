// The agent's to-do list.
//
// The parser is deliberately forgiving about shape and strict about meaning, and the tests are
// split along that line: a model that writes `status` instead of `state` has understood the task
// and mistyped the envelope, while a model that marks four steps as running has misunderstood what
// a plan is — and the display would then lie about what is happening.

import { test } from "node:test";
import assert from "node:assert/strict";
import { MAX_STEPS, parsePlan, planComplete, planSummary, PLAN_TOOL_DESCRIPTION } from "../src/core/agent/plan.js";

const ok = (raw: unknown) => {
  const { plan, error } = parsePlan(raw);
  assert.ok(plan, `expected a plan, got: ${error}`);
  return plan;
};

// ── Forgiving about shape ────────────────────────────────────────────────────────────────────

test("a plain list of strings is a plan", () => {
  const plan = ok(["Read the model", "Write the test"]);
  assert.deepEqual(plan.steps.map((s) => s.state), ["pending", "pending"]);
});

test("the wrapper object and the bare array are both accepted", () => {
  assert.deepEqual(ok({ steps: [{ title: "a", state: "done" }] }), ok([{ title: "a", state: "done" }]));
});

test("the synonyms models actually emit are understood", () => {
  // Rejecting these costs a whole request to argue about a word.
  const plan = ok([
    { title: "a", status: "in_progress" },
    { title: "b", state: "COMPLETED" },
    { title: "c", state: "Finished" },
    { title: "d", state: "nonsense" },
  ]);
  assert.deepEqual(plan.steps.map((s) => s.state), ["running", "done", "done", "pending"]);
});

test("a title under any of its usual names", () => {
  assert.equal(ok([{ name: "by name" }]).steps[0]!.title, "by name");
  assert.equal(ok([{ step: "by step" }]).steps[0]!.title, "by step");
});

test("a very long title is cut rather than refused", () => {
  const plan = ok([{ title: "x".repeat(500) }]);
  assert.ok(plan.steps[0]!.title.length <= 100);
});

// ── Strict about meaning ─────────────────────────────────────────────────────────────────────

test("two steps in progress is not a plan", () => {
  // The panel shows "the current step and a count of the rest". With two current steps there is no
  // such thing to show, so the display would have to pick one and be wrong half the time.
  const { plan, error } = parsePlan([
    { title: "a", state: "running" },
    { title: "b", state: "running" },
  ]);
  assert.equal(plan, undefined);
  assert.match(error!, /one step/i);
});

test("nothing, an empty list and a title-less step are all refused, each with a reason", () => {
  for (const raw of [undefined, null, "a string", 42, [], [{ state: "done" }]]) {
    const { plan, error } = parsePlan(raw);
    assert.equal(plan, undefined, JSON.stringify(raw));
    assert.ok(error && error.length > 10, `no usable message for ${JSON.stringify(raw)}`);
  }
});

test("an unbounded plan is refused, with advice rather than a number", () => {
  const { plan, error } = parsePlan(Array.from({ length: MAX_STEPS + 1 }, (_, i) => `step ${i}`));
  assert.equal(plan, undefined);
  assert.match(error!, /group/i);
});

// ── What the panel shows ─────────────────────────────────────────────────────────────────────

test("the summary is the current step and what is left after it", () => {
  const plan = ok([
    { title: "a", state: "done" },
    { title: "b", state: "running" },
    { title: "c", state: "pending" },
    { title: "d", state: "pending" },
  ]);
  const s = planSummary(plan);
  assert.equal(s.current?.title, "b");
  assert.equal(s.done, 1);
  assert.equal(s.total, 4);
  // Not 3: the step on screen must not also be counted among "the rest", or the numbers read as
  // one more thing to do than there is.
  assert.equal(s.remaining, 2);
});

test("with nothing running, the next pending step is the headline", () => {
  const s = planSummary(ok([{ title: "a", state: "done" }, { title: "b", state: "pending" }]));
  assert.equal(s.current?.title, "b");
});

test("a skipped step counts as finished, because nothing more will happen to it", () => {
  const plan = ok([{ title: "a", state: "done" }, { title: "b", state: "skipped" }]);
  assert.equal(planSummary(plan).done, 2);
  assert.equal(planComplete(plan), true);
});

test("a plan is not complete while anything is pending or running", () => {
  assert.equal(planComplete(ok([{ title: "a", state: "running" }])), false);
  assert.equal(planComplete(ok([{ title: "a", state: "pending" }])), false);
});

test("the tool tells the model the one rule the parser enforces", () => {
  // Stated in the description as well as checked, so the common case costs no retry.
  assert.match(PLAN_TOOL_DESCRIPTION, /one step/i);
  assert.match(PLAN_TOOL_DESCRIPTION, /single-step/i);
});
