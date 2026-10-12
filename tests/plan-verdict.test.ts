// An unfinished plan is evidence (chantier 4.1).
//
// The plan already existed, as a progress display — its own header said so: "not for the model's
// benefit; it is a progress display". What was missing is the half that changes an outcome rather
// than an appearance: a turn that ends with steps of its OWN plan outstanding has declared itself
// finished against its own list, and that is the shape of evidence the escalation spends money on.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { planVerdict, type Plan } from "../src/core/agent/plan.js";
import { verifyTurn, type TurnStep } from "../src/core/router/outcome.js";

const plan = (...states: Array<Plan["steps"][number]["state"]>): Plan => ({
  steps: states.map((state, i) => ({ title: `step ${i + 1}`, state })),
});

const step = (over: Partial<TurnStep> = {}): TurnStep => ({ tool: "read_file", ok: true, summary: "ok", ...over });

test("no plan is not unfinished work", () => {
  // The conservative direction, and it is the whole reason the old keyword escalation was worthless:
  // most good turns never need a plan, and treating their absence as a failure escalates every short
  // answer.
  assert.equal(planVerdict(undefined).unfinished, false);
  assert.equal(planVerdict({ steps: [] }).unfinished, false);
  assert.equal(verifyTurn([step()], undefined).kind, "none");
});

test("a plan with steps left is unfinished, and says which", () => {
  const verdict = planVerdict(plan("done", "pending", "running"));
  assert.equal(verdict.unfinished, true);
  assert.equal(verdict.left.length, 2);
  assert.match(verdict.why, /2 step\(s\) of its own plan outstanding/);
  assert.match(verdict.why, /"step 2"/);
});

test("a skipped step is settled, because a plan must be correctable halfway", () => {
  // The model decided it was not needed. A plan that could only ever be completed would be a plan
  // nobody could change their mind about.
  assert.equal(planVerdict(plan("done", "skipped")).unfinished, false);
});

test("the turn verdict reads the plan, and ranks it last", () => {
  // A failing check is concrete evidence about the code; an unfinished plan is the model's own
  // account of itself, which is weaker. So it only speaks when nothing harder did.
  const failing = step({ tool: "run_command", ok: false, call: "npm test", summary: "1 failing" });
  assert.equal(verifyTurn([failing], plan("pending")).kind, "verification");
  assert.equal(verifyTurn([step()], plan("pending")).kind, "plan");
  assert.equal(verifyTurn([step()], plan("done")).kind, "none");

  // And a repeated failure still outranks both.
  const stuck = Array.from({ length: 3 }, () => step({ ok: false, call: "x", summary: "no" }));
  assert.equal(verifyTurn(stuck, plan("pending")).kind, "stuck");
});

test("the terminal client offers the plan tool, so the harness can measure it", () => {
  // The panel had this tool and the terminal did not, on the reasoning that "a tool whose output
  // nothing displays spends tokens for nothing" — true while the plan was only a display. It also
  // meant the evaluation harness, which drives this client, could not measure plans at all, which
  // made the whole phase's "measure before and after" rule inapplicable.
  const tools = readFileSync("src/cli/tools.ts", "utf8");
  assert.match(tools, /name: "update_plan"/);
  const main = readFileSync("src/cli/main.ts", "utf8");
  assert.match(main, /planVerdict\(turnPlan\)/, "the terminal must reach the verdict too");
});

test("a turn with no plan records no plan figure, which is not zero", () => {
  // `planLeft: 0` for a turn that never planned would count discipline nobody exercised. The CLI
  // omits the field unless `update_plan` was actually called.
  const main = readFileSync("src/cli/main.ts", "utf8");
  assert.match(main, /result\.trace\.some\(\(x\) => x\.call\.name === "update_plan"\)/);
});
