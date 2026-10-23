# The evaluation set

What this answers: **does a given model, on a given preset, actually finish the job?** The rest of
the test suite proves the extension works. Nothing in it proves an ANSWER is any good, and "more
reliable than the alternatives" is a claim that needs a number behind it or it is marketing.

## The shape of a task

```
eval/tasks/<id>/
  task.json     what to ask, and how to tell whether it worked
  files/        a tiny repository, broken on purpose
  solution/     one way to do it, laid over files/ — proves the check CAN pass
  hidden/       optional: the tests that decide the task, copied in by the check (see below)
```

`task.json`:

| field | meaning |
| --- | --- |
| `title` | one line, for the report |
| `kind` | `bug`, `test`, `feature`, `refactor`, `noverify` — how the score is broken down |
| `prompt` | exactly what the user would type |
| `check` | a shell command run in the working copy. Exit 0 means the task is done |
| `timeoutMs` | optional, default 180000 |

There are 60 tasks: 36 `bug`, 7 `feature`, 7 `refactor`, 6 `noverify`, 4 `test`, over TypeScript,
JavaScript, Python, Java, SQL and the `finance` family (`fin-*`). The 22 IBM i tasks that brought
the set to 62 were removed with the IBM i support; figures measured on 56 or 62 tasks are not
comparable with a run on this set, and neither are figures measured on the 40-task set that came
before the harder twenty below.

### The harder twenty

The first forty saturated: the self-hosted 27B model solved 39 of them, and a bench everybody passes
cannot show progress. Twenty tasks were added that look like a normal working day and that a
mid-sized model gets wrong part of the time. Each is hard for a stated reason:

| family | tasks | what makes it hard |
| --- | --- | --- |
| the cause is in another file | `js-memo-key-collision`, `js-listener-leak`, `java-booking-overlap`, `py-shared-defaults` | the symptom shows in one file, the defect lives in a helper; the local patch passes the reported case and fails the others |
| the obvious fix is wrong | `js-natural-sort`, `py-search-like`, `py-month-end-renewal`, `java-remove-while-iterating`, `js-flaky-sync` | `localeCompare` without numeric order, parameters without escaping LIKE, a clamp that drifts after February, an index loop that skips, a longer sleep |
| a contract to honour exactly | `js-pager-overflow`, `js-map-limit` | the documented rules are checked exhaustively (every page of every list up to 40 pages, every concurrency edge) |
| refactor that keeps behaviour | `py-pricing-refactor`, `py-n-plus-one`, `js-config-rename` | thousands of inputs compared with the original implementation, a counted-queries test, a deprecated key that must keep working |
| feature across layers | `ts-user-phone-field`, `ts-cursor-pagination`, `ts-typed-events` | model + validation + serializer + test; API + client with inserts during paging and timestamp ties; types that must reject what is wrong (`@ts-expect-error`) and the call sites they expose |
| build and config | `ts-paths-runtime` | a green `tsc` with a `paths` alias that Node cannot resolve at run time |
| long, several sub-steps | `js-todo-cli-long` | stable ids, a validated option, a filter with an injectable clock, an old store format, and the tests for all of it |
| tests that catch bugs | `js-mutation-tests` | the suite the model writes must fail on each of fifteen mutants of the implementation |

**Their tests are hidden.** A check that runs the fixture's own test file can be satisfied by
editing the test, so these twenty keep the tests that decide them in `eval/tasks/<id>/hidden/`,
beside `files/` and `solution/`, never copied into the working copy the model sees. The check
starts with `"$HIVEY_EVAL_HIDDEN" <id>` (`eval/check/hidden`), which copies them in over whatever is there: a
visible test the model edited is restored, and the cases the prompt implies without spelling out
are added. They are run by name, so a test file the model adds cannot replace them; where the
prompt asks for tests, the model's own run as well, beside the hidden ones, and must pass too. The
TypeScript checks also restore `tsconfig.json`, so strictness cannot be traded for a green build.

**And the agent cannot reach them.** `eval/bin` is on the agent's PATH as well as the check's, so
the helper is NOT there: it lives in `eval/check/`, on nobody's PATH, and its absolute path is in
`HIVEY_EVAL_HIDDEN`, which `scripts/eval-env.mjs` puts in the environment of the check process and
strips from the agent's (even when the operator exported it). The harness also refuses a working
copy that contains a `hidden/` folder or a `*.hidden.*` file before anything runs.
`tests/evalEnv.test.ts` holds all of it: nothing on the agent's PATH knows about `hidden/`, no
variable of the agent's environment leads to the helper, only the three check call sites receive
it, and no fixture or solution carries hidden tests.

The check is a command rather than a diff, on purpose. A diff scores the model on writing the
solution somebody already wrote; a command scores it on the only thing the user cares about, which
is whether the code now works. Two models solving a task differently both pass.

## The rule that makes the numbers mean anything

**A task's check must FAIL on the untouched fixture.** A task that passes before the model touches
it scores every model 100 % and measures nothing — and it is the easiest mistake in the world to
make, because a fixture is usually written by starting from working code. So it is not left to
discipline:

```bash
node scripts/evaluate.mjs --verify-tasks
```

runs every check against every untouched fixture and fails if any of them passes. It needs no model
and no GPU, so it runs on every commit in CI.

## And the rule that makes a BAD number mean anything

The opposite mistake is worse, because it is invisible: a check that can **never** pass. A typo in a
grep, a compiler the machine does not have, a condition the prompt never asks for — the task scores
every model 0 % and looks exactly like a hard task, so it becomes evidence against the models
instead of against itself.

So every task ships a `solution/`, laid over `files/`, and:

```bash
node scripts/evaluate.mjs --verify-solutions
```

