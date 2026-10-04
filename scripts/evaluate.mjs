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
/**
 * Run something and collect its output.
 *
 * `command` is either a shell line (a task's `check`, which IS a shell command) or an argv array —
 * and the array form exists because of a defect that quietly corrupted this bench.
 *
 * ⚠️⚠️ THE AGENT'S PROMPT USED TO GO THROUGH A SHELL. It was interpolated with `JSON.stringify`,
 * which produces double quotes, and inside double quotes `sh` still performs command substitution.
 * So every backtick in a task's prompt ran as a command: `` `any` `` was deleted (no such command),
 * and `` `open` `` was REPLACED BY xdg-open's help text — which the model duly complained about.
 * Three tasks of the original fifty-six were affected, and every score this bench has published
 * included them: "No `any` and no `as` casts are to remain" reached the model as "No and no casts
 * are to remain", a sentence with its subject removed.
 *
 * A prompt is repository content reaching `sh -c`; that it was our own content is luck, not design.
 * The argv form takes no shell and interpolates nothing.
 */
function sh(command, cwd, timeoutMs = 120_000, env = {}) {
  return new Promise((resolveRun) => {
    const argv = Array.isArray(command);
    const child = spawn(argv ? command[0] : command, argv ? command.slice(1) : undefined, {
      cwd,
      shell: !argv,
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
      // argv, not a shell line: a prompt is text, and text with a backtick in it is a command when
      // it passes through `sh -c`. See `sh`.
      ["node", CLI, "--yes", task.prompt],
      dir,
      task.timeoutMs ?? 180_000,
      {
        HIVEY_CODE_RUN_REPORT: reportFile,
        // Per child rather than on `process.env`, which is what made the loop below sequential by
        // construction: a global cannot be two values at once.
        HIVEY_CODE_MODEL: model,
        // Its own home, so concurrent tasks do not fight over one spend file — and so a measurement
        // does not read the operator's personal `~/.hiveycode.json`. A benchmark contaminated by
        // whoever happens to be running it is not reproducible, which is the only property that
        // makes it worth having.
        HOME: dir,
        USERPROFILE: dir,
      },
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
    // Several files, comma separated: one row each. Comparing two runs is the whole point of the
    // table, and it could only ever hold one — so a comparison had to be done by eye, which is the
    // thing a versioned table exists to avoid.
    const files = from.split(",").map((f) => f.trim()).filter(Boolean);
    const { rowsFromOutcomes } = await import(new URL("../dist/eval-report.mjs", import.meta.url));
    const override = flag("as", "");
    const rows = [];
    const models = [];
    let at;
    let endpoint;
    let partial = false;
    for (const one of files) {
      const saved = JSON.parse(await readFile(one, "utf8"));
      // Each run's own label, recorded when it ran. `--as` overrides only when there is one file:
      // with several it would name them all the same and the table would collapse into one row.
      const label = files.length === 1 ? override || saved.as : saved.as;
      rows.push(...rowsFromOutcomes(saved.results ?? [], label || undefined));
      models.push(...(saved.models ?? []));
      at = saved.at;
      endpoint = saved.endpoint;
      if (saved.complete === false) partial = true;
    }
    const out = flag("table", "eval/QUALITY.md");
    // `--note` may be repeated: what is known to be wrong with these figures, printed above the
    // table. A measurement with a known defect is published with the defect, not erased and not
    // dressed up as clean.
    const caveats = args.flatMap((a, i) => (a === "--note" && args[i + 1] ? [args[i + 1]] : []));
    await writeTable(out, {
      at,
      endpoint,
      models: [...new Set(models)],
      taskCount: tasks.length,
      rows,
      ...(caveats.length ? { caveats } : {}),
    });
    console.log(`written: ${out}${partial ? "  (one of these runs did not finish)" : ""}`);
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

  // Several at a time.
  //
  // ⚠️ This loop was strictly sequential, and the arithmetic of that is brutal: fifty-six tasks at a
  // minute or two each is an hour and a half of wall clock to answer one question, and the question
  // is usually "did this change help?" — asked twice, once before and once after. Two and a half
  // hours to compare two things is a measurement nobody runs, and a measurement nobody runs is a
  // rule the project only pretends to follow.
  //
  // Nothing about a task needed to be sequential. Each one is a throwaway copy of a fixture, its own
  // child process, its own report file, and now its own HOME — there is no shared state left to
  // race over. What bounds the concurrency is the far end: a provider's rate limit, and a laptop's
  // patience with four `node` processes. Four by default, because it is the number that turns hours
  // into minutes without turning a measurement into a load test.
  // ⚠️ Three, not six, and the reason is not the machine. At six, OpenRouter answered 54 of 62 tasks
  // with "this request would exceed your available credits given your current in-flight requests":
  // it holds credit for every request still in flight, and six concurrent agent turns on a
  // million-token model reserve more than was left. The run recorded 8 passes out of 62 and would
  // have published 13 % as a quality — a number about nothing. Raise it with `--jobs` when the
  // account has room; the refusals are now recorded either way (`isProviderRefusal`), so a
  // credit-limited run reports "refused" instead of a score.
  const jobs = Math.max(1, Number(flag("jobs", "3")) || 3);
  const queue = models.flatMap((model) => tasks.map((task) => ({ model, task })));
  let next = 0;
  let done = 0;
  const save = () =>
    writeFile(
      file,
      JSON.stringify({ at: new Date().toISOString(), endpoint, models, as: as || undefined, results, complete: false }, null, 2) + "\n",
    );

  // How many may be in flight, and why it is not simply `jobs`.
  //
  // ⚠️ A provider holds credit for every request still in flight. On a million-token model that
  // reservation is large, and at six — then at three — OpenRouter answered most of a 62-task run
  // with "this request would exceed your available credits given your current in-flight requests".
  // One request at a time was served immediately. So the limit is not the machine and not the key's
  // balance: it is how much is RESERVED at once, and no fixed number is right for every account on
  // every model.
  //
  // So the harness finds out. A refusal halves the concurrency and the task goes back in the queue;
  // it never drops below one, and a task refused after several tries is recorded as refused rather
  // than pretended to be a failure. It goes as fast as the account allows and no faster, which is
  // the only speed worth having.
  let allowed = jobs;
  let active = 0;
  const attempts = new Map();
  const MAX_ATTEMPTS = 4;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  console.log(`${queue.length} task(s), up to ${jobs} at a time\n`);
  await Promise.all(
    Array.from({ length: Math.min(jobs, queue.length) }, async (_unused, worker) => {
      // ⚠️ Staggered, because starting every worker at once is what triggered the cascade this
      // backoff exists to survive. Four agent turns opened in the same instant reserve four lots of
      // credit before any of them has answered, the provider refuses most of them, and the
      // concurrency only comes down AFTER the damage — so the first thing a run did was waste its
      // first four tasks. One second apart is enough: the first turn is under way, and its
      // reservation is known, before the second asks for one.
      await wait(worker * 1000);
      for (;;) {
        // Hold back when the concurrency has been reduced under us.
        while (active >= allowed) await wait(250);
        const item = queue[next++];
        if (!item) return;
        active += 1;
        let result;
        try {
          result = await runTask(item.task, item.model, endpoint);
        } finally {
          active -= 1;
        }

        const refused = result.runs?.some((r) => String(r.refused ?? "").startsWith("provider:"));
        const tries = (attempts.get(item.task.id) ?? 0) + 1;
        attempts.set(item.task.id, tries);
        if (refused && tries < MAX_ATTEMPTS) {
          const was = allowed;
          allowed = Math.max(1, Math.floor(allowed / 2));
          if (allowed !== was) console.log(`  ↓ ${was} → ${allowed} at a time (the provider is holding credit)`);
          queue.push(item);
          await wait(2000 * tries);
          continue;
        }
        results.push(result);
        // One line per completion rather than "task … " then the verdict: with several in flight the
        // two halves of that pair interleave, and the log becomes a puzzle.
        done += 1;
        console.log(
          `[${String(done).padStart(String(queue.length).length)}/${queue.length}] ${result.passed ? "pass" : "FAIL"} ` +
            `${item.model} · ${item.task.id} (${result.seconds}s)`,
        );
        // After every task, not at the end: a run that writes only when it finishes loses everything
        // to one interruption, and what is on disk is always what has been measured so far.
        await save();
      }
    }),
  );
  // Back into the order the task set declares, so two runs of the same set produce diffable files
  // rather than files that differ by whichever task happened to finish first.
  results.sort((a, b) => a.model.localeCompare(b.model) || a.task.localeCompare(b.task));

  console.log(`\n${table(results, models)}`);
  await writeFile(
    file,
    JSON.stringify({ at: new Date().toISOString(), endpoint, models, as: as || undefined, results, complete: true }, null, 2) + "\n",
  );
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
