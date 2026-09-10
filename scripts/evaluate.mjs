// Does the model actually finish the job?
//
// The test suite proves the extension works. It says nothing about whether an ANSWER is any good,
// and "more reliable than the alternatives" is a claim that needs a number or it is marketing. So:
// a set of small broken repositories, the real agent loop pointed at each one, and a command that
// decides whether the result works. Same tasks, same checks, every night — a regression net for the
// thing this product actually sells.
//
// Three decisions worth stating.
//
// THE CHECK IS A COMMAND, NOT A DIFF. Comparing against a reference solution scores the model on
// writing the answer somebody already wrote. A command scores it on the only thing the user cares
// about — does the code work now — and lets two models pass by solving it differently.
//
// THE HARNESS IS THE CLI, NOT A REIMPLEMENTATION. `hivey-code --yes` is the same loop, the same
// tools and the same prompts the extension runs. An evaluation that drives its own private loop
// measures the evaluation.
//
// A TASK THAT PASSES BEFORE THE MODEL TOUCHES IT MEASURES NOTHING. It scores every model 100 %, it
// is the easiest mistake in the world to make (fixtures get written by breaking working code), and
// it is invisible in the results. `--verify-tasks` runs every check against every untouched fixture
// and fails if any of them passes. It needs no model, so it runs on every commit.

