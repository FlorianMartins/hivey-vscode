// The agent under evaluation must not be able to reach the tests it is scored by.
//
// Twenty tasks keep their deciding tests in `eval/tasks/<id>/hidden/`, copied into the working copy
// by `eval/check/hidden` when — and only when — the check runs. Everything about that is worthless
// if the agent can call the same helper: one `ls` of its PATH and the hidden tests are a command
// away. So the helper is not on any PATH, its absolute path travels in HIVEY_EVAL_HIDDEN, and that
// variable is set for the check process only. These tests hold each of those three lines.

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { delimiter, join, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

interface EvalEnv {
  EVAL_BIN: string;
  HIDDEN_HELPER: string;
  CHECK_ONLY_ENV: Record<string, string>;
  childEnv(base: Record<string, string | undefined>, extra?: Record<string, string>): Record<string, string | undefined>;
}

const load = async (): Promise<EvalEnv> => (await import(pathToFileURL(resolve("scripts/eval-env.mjs")).href)) as EvalEnv;

/** The environment `runTask` gives the agent: the same extras, built by the same function. */
function agentEnvOf(mod: EvalEnv, base: Record<string, string | undefined>) {
  return mod.childEnv(base, {
    HIVEY_CODE_RUN_REPORT: "/tmp/run/run.jsonl",
    HIVEY_CODE_MODEL: "some-model",
    HOME: "/tmp/task",
    USERPROFILE: "/tmp/task",
  });
}

test("the agent's PATH holds no way to the hidden tests", async () => {
  const mod = await load();
  const env = agentEnvOf(mod, { PATH: "/usr/bin:/bin", HOME: "/root" });
  const repo = resolve(".");
  const path = env["PATH"] ?? "";
  assert.ok(path.startsWith(`${mod.EVAL_BIN}:`), "eval/bin is still first on the agent's PATH, as before");
  // eval/bin first (joined with ':' by the harness, as it always was), then whatever the parent had.
  const dirs = [mod.EVAL_BIN, ...path.slice(mod.EVAL_BIN.length + 1).split(delimiter)].filter(Boolean);
  for (const dir of dirs) {
    if (!existsSync(dir)) continue;
    assert.equal(existsSync(join(dir, "hidden")), false, `${dir} has a 'hidden' command`);
    if (!resolve(dir).startsWith(repo)) continue;
    // Every helper the repository puts on the agent's PATH, read: none of them may know where the
    // hidden tests are.
    for (const name of readdirSync(dir)) {
      const text = readFileSync(join(dir, name), "utf8");
      assert.doesNotMatch(text, /hidden\//, `${dir}/${name} mentions a hidden/ folder`);
      assert.doesNotMatch(text, /eval\/check|HIVEY_EVAL_HIDDEN/, `${dir}/${name} points at the check-only helper`);
    }
  }
});

test("no variable of the agent's environment leads to the helper — even one the operator exported", async () => {
  const mod = await load();
  const env = agentEnvOf(mod, { PATH: "/usr/bin", HIVEY_EVAL_HIDDEN: mod.HIDDEN_HELPER });
  assert.equal("HIVEY_EVAL_HIDDEN" in env, false);
  for (const [key, value] of Object.entries(env)) {
    assert.ok(!String(value).includes(mod.HIDDEN_HELPER), `${key} carries the helper's path`);
    assert.ok(!String(value).includes(`${sep}check${sep}hidden`), `${key} carries the helper's path`);
  }
});

test("the check, and only the check, gets the helper", async () => {
  const mod = await load();
  const env = mod.childEnv({ PATH: "/usr/bin" }, mod.CHECK_ONLY_ENV);
  assert.equal(env["HIVEY_EVAL_HIDDEN"], mod.HIDDEN_HELPER);
  assert.ok(existsSync(mod.HIDDEN_HELPER), "the helper exists");
  if (process.platform !== "win32") assert.ok(statSync(mod.HIDDEN_HELPER).mode & 0o111, "the helper is executable");
  assert.ok(!mod.HIDDEN_HELPER.startsWith(mod.EVAL_BIN + sep), "the helper must not live in eval/bin");
  assert.deepEqual(Object.keys(mod.CHECK_ONLY_ENV), ["HIVEY_EVAL_HIDDEN"]);
});

test("the harness builds both environments there, and gives the helper to checks alone", () => {
  // Read from the source, because this is a claim about which call site passes what.
  const harness = readFileSync("scripts/evaluate.mjs", "utf8");
  assert.match(harness, /env: childEnv\(process\.env, env\)/, "sh() no longer builds its environment in eval-env.mjs");
  const checks = harness.match(/sh\(task\.check,[^)]*\)/g) ?? [];
  assert.equal(checks.length, 3, "verify-tasks, verify-solutions and the scored run each run the check");
  for (const call of checks) assert.match(call, /CHECK_ONLY_ENV\)$/, `${call} runs a check without the helper`);
  const start = harness.indexOf('["node", CLI, "--yes", task.prompt]');
  const agent = harness.slice(start, harness.indexOf("if (task.setup) await sh(task.setup", start));
  assert.ok(agent.length > 0, "the agent's call was not found");
  assert.doesNotMatch(agent, /CHECK_ONLY_ENV|HIVEY_EVAL_HIDDEN/, "the agent is given the check's environment");
});

test("hidden tests are never part of a working copy, and every check that needs them asks for its own", () => {
  const dir = "eval/tasks";
  for (const id of readdirSync(dir)) {
    const task = JSON.parse(readFileSync(join(dir, id, "task.json"), "utf8")) as { check: string };
    for (const part of ["files", "solution"]) {
      if (!existsSync(join(dir, id, part))) continue;
      const entries = readdirSync(join(dir, id, part), { recursive: true }).map(String);
      const leaked = entries.filter((p) => /(^|[\\/])hidden([\\/]|$)|\.hidden\./.test(p));
      assert.deepEqual(leaked, [], `${id}/${part} carries hidden tests`);
    }
    assert.doesNotMatch(task.check, /(^|&&\s*)hidden\s/, `${id} calls the helper by name, as if it were on PATH`);
    if (task.check.includes("HIVEY_EVAL_HIDDEN")) {
      assert.ok(task.check.startsWith(`"$HIVEY_EVAL_HIDDEN" ${id} &&`), `${id} restores another task's tests`);
      assert.ok(existsSync(join(dir, id, "hidden")), `${id} asks for hidden tests it does not have`);
    }
  }
});