requires the check to go GREEN on it. The solution is *one* way to do the task, never the way: the
model is still scored by the command, and two models that solve it differently both pass. It exists
only to prove the command is satisfiable. This also runs with no model, so it is a CI gate too.

It earned its place immediately. It caught four checks that no answer could have satisfied,
including one that had been in the repository for weeks — and the cause was the same every time,
which is worth stating as a rule of its own.

### A structural check must look at the code, not at the prose

Not every task can be decided by running something. The first Java and TypeScript tasks were
written when no JDK and no TypeScript compiler were assumed, so they are checked by SHAPE — "no
`any` remains", "no `finally` block". (The harder twenty compile and run instead: the Java ones
with the runner's `javac`, the TypeScript ones with `eval/bin/tsc`, which is the repository's own
compiler from `node_modules` — so `npm ci` must have run, as it has everywhere the checks run.) A
shape check is a grep, and a grep reads the comments too. So a correct
answer that EXPLAINS itself — "replaced the `finally` block with try-with-resources" — was refused
for quoting the very thing it had removed. The first victim was the reference solution.

Hence `eval/bin/codeonly`: it prints a file with its comments stripped, and the structural checks
read it instead of the file. It is on PATH for every check, and it lives in the repository rather
than in the fixture, because a helper inside the working copy is a file the agent can edit — and a
check the agent can edit is not a check.

Checks of this kind are weaker than running the code, and the honest word for them is *structural*:
they establish that the asked-for change was made, not that the program works. Every task that can
be decided by running something is, and the kinds are split in the report so nobody has to guess
which is which.

## Running it

```bash
npm run build
node scripts/evaluate.mjs --model qwen2.5-coder:7b --url http://127.0.0.1:11434/v1
node scripts/evaluate.mjs --model qwen2.5-coder:7b --only bug          # one kind
node scripts/evaluate.mjs --model a,b,c                                # a comparison
node scripts/evaluate.mjs --model a --report out/                      # JSON + Markdown
node scripts/evaluate.mjs --model a --jobs 6 --timeout 600             # 6 at a time, 600 s per task
node scripts/evaluate.mjs --model a --as "local only" --table eval/QUALITY.md   # a row of the table
node scripts/evaluate.mjs --from eval/results/<run>.json --table eval/QUALITY.md   # rebuild, no model
```

`--only` takes a kind or a task id. `--jobs` defaults to 3. `--timeout` (seconds, default 180)
overrides every task's own `timeoutMs` when it is given. `--note "…"`, repeatable, prints a caveat
above the table.

A check runs in its own process group (outside Windows). At its deadline the whole group is killed, and once its own
process has exited, whatever it left running is killed two seconds later: a test the agent left with
a pending promise kept the pipes open and once held a whole run for 2 h 40.

## The report

`--report <dir>` writes `report.json` and `report.md`: per task and per model, whether it passed,
how long it took, how many steps it needed, the tokens in and out, the cost, and how it stopped —
out of steps, cut off mid-sentence, or finished. Pass or fail is the least interesting half: a model
that solves nine tasks in forty seconds each and one that solves nine in nine minutes and twelve
steps are not the same product, and the second is not shippable to somebody paying per token.

Both files come from one structure, so the published page and the artifact cannot disagree about
what was measured.

**It may not invent a number.** A sum over nothing is 0 and an average over nothing is NaN, and both
render as a figure somebody will quote, so:

- a cost appears only for a model whose price is known. A local model is **unpriced**, never free,
  and a total that could not price every run says `(+N unpriced)` — it is a floor, not a figure;
- a run with no model reachable produces a report that says **not measured**, with no table at all,
  rather than a tidy page of zeros;
- anything that was not measured is blank, never 0.

Those rules are arithmetic and wording, so they live in `src/core/eval/report.ts` with the rest of
the core and are unit-tested there. A script cannot be unit-tested, and "invent no score" is exactly
the rule that needs a test.

The figures come from the turn itself, not from a guess: with `HIVEY_CODE_RUN_REPORT=<file>` set,
the terminal client appends one line of JSON per turn — steps, tokens, cost, which tools it called,
how it stopped. The harness sets it to a file **outside** the working copy, because a file the agent
can see is a file it can edit, and the measurement must not be part of what is measured.

Results land in `eval/results/<timestamp>.json` and a table is printed. Each run records the model,
the task, pass/fail, the wall clock and what the check printed when it failed — which is the part
worth reading, because it is where the model's actual failure mode is.

## What it is not

It is not a benchmark anyone should quote against another product: the tasks are small, there are
few of them, and they are chosen to look like this project's users' work. It is a regression net and a way to choose between two local models
honestly.

## Measuring a setting

Three environment variables let a run use another thinking level, temperature or context window,
without changing anything for anyone else (unset, the client behaves exactly as usual). The harness
passes its own environment on to the client it starts, so they are set on the `evaluate.mjs` command:

- `HIVEY_CODE_REASONING` — `none`, `low`, `medium` (the default on a self-hosted server) or `high`.
  On a self-hosted llama.cpp server `low` and `medium` also carry a thinking budget per step
  (1 024 and 8 192 tokens), and `high` none;
- `HIVEY_CODE_TEMPERATURE` — a number between 0 and 2 (unset: the server's own);
- `HIVEY_CODE_CONTEXT` — the model's context window, in tokens (4096 or more), for a "full context"
  run. The terminal client otherwise does not hand the turn a window, so nothing in it ever fills;
  with it, the turn shortens old tool outputs and summarizes itself mid-task exactly as the panel does,
  and that is what such a run measures.

Run the same tasks with and without, in parallel so both see the same server load, and compare.
