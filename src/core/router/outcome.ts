// Did the turn actually work?
//
// The router escalates on a GUESS: a regular expression decides that "refactor the architecture"
// is hard and sends it to a large model, while "make the test pass" goes to the local one and comes
// back wrong. Both halves of that are expensive. The guess sends easy questions to a paid model
// because they contain a scary word, and it keeps hard ones local because they are phrased plainly
// — and nothing in it ever learns that the local attempt failed, because until the editor could
// read a command's output there was nothing to learn from.
//
// This module is the other way round. It reads what the turn DID — which commands ran, what the
// diagnostics said, whether the same call failed three times — and answers one question: is there
// evidence that this is not finished? Escalating on that costs a paid call only when a free one has
// already been proven not to work, and the paid call starts from the failure rather than from the
// question.
//
// It is deliberately conservative in one direction. A turn with no verification in it is NOT a
// failure: plenty of good answers change nothing and run nothing. Only observed failure counts,
// because the thing being bought with a wrong answer here is the user's money.

import { planVerdict, type Plan } from "../agent/plan.js";

/** One tool call, as the session already records it. */
export interface TurnStep {
  tool: string;
  /** False when the tool reported an error — a non-zero exit, a refused edit, a missing file. */
  ok: boolean;
  /** The first line of what came back. */
  summary: string;
  /** What the call was asked to do: the command, the path, the query. */
  call?: string;
}

export type Failure = "verification" | "stuck" | "plan" | "none";

export interface Verdict {
  kind: Failure;
  /** Why, in the words a person reads in a dialog and a model reads in a hand-over note. */
  why: string;
  /** The steps that carry the evidence, newest last. */
  evidence: TurnStep[];
}

/**
 * The tools whose result is a VERDICT on the work rather than a part of doing it.
 *
 * Reading a file can fail because the model guessed a path; that is a mistake it recovers from
 * inside the same turn and it says nothing about the outcome. A failing test says something about
 * the outcome. Only the second kind is evidence.
 */
const VERIFIERS = new Set(["run_command", "get_diagnostics", "hook"]);

/**
 * Commands whose exit code is a judgement on the code, as opposed to an answer to a question.
 *
 * This list is the difference between an escalation that fires when the work is broken and one that
 * fires on almost every agent turn. A non-zero exit is NOT a failure in general — it is how half the
 * shell reports "no", and an agent explores with exactly those tools:
 *
 *   • `grep` exits 1 when it finds nothing, which is a perfectly good answer to "is this used?"
 *   • `git diff --quiet` exits 1 when there ARE changes
 *   • `test -f`, `which`, `diff` — all of them answer a question with a status
 *
 * Treating those as proof that the turn failed bought a second full turn on a larger model, on
 * nearly every turn that searched for something and did not find it, and the user could not see it
 * happening. So the exit code counts only when the command was plausibly a CHECK: a test suite, a
 * build, a type-checker, a linter. Anything unrecognised is not evidence either way.
 */