import { spawn } from "node:child_process";
import { cp, mkdtemp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const TASKS_DIR = join(ROOT, "eval", "tasks");
const RESULTS_DIR = join(ROOT, "eval", "results");
const CLI = join(ROOT, "dist", "cli.js");

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const has = (name) => args.includes(`--${name}`);

/** Run a shell command in a directory, capturing everything, with a deadline. */
function sh(command, cwd, timeoutMs = 120_000) {
  return new Promise((resolveRun) => {
    const child = spawn(command, { cwd, shell: true, env: { ...process.env } });
    let out = "";
    let killed = false;
    const timer = setTimeout(() => {
      killed = true;
      child.kill("SIGKILL");
    }, timeoutMs);
    const append = (chunk) => {
      out += chunk.toString();
      if (out.length > 40_000) out = out.slice(-40_000);
    };
    child.stdout.on("data", append);
    child.stderr.on("data", append);
    child.on("close", (code) => {
      clearTimeout(timer);
      resolveRun({ code: killed ? 124 : (code ?? 1), out, killed });
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      resolveRun({ code: 127, out: String(err), killed: false });
    });
  });
}

async function loadTasks() {
  const names = (await readdir(TASKS_DIR, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name);
  const tasks = [];
  for (const id of names.sort()) {
    const meta = JSON.parse(await readFile(join(TASKS_DIR, id, "task.json"), "utf8"));
    tasks.push({ id, dir: join(TASKS_DIR, id), ...meta });
  }
  return tasks;
}

/** A throwaway copy of a task's fixture. Nothing is ever run in the repository itself. */
async function checkout(task) {
  const dir = await mkdtemp(join(tmpdir(), `hivey-eval-${task.id}-`));
  await cp(join(task.dir, "files"), dir, { recursive: true });
  if (task.setup) {
    const setup = await sh(task.setup, dir, 60_000);
    if (setup.code !== 0) throw new Error(`setup failed for ${task.id}: ${setup.out}`);
  }
  return dir;
}

/**
 * Every check, against an untouched fixture. Each one MUST fail.
 *
 * This is the part that can run with no model and no GPU, which is what makes it a CI gate rather
 * than a good intention. A green evaluation over tasks that were already passing is worse than no
 * evaluation, because somebody will quote it.
 */
async function verifyTasks(tasks) {
  let broken = 0;
  for (const task of tasks) {
    const dir = await checkout(task);
    try {
      const result = await sh(task.check, dir, task.timeoutMs ?? 180_000);
      if (result.code === 0) {
        broken++;
        console.log(`✗ ${task.id}: the check PASSES on the untouched fixture, so this task measures nothing`);
      } else {
        console.log(`✓ ${task.id}: fails before the model touches it (exit ${result.code})`);
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
  console.log(`\n${tasks.length - broken}/${tasks.length} tasks are honest`);
  return broken === 0;
}

/** One task, one model, from a clean copy to a verdict. */
async function runTask(task, model, endpoint) {
  const dir = await checkout(task);
  const started = Date.now();
  try {
    const attempt = await sh(
      `node ${JSON.stringify(CLI)} --yes ${JSON.stringify(task.prompt)}`,
      dir,
      task.timeoutMs ?? 180_000,
    );
    // Re-run the setup before checking: a task whose check needs a database must not be scored on
    // one the model happened to leave behind.
    if (task.setup) await sh(task.setup, dir, 60_000);
    const check = await sh(task.check, dir, 120_000);
    return {
      task: task.id,
      kind: task.kind,
      model,
      passed: check.code === 0,
      seconds: Math.round((Date.now() - started) / 100) / 10,
      agentExit: attempt.code,
      // Only on failure, and only the tail: the interesting part of a failed run is what the check
      // said, and a results file that carries every successful log is unreadable.
      ...(check.code === 0 ? {} : { why: check.out.slice(-2000), agent: attempt.out.slice(-2000) }),
    };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function table(results, models) {
  const tasks = [...new Set(results.map((r) => r.task))].sort();
  const width = Math.max(...tasks.map((t) => t.length), 4);
  const head = ["task".padEnd(width), ...models.map((m) => m.slice(0, 18).padEnd(18))].join("  ");
  const rows = tasks.map((t) => {
    const cells = models.map((m) => {
      const r = results.find((x) => x.task === t && x.model === m);
      return (r ? (r.passed ? `pass ${r.seconds}s` : "FAIL") : "—").padEnd(18);
    });
    return [t.padEnd(width), ...cells].join("  ");
  });
  const totals = models.map((m) => {
    const mine = results.filter((r) => r.model === m);
    const passed = mine.filter((r) => r.passed).length;
    return `${passed}/${mine.length}`.padEnd(18);
  });
  return [head, "-".repeat(head.length), ...rows, "-".repeat(head.length), ["total".padEnd(width), ...totals].join("  ")].join("\n");
}

async function main() {
  const tasks = (await loadTasks()).filter((t) => {
    const only = flag("only", "");
    return !only || t.kind === only || t.id === only;
  });
  if (!tasks.length) {
    console.error("no tasks matched");
    process.exit(2);
  }

  if (has("verify-tasks")) {
    process.exit((await verifyTasks(tasks)) ? 0 : 1);
  }

  if (!existsSync(CLI)) {
    console.error(`${CLI} is missing — run \`npm run build\` first.`);
    process.exit(2);
  }

  const endpoint = flag("url", process.env["HIVEY_CODE_URL"] ?? "");
  const models = flag("model", process.env["HIVEY_CODE_MODEL"] ?? "").split(",").map((m) => m.trim()).filter(Boolean);
  if (!endpoint || !models.length) {
    // Not an error, and this is deliberate: the nightly workflow has no model unless somebody
    // configures one, and a scheduled job that goes red every night is a job people mute.
    console.log("No endpoint or model given (--url / --model). Nothing to evaluate.");
    console.log("The task set itself can still be checked with --verify-tasks.");
    process.exit(0);
  }

  process.env["HIVEY_CODE_URL"] = endpoint;
  process.env["HIVEY_CODE_PROVIDER"] = process.env["HIVEY_CODE_PROVIDER"] ?? "local";

  const results = [];
  for (const model of models) {
    process.env["HIVEY_CODE_MODEL"] = model;
    for (const task of tasks) {
      process.stdout.write(`${model} · ${task.id} … `);
      const result = await runTask(task, model, endpoint);
      results.push(result);
      console.log(result.passed ? `pass (${result.seconds}s)` : `FAIL (${result.seconds}s)`);
    }
  }

  console.log(`\n${table(results, models)}`);

  await mkdir(RESULTS_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const file = join(RESULTS_DIR, `${stamp}.json`);
  await writeFile(file, JSON.stringify({ at: new Date().toISOString(), endpoint, models, results }, null, 2) + "\n");
  console.log(`\nwritten: ${file}`);

  // The exit code reports whether the harness ran, not whether the models are good. A model that
  // fails four tasks is information; it is not a broken build.
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
