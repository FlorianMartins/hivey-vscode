// The environments of the two processes the bench starts per task: the AGENT and the CHECK.
//
// They differ in exactly one thing, and it is the thing that keeps the measurement honest. The check
// may copy a task's hidden tests into the working copy (`eval/check/hidden`); the agent must not be
// able to reach that helper by any route — not on its PATH, not through a variable. So the helper's
// absolute path exists only in the check's environment, and this module is the one place both
// environments are built, which is what lets a unit test hold the line (tests/evalEnv.test.ts).

import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** On PATH for every child: `codeonly`, `tsc`. Nothing in it reads a task's hidden tests. */
export const EVAL_BIN = join(ROOT, "eval", "bin");

/** The helper that restores a task's hidden tests. Never on anybody's PATH. */
export const HIDDEN_HELPER = join(ROOT, "eval", "check", "hidden");

/** What a check — and only a check — gets on top of the common environment. */
export const CHECK_ONLY_ENV = Object.freeze({ HIVEY_EVAL_HIDDEN: HIDDEN_HELPER });

/**
 * The environment of a child process: the parent's, `eval/bin` first on PATH, then `extra`.
 *
 * The agent is started with `childEnv(process.env, { HIVEY_CODE_…, HOME, … })`, exactly as before
 * the hidden tests existed; a check with `childEnv(process.env, CHECK_ONLY_ENV)`.
 */
export function childEnv(base, extra = {}) {
  const env = { ...base, PATH: `${EVAL_BIN}:${base.PATH ?? ""}`, ...extra };
  // Not inherited, ever: if whoever runs the bench happens to have it exported, the agent would get
  // it too. Only an explicit CHECK_ONLY_ENV puts it back.
  if (!("HIVEY_EVAL_HIDDEN" in extra)) delete env.HIVEY_EVAL_HIDDEN;
  return env;
}
