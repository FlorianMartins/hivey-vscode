# 12. Measured quality

[← Previous chapter](11-ibm-i.md) · [Contents](README.md) · [Next chapter →](13-install-and-use.md)

## The problem: everybody says they are the best

Every coding assistant announces that it is excellent. None of those announcements is checkable,
because none of them says what it was measured on. "More reliable than the alternatives" is a sentence
that needs a number behind it, or it is advertising.

This chapter explains how that number is made, and why the hard part is not measuring but making sure
the measurement means something.

## What an evaluation bench is

An **evaluation bench** (*benchmark*) is a set of tasks with an automatically checkable answer. This
project's holds **62 tasks**: small broken repositories, an instruction, and a **check** — a command
that succeeds if the work is done and fails otherwise.

For example: a small program that counts lines, the instruction "add a `--json` option", and a check
that runs the program with the option and verifies the output really is JSON with the right numbers.

The advantage over a human impression: it is **reproducible**, and nobody has an opinion about a
command's exit code.

## The hard part: a bench that is honest in both directions

A bench can lie in two opposite ways, and you have to protect against both. This project checks it **on
every commit**, with two distinct gates:

**1. Every check must fail on the untouched task.** If the check passes *before* the model has touched
anything, the task gives everybody 100% and measures nothing. It happens more than you would think: a
task meant to be broken was not, because `round()` in Python is exact on a decimal type; another
because SQLite has a special case for `MAX()`.

**2. Every check must pass on the reference solution.** The symmetrical defect: a task that can **never**
pass — a typo in the check, a compiler missing from the machine, a condition the instruction never
asked for. That one gives everybody zero and becomes evidence against the models rather than against
itself.

Only the **two** gates together catch these cases. That is half the work, and it is the half that gives
the score its meaning.

An amusing and instructive detail: some checks verify the **structure** of the code ("did it use a guard
clause?"). But a file that **explains itself** contains the very words you are trying to forbid, inside
its own comment. Four tasks rejected correct solutions that way, because the comment said what the code
was not supposed to do. There is now a small tool that strips comments before the structural checks.

## What the measurement found

The table lives in
[`eval/QUALITY.md`](https://github.com/FlorianMartins/hivey-vscode/blob/main/eval/QUALITY.md) — the
figures are there, current, rather than copied here where they would age.

But the **shape** of the result is worth telling, because it is counter-intuitive.

**The local model scored 0 out of 56.** And the figure that explains that zero is not the zero: it is
that in **51 cases out of 56, the model took no action at all**. It wrote the change in a code block and
asked "would you like me to proceed?". In the five cases where it did act, it **never** called an editing
tool.

That is why the table has a **"never acted"** column. A score alone does not say whether a model got it
wrong or never tried, and those are two different problems: the first is solved with a better model, the
second with the client and the prompt.

And a **"claimed done"** column, which is perhaps the most useful figure of all: how many of those
failures the model presented as a success. It finished cleanly, and the check failed anyway. That figure
is what decides whether you can let the tool work unattended: a model that fails loudly costs you a
turn, a model that fails **while announcing success** costs the trust that makes the tool usable.

And two figures that give the scale, measured on the full set: **the free preset passes half the tasks,
for nothing** — it does not say that free is enough, it says where free stops. And a cheap paid model
passes nearly three-quarters for **four cents across 62 tasks**.

**The same bench, on a modern remote model, reversed the result**: the large majority of tasks passed, no
task without an action, for about a dollar and some twenty minutes. The contrast is not a detail: it says
that a small local model, today, is not enough for agent work — and that is precisely the case the
escalation mechanism ([chapter 10](10-the-cost.md)) exists for.

## And the measurement found a defect before it found a number

This is the project's most instructive episode, and it justifies the bench's existence on its own.

The first attempt at measuring gave zero **for a reason that was not the model**. The model was producing
a perfectly correct tool call, and writing it **in the body of its reply** instead of the box the protocol
provides, because the program serving it did not fill that box in
([chapter 4](04-how-we-talk-to-it.md)). So the client displayed the JSON as an answer and changed nothing.

In other words: **agent mode did not work at all in the product's default configuration**, and no test of
the extension's behaviour could have seen it. It took trying for real, on a real model, to find out.

## A refusal is not a failure

An episode worth telling, because it shows how fragile a measurement is.

During one measurement, the first eleven tasks passed, then **the next forty-two failed without producing
a single turn**. Neither the model nor the tasks were at fault: the **daily spend cap** had been reached,
and every subsequent task was refused *before starting*.

In the record, those forty-two refusals were **indistinguishable from forty-two model errors**. A success
rate computed on that would have been published as a measurement.

So: a refusal is now **recorded as a refusal**, and a set containing even one **states no rate** — the
column shows "3 refused — no rate" instead of a percentage. Absent rather than wrong. It is the same rule
as everywhere else here, and it is what makes the table trustworthy: it prefers to say nothing over
saying something uncheckable.

## The same measurement, twice, does not give the same number

This is the most unpleasant thing to admit about a bench, and it is measured here: **three runs of the
same configuration, on the same tasks, with the same program, gave 48, 47 and 50 passes.** Nothing had
changed between them.

The reason is in [chapter 2](02-the-model.md): a language model does not produce the same answer twice.
Across 62 tasks, two or three tip one way or the other.

The consequence is severe and applies to every figure you will read elsewhere: **a difference smaller
than that spread is not a result.** When a tool announces "3% better", the question to ask is not "3% of
what" but "how many times did you measure it". This project's table publishes its own spread as soon as
it is given several runs — and it **reports** it rather than averaging it away, because an average hides
precisely what the reader needs.

## The rules this project imposes on itself about numbers

They are unusual and worth knowing, because they are the reason to trust the table:

- **A figure never measured shows as "not measured", never "0%".** They are not the same thing and only
  one of the two is a result.
- **An unknown price shows as "not priced", never "$0.00".** A local model is not free: it is unbilled.
- **No column for GitHub Copilot nor for IBM Bob.** Not out of modesty — that is the comparison the
  product exists to win — but because nobody has run them **on these tasks, on this machine, on the same
  day**. A column filled in from a figure published elsewhere compares two different measurements, and
  would not survive the first question at the meeting where it was quoted. The file writes instead **what
  it would take** to add one honestly.

## And this course, in all that

This course is itself held by a check. The index declares the version of the project it is current for,
and a check **refuses the build** when that version is no longer the project's:

```bash
npm run check:course
```

It is the only way a document like this does not rot. A document somebody *promises* to maintain is not
maintained; a document whose staleness breaks the build is. The same check holds the two editions,
French and English, to the same chapters and the same version — because a translation is the single most
reliable thing in a repository to fall behind. And the same reasoning applies to the figures quoted in the
READMEs, verified by `npm run check:numbers` — because a number written in a sentence has no reason to
follow the thing it describes.

⚠️ That check found two of its own in this very course: the index said twenty-six decision records when
there were 37, and this chapter's neighbour said "forty" IBM i skills when there were 41. Both were
invisible to the guard for the same reason, and it is worth remembering: **a number written in words
cannot be checked.** They are digits now.

[← Previous chapter](11-ibm-i.md) · [Contents](README.md) · [Next chapter →](13-install-and-use.md)
