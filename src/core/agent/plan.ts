// The agent's own to-do list.
//
// A multi-step turn is opaque while it runs. The step lines below an answer say what HAS happened —
// "read src/app.ts", "edited config.ts" — and nothing at all about what the model intends to do
// next, which is the thing anyone watching actually wants to know: is it nearly done, has it
// understood the task, is it about to touch something it should not.
//
// So the model keeps a plan, and the panel shows it. The plan is not a prompt technique and it is
// not for the model's benefit; it is a progress display with a contract. Which is why the rules
// below are enforced here rather than requested in a prompt:
//
//   • EXACTLY ONE STEP IS IN PROGRESS. A plan with three things happening at once is not a plan, it
//     is a list — and the panel's whole design is "show the current step, count the rest".
//   • THE LIST ONLY GROWS AND SETTLES. Steps keep their identity across updates, so a step marked
//     done cannot quietly become pending again, and the display does not reshuffle under the eye of
//     someone reading it.

export type StepState = "pending" | "running" | "done" | "skipped";

export interface PlanStep {
  /** Short, imperative, in the user's language: "Read the invoice model". */
  title: string;
  state: StepState;
}

export interface Plan {
  steps: PlanStep[];
}

const STATES = new Set<StepState>(["pending", "running", "done", "skipped"]);
/** Long enough for a real step, short enough that the panel never has to wrap one. */
export const MAX_TITLE = 100;
export const MAX_STEPS = 20;

/**
 * Turn whatever the model sent into a plan, or say why it is not one.
 *
 * Written to be forgiving about shape and strict about meaning. A model that sends `{title, status}`
 * instead of `{title, state}`, or capitalises "Done", has understood the task and mistyped the
 * envelope — rejecting that produces a turn spent arguing about JSON. A model that marks four steps
 * as running has misunderstood what a plan is, and that has to be corrected or the display lies.
 */
export function parsePlan(raw: unknown): { plan?: Plan; error?: string } {
  const list = Array.isArray(raw) ? raw : (raw as { steps?: unknown })?.steps;
  if (!Array.isArray(list)) return { error: "Expected a list of steps." };
  if (!list.length) return { error: "A plan needs at least one step." };
  if (list.length > MAX_STEPS) return { error: `At most ${MAX_STEPS} steps; group the small ones.` };

  const steps: PlanStep[] = [];
  for (const item of list) {
    const source = typeof item === "string" ? { title: item } : (item as Record<string, unknown>);
    const title = String(source?.["title"] ?? source?.["name"] ?? source?.["step"] ?? "").trim();
    if (!title) return { error: "Every step needs a title." };
    const named = String(source?.["state"] ?? source?.["status"] ?? "pending").toLowerCase();
    // Common synonyms, because they are what models actually emit and the alternative is a retry
    // that costs a request to fix a word.
    const state: StepState =
      named === "in_progress" || named === "in-progress" || named === "active" || named === "current"
        ? "running"
        : named === "completed" || named === "complete" || named === "finished"
          ? "done"
          : STATES.has(named as StepState)
            ? (named as StepState)
            : "pending";
    steps.push({ title: title.slice(0, MAX_TITLE), state });
  }

  const running = steps.filter((s) => s.state === "running");
  if (running.length > 1) return { error: "Exactly one step may be in progress at a time." };
  return { plan: { steps } };
}

/** What the panel shows when the plan is collapsed: the current step, and how much is left. */
export function planSummary(plan: Plan): { current?: PlanStep; done: number; total: number; remaining: number } {
  const done = plan.steps.filter((s) => s.state === "done" || s.state === "skipped").length;
  const current = plan.steps.find((s) => s.state === "running") ?? plan.steps.find((s) => s.state === "pending");
  return {
    ...(current ? { current } : {}),
    done,
    total: plan.steps.length,
    // What is neither finished nor on screen — the number the counter shows next to the current
    // step. Counting everything unfinished would count the step being displayed twice.
    remaining: Math.max(0, plan.steps.length - done - (current ? 1 : 0)),
  };
}

/** True once nothing is left to do, which is when the panel can collapse the plan for good. */
export function planComplete(plan: Plan): boolean {
  return plan.steps.every((s) => s.state === "done" || s.state === "skipped");
}

export const PLAN_TOOL_DESCRIPTION = [
  "Keep a short plan of what you are doing, so the user can follow along.",
  "Call this FIRST for any task needing more than one step, then again after each step to mark it done and start the next.",
  "Exactly one step may be 'running' at a time. Titles are short and imperative, in the user's language.",
  "Do not call it for a single-step task: a one-line plan is noise.",
].join(" ");
