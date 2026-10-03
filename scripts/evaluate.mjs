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
function sh(command, cwd, timeoutMs = 120_000, env = {}) {
  return new Promise((resolveRun) => {
    const child = spawn(command, {
      cwd,
      shell: true,
      // `eval/bin` on PATH, which is how a check gets `codeonly` — a structural check must look at
      // the code and not at the comments, and the helper that strips them has to live OUTSIDE the
      // working copy: a tool the agent can edit is not a check. See `eval/bin/codeonly`.
      env: { ...process.env, PATH: `${join(ROOT, "eval", "bin")}:${process.env.PATH ?? ""}`, ...env },
    });
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
async function checkout(task, { withSolution = false } = {}) {
  const dir = await mkdtemp(join(tmpdir(), `hivey-eval-${task.id}-`));
  await cp(join(task.dir, "files"), dir, { recursive: true });
  // The reference solution, laid over the fixture. Only for `--verify-solutions`; a model never
  // sees it, and it is not what a model is scored against — see `verifySolutions`.
  if (withSolution && existsSync(join(task.dir, "solution"))) {
    await cp(join(task.dir, "solution"), dir, { recursive: true });
  }
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

/**
 * Every check, against the reference solution. Each one MUST pass.
 *
 * The other half of `--verify-tasks`, and the half that was missing. `--verify-tasks` catches a
 * task that passes before the model touches it; nothing caught a task that **can never pass** —
 * a check with a typo in a grep, a command that needs a compiler this machine does not have, a
 * condition the prompt never asks for. Such a task scores every model 0 % and looks exactly like a
 * hard task, which is worse than looking broken: it becomes evidence against the models.
 *
 * So every task ships a `solution/` laid over the fixture, and the check must go green on it. The
 * solution is one way to do the task, not the way: the model is still scored by the command, and
 * two models solving it differently both pass. It exists to prove the command is satisfiable.
 *
 * A task with no `solution/` is reported, not skipped silently — an unprovable check is exactly
 * what this exists to find.
 */
async function verifySolutions(tasks) {
  let bad = 0;
  for (const task of tasks) {
    if (!existsSync(join(task.dir, "solution"))) {
      bad++;
      console.log(`✗ ${task.id}: no solution/, so nothing proves this check CAN pass`);
      continue;
    }
    const dir = await checkout(task, { withSolution: true });
    try {
      const result = await sh(task.check, dir, task.timeoutMs ?? 180_000);
      if (result.code === 0) {
        console.log(`✓ ${task.id}: passes on the reference solution`);
      } else {
        bad++;
        console.log(`✗ ${task.id}: FAILS on its own solution (exit ${result.code}) — the check is unsatisfiable`);
        console.log(`    ${result.out.trim().split("\n").slice(-4).join("\n    ")}`);
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
  console.log(`\n${tasks.length - bad}/${tasks.length} checks are satisfiable`);
  return bad === 0;
}

/** One task, one model, from a clean copy to a verdict. */
async function runTask(task, model, endpoint) {
  const dir = await checkout(task);
  // OUTSIDE the working copy, deliberately. A file the agent can see is a file it can read, edit or
  // delete, and a check that globs the directory would trip over it — the measurement must not be
  // part of what is measured.
  const reportFile = join(await mkdtemp(join(tmpdir(), "hivey-eval-run-")), "run.jsonl");
  const started = Date.now();
  try {
    const attempt = await sh(
      `node ${JSON.stringify(CLI)} --yes ${JSON.stringify(task.prompt)}`,
      dir,
      task.timeoutMs ?? 180_000,
      { HIVEY_CODE_RUN_REPORT: reportFile },
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
      // What the client reported about the turn: steps, tokens, cost, how it stopped. Empty when it
      // reported nothing, which the report renders as an absence and never as a zero.
      runs: await readRunRecords(reportFile),
      // Only on failure, and only the tail: the interesting part of a failed run is what the check
      // said, and a results file that carries every successful log is unreadable.
      ...(check.code === 0 ? {} : { why: check.out.slice(-2000), agent: attempt.out.slice(-2000) }),
    };
  } finally {
    await rm(dir, { recursive: true, force: true });
    await rm(dirname(reportFile), { recursive: true, force: true });
  }
}

/**
 * What the terminal client wrote about its turns, or nothing.
 *
 * Nothing is an ordinary outcome: a run that died before the first response, an older client, a
 * line cut short by a kill. A malformed line is dropped rather than failing the run — the verdict
 * is the check, not the bookkeeping.
 */
async function readRunRecords(file) {
  let text;
  try {
    text = await readFile(file, "utf8");
  } catch {
    return [];
  }
  const out = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line));
    } catch {
      /* a half-written line is not a measurement */
    }
  }
  return out;
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

  // The table, rebuilt from a run that already happened. A measurement takes hours on a CPU, and
  // relabelling it or regenerating the document must not mean paying for it again.
  const from = flag("from", "");
  if (from) {
    const saved = JSON.parse(await readFile(from, "utf8"));
    const { rowsFromOutcomes } = await import(new URL("../dist/eval-report.mjs", import.meta.url));
    const out = flag("table", "eval/QUALITY.md");
    await writeTable(out, {
      at: saved.at,
      endpoint: saved.endpoint,
      models: saved.models,
      taskCount: tasks.length,
      rows: rowsFromOutcomes(saved.results ?? [], flag("as", "") || undefined),
    });
    console.log(`written: ${out}${saved.complete === false ? "  (from a run that did not finish)" : ""}`);
    process.exit(0);
  }

  if (has("verify-tasks")) {
    process.exit((await verifyTasks(tasks)) ? 0 : 1);
  }

  if (has("verify-solutions")) {
    process.exit((await verifySolutions(tasks)) ? 0 : 1);
  }

  if (!existsSync(CLI)) {
    console.error(`${CLI} is missing — run \`npm run build\` first.`);
    process.exit(2);
  }

  const endpoint = flag("url", process.env["HIVEY_CODE_URL"] ?? "");
  const models = flag("model", process.env["HIVEY_CODE_MODEL"] ?? "").split(",").map((m) => m.trim()).filter(Boolean);
  const reportDir = flag("report", "");
  // The committed comparison table. A path rather than a directory, because this one file is meant
  // to be read in the repository and diffed between runs — see src/core/eval/table.ts.
  const tableFile = flag("table", "");
  // Which configuration these figures belong to — `local only`, `hivey/balanced`. The harness is
  // given a model and cannot know that; only the person running it does, so it is said rather than
  // inferred. Without it the row is labelled by the model, which is honest and less useful.
  const as = flag("as", "");

  if (!endpoint || !models.length) {
    // Not an error, and this is deliberate: the nightly workflow has no model unless somebody
    // configures one, and a scheduled job that goes red every night is a job people mute.
    console.log("No endpoint or model given (--url / --model). Nothing to evaluate.");
    console.log("The task set itself can still be checked with --verify-tasks.");
    // And when a report was asked for, it is still written — saying it was not measured. A missing
    // file is read as "the job did not run"; an empty table of zeros is read as a score. Neither is
    // what happened, and only one of the three can be said out loud.
    if (reportDir) await writeReport(reportDir, { at: new Date().toISOString(), endpoint, models, outcomes: [] });
    // And the table, saying it was not measured, for the same reason: a missing file reads as "the
    // job did not run" and a table of zeros reads as a score. Only the third thing is true.
    if (tableFile) await writeTable(tableFile, { taskCount: tasks.length, rows: [] });
    process.exit(0);
  }

  process.env["HIVEY_CODE_URL"] = endpoint;
  process.env["HIVEY_CODE_PROVIDER"] = process.env["HIVEY_CODE_PROVIDER"] ?? "local";

  const results = [];
  await mkdir(RESULTS_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const file = join(RESULTS_DIR, `${stamp}.json`);

  for (const model of models) {
    process.env["HIVEY_CODE_MODEL"] = model;
    for (const task of tasks) {
      process.stdout.write(`${model} · ${task.id} … `);
      const result = await runTask(task, model, endpoint);
      results.push(result);
      console.log(result.passed ? `pass (${result.seconds}s)` : `FAIL (${result.seconds}s)`);
      // After every task, not at the end. A local model on a CPU takes a minute or two per task, so
      // a full set is hours — and a run that writes only when it finishes is a run that loses
      // everything to one interruption. What is on disk is always what has been measured so far,
      // which is also the only honest thing for a partial run to be.
      await writeFile(file, JSON.stringify({ at: new Date().toISOString(), endpoint, models, results, complete: false }, null, 2) + "\n");
    }
  }

  console.log(`\n${table(results, models)}`);
  await writeFile(file, JSON.stringify({ at: new Date().toISOString(), endpoint, models, results, complete: true }, null, 2) + "\n");
  console.log(`\nwritten: ${file}`);

  if (reportDir) {
    const written = await writeReport(reportDir, {
      at: new Date().toISOString(),
      endpoint,
      models,
      outcomes: results,
    });
    console.log(`written: ${written.join(", ")}`);
  }

  if (tableFile) {
    const { rowsFromOutcomes } = await import(new URL("../dist/eval-report.mjs", import.meta.url));
    await writeTable(tableFile, {
      at: new Date().toISOString(),
      endpoint,
      taskCount: tasks.length,
      models,
      rows: rowsFromOutcomes(results, as || undefined),
    });
    console.log(`written: ${tableFile}`);
  }

  // The exit code reports whether the harness ran, not whether the models are good. A model that
  // fails four tasks is information; it is not a broken build.
  process.exit(0);
}

/**
 * The report, in both forms, from the arithmetic in `src/core/eval/report.js`.
 *
 * The rules about what may and may not be claimed live in `core` and are unit-tested there — a
 * script cannot be unit-tested, and "invent no score" is exactly the rule that needs a test. This
 * function only decides where the two files go.
 *
 * JSON for a machine and Markdown for a person, from one structure, because two generators drift:
 * the published page would say one thing and the artifact another, and nobody would know which was
 * the measurement.
 */
async function writeReport(dir, input) {
  const { buildReport, markdownReport } = await import(new URL("../dist/eval-report.mjs", import.meta.url));
  const report = buildReport(input);
  await mkdir(dir, { recursive: true });
  const jsonFile = join(dir, "report.json");
  const mdFile = join(dir, "report.md");
  await writeFile(jsonFile, JSON.stringify(report, null, 2) + "\n");
  await writeFile(mdFile, markdownReport(report));
  return [jsonFile, mdFile];
}

/**
 * The comparison table, from the same bundle as the report.
 *
 * Written through `core` rather than assembled here for the reason the report is: "publish no figure
 * nobody measured" is a rule, rules need tests, and a script cannot be unit-tested.
 */
async function writeTable(file, input) {
  const { qualityTable } = await import(new URL("../dist/eval-report.mjs", import.meta.url));
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, qualityTable(input));
  return file;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
