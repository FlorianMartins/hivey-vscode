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
```

`task.json`:

| field | meaning |
| --- | --- |
| `title` | one line, for the report |
| `kind` | `bug`, `test`, `feature`, `refactor`, `ibmi` — how the score is broken down |
| `prompt` | exactly what the user would type |
| `check` | a shell command run in the working copy. Exit 0 means the task is done |
| `timeoutMs` | optional, default 180000 |

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

Not every task can be decided by running something. There is no IBM i partition here, no JDK and no
TypeScript compiler, so those tasks are checked by SHAPE — "no `any` remains", "no `finally` block",
"the library is qualified". A shape check is a grep, and a grep reads the comments too. So a correct
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
```

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
few of them, and they are chosen to look like this project's users' work (including IBM i, which no
public benchmark covers). It is a regression net and a way to choose between two local models
honestly.
