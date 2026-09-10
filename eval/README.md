# The evaluation set

What this answers: **does a given model, on a given preset, actually finish the job?** The rest of
the test suite proves the extension works. Nothing in it proves an ANSWER is any good, and "more
reliable than the alternatives" is a claim that needs a number behind it or it is marketing.

## The shape of a task

```
eval/tasks/<id>/
  task.json     what to ask, and how to tell whether it worked
  files/        a tiny repository, broken on purpose
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

## Running it

```bash
npm run build
node scripts/evaluate.mjs --model qwen2.5-coder:7b --url http://127.0.0.1:11434/v1
node scripts/evaluate.mjs --model qwen2.5-coder:7b --only bug          # one kind
node scripts/evaluate.mjs --model a,b,c                                # a comparison
```

Results land in `eval/results/<timestamp>.json` and a table is printed. Each run records the model,
the task, pass/fail, the wall clock and what the check printed when it failed — which is the part
worth reading, because it is where the model's actual failure mode is.

## What it is not

It is not a benchmark anyone should quote against another product: the tasks are small, there are
few of them, and they are chosen to look like this project's users' work (including IBM i, which no
public benchmark covers). It is a regression net and a way to choose between two local models
honestly.