const CHECK_COMMAND =
  /(^|[\s;&|(])(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?(?:test|build|lint|typecheck|check|tsc)\b|(^|[\s;&|(])(?:tsc|eslint|prettier|jest|vitest|mocha|ava|pytest|tox|phpunit|rspec|go\s+test|go\s+build|cargo\s+(?:test|build|check|clippy)|mvn|gradle|dotnet\s+(?:test|build)|make|ctest|rake|mix\s+test)\b/i;

/** Does this step's exit code say anything about whether the work is finished? */
function isJudgement(step: TurnStep): boolean {
  if (step.tool === "get_diagnostics") return true;
  // A hook the team wrote and attached to a tool call. Its exit code is their own check saying the
  // change is or is not acceptable, which is the definition of a verification — and unlike a shell
  // command the agent chose, nobody is using it to ask a question.
  if (step.tool === "hook") return true;
  if (step.tool !== "run_command") return false;
  return CHECK_COMMAND.test(step.call ?? "");
}

/**
 * Steps that mean the turn changed something, so there is work whose failure would matter.
 *
 * ⚠️ This list was incomplete against the real registry, and the gap was silent in both directions
 * it feeds: `verifyTurn` deciding whether there is finished work to judge, and the learned router
 * recording whether a turn changed anything. A turn whose only change was a knowledge-base write
 * was filed as having changed nothing.
 *
 * `run_command` is deliberately NOT here, and that is not an oversight: a command is most often the
 * CHECK (see `isJudgement`), and nothing can tell `npm test` from `sed -i` by its name. The cost of
 * that choice is stated where it bites — a checkpoint cannot roll back what a command did, and the
 * restore dialog says so (`core/session/checkpoint.ts`).
 */
const MUTATORS = new Set([
  "write_file",
  "edit_file",
  "git_commit",
  // Staging is a change to the index, which is what the next commit will be made of.
  "git_stage",
  // The knowledge base is a file in the repository: writing one is an edit with a different name.
  "knowledge_write",
  "knowledge_retire",
]);

/**
 * The tools whose presence means something actually checked the work.
 *
 * Exported because both halves of the product need the same answer to "did anything verify this?" —
 * the panel to decide whether to record a measurement, the terminal to decide whether to say the
 * change is unverified. Two copies of this set would be two different answers to one question.
 */
export const VERIFIER_TOOLS: ReadonlySet<string> = VERIFIERS;

/** The same, for the tools that change something. One source, two halves. */
export const MUTATING_TOOLS: ReadonlySet<string> = MUTATORS;

const STUCK_REPEATS = 3;

/**
 * What the evidence says about a finished turn.
 *
 * The rule for verification is "the LAST one wins", and it is the whole subtlety here. An agent
 * that runs the tests, sees three failures, fixes them and runs the tests again has a failing step
 * in its trace and a working repository; escalating that would pay a remote model to redo finished
 * work. What matters is the state the turn ended in, per kind of check.
 */
export function verifyTurn(steps: TurnStep[], plan?: Plan): Verdict {
  const stuck = repeatedFailure(steps);
  if (stuck) return stuck;

  const lastByTool = new Map<string, TurnStep>();
  for (const step of steps) {
    if (VERIFIERS.has(step.tool) && isJudgement(step)) lastByTool.set(step.tool, step);
  }
  const failing = [...lastByTool.values()].filter((s) => !s.ok);
  if (failing.length) {
    const names = failing.map((s) => s.call || s.tool).join(", ");
    return {
      kind: "verification",
      why: `the last check the turn ran did not pass (${names})`,
      evidence: failing,
    };
  }

  // Last, and deliberately last. A failing check is concrete evidence about the code; an unfinished
  // plan is the model's own account of itself, which is weaker — so it only speaks when nothing
  // harder did. It is still evidence: a turn that declared itself finished while its own list says
  // otherwise is the cheapest signal there is that the work is not done.
  const unfinished = planVerdict(plan);
  if (unfinished.unfinished) {
    return { kind: "plan", why: unfinished.why, evidence: [] };
  }

  return { kind: "none", why: "nothing in the turn reports a failure", evidence: [] };
}

/**
 * The same call, failing, over and over.
 *
 * A small model that cannot make a tool work does not stop: it calls it again with the same
 * arguments, four or five times, until the step budget runs out. That pattern is invisible to any
 * check of the final state — nothing was verified, so nothing failed — and it is the clearest
 * signal there is that a bigger model should take over.
 */
function repeatedFailure(steps: TurnStep[]): Verdict | undefined {
  const counts = new Map<string, TurnStep[]>();
  for (const step of steps) {
    if (step.ok) continue;
    const key = `${step.tool}\u0000${step.call ?? ""}`;
    const list = counts.get(key) ?? [];
    list.push(step);
    counts.set(key, list);
  }
  for (const [, list] of counts) {
    if (list.length < STUCK_REPEATS) continue;
    const first = list[0]!;
    return {
      kind: "stuck",
      why: `the same call failed ${list.length} times without changing (${first.call || first.tool})`,
      evidence: list.slice(-2),
    };
  }
  return undefined;
}

/** True when the turn changed something, so an unverified failure has consequences on disk. */
export function turnChangedSomething(steps: TurnStep[]): boolean {
  return steps.some((s) => MUTATORS.has(s.tool) && s.ok);
}

export interface HandoverInput {
  verdict: Verdict;
  /** Unified diffs of what the failed attempt changed, one per file. */
  diffs?: string[];
  /** The failing output in full, when the trace's one-line summary is not enough to act on. */
  detail?: string;
}

/**
 * What the second model is told, and why it is told it in this order.
 *
 * The failure first, because it is the fact; then the change that produced it, because that is
 * where the fix is; then the instruction. A model handed only "try again" repeats the first
 * attempt — the whole value of escalating is that the second attempt starts from the evidence the
 * first one generated.
 */
export function handoverNote(input: HandoverInput): string {
  const parts: string[] = [
    "A smaller model already attempted this and its attempt did not work. You are being given its" +
      " work and the evidence of the failure so you can finish it rather than start over.",
    `What failed: ${input.verdict.why}.`,
  ];
  const evidence = input.verdict.evidence.map((s) => `- ${s.call ? `${s.tool} ${s.call}` : s.tool} → ${s.summary}`);
  if (evidence.length) parts.push(`The failing steps:\n${evidence.join("\n")}`);
  if (input.detail) parts.push(`What it printed:\n${input.detail}`);
  if (input.diffs?.length) {
    parts.push(`What the previous attempt changed, and left in place:\n${input.diffs.join("\n\n")}`);
  }
  parts.push(
    "Read the diff before you change anything: the previous attempt is still on disk, so an edit" +
      " that assumes the original file will not apply. Fix the cause, then run the same check again.",
  );
  return parts.join("\n\n");
}

/**
 * What to say to a model that has stopped without checking its work.
 *
 * ⚠️ A turn ends the moment the model stops calling tools — `if (!res.toolCalls.length) return
 * done("answer")` — and nothing asked whether the work had been verified. The product had two
 * answers to "this looks unfinished" and both were expensive: tell the USER (which the "À savoir"
 * section now does) or **escalate to a bigger, billed model** (which `verifyTurn` does). The cheap
 * middle was missing: ask the same model to finish what it started. It usually can — it forgot, it
 * did not fail.
 *
 * Evidence-shaped rather than a question. "Are you sure?" invites a model to reassure; naming what
 * was observed — these files changed, no check ran — leaves it one thing to do.
 *
 * Returns nothing when there is nothing to say, which is most turns: a question answered in prose
 * changed nothing and is finished.
 */
export function selfCheckMessage(steps: TurnStep[]): string | undefined {
  const changed = steps.filter((s) => MUTATORS.has(s.tool) && s.ok);
  if (!changed.length) return undefined;
  // Ran AT ALL, not "ran and passed". A model that ran the tests and watched them fail has a
  // different problem, and `verifyTurn` already escalates on it; telling it to run a check it has
  // just run would be noise. This exists for the turn where nobody looked.
  if (steps.some((s) => VERIFIERS.has(s.tool))) return undefined;
  const what = [...new Set(changed.map((s) => s.call || s.tool))].slice(0, 5).join(", ");
  return [
    `You changed something (${what}) and nothing in this turn ran a test, a build, a compile or a linter.`,
    "Run whatever this repository uses to check that kind of change, and fix what it reports.",
    "If there is genuinely nothing to run, say so in one line and stop — do not invent a command.",
  ].join(" ");
}
