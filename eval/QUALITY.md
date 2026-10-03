# Measured quality

What each configuration scores on this repository's own evaluation set
(62 tasks). Regenerate with `node scripts/evaluate.mjs --table eval/QUALITY.md`.

> **Read these figures with the following in mind.**
>
> - Mesuré sur 56 tâches, avant que le banc n'en compte 62 : les six tâches de la famille « sans vérification » n'y sont pas.
> - ⚠️ Trois des 56 consignes étaient corrompues au moment de ces séries : les accents graves étaient exécutés par un shell, donc « No `any` and no `as` casts » arrivait au modèle sans son sujet. Corrigé le 2026-10-03 ; ces trois tâches étaient donc plus dures qu'elles ne devraient l'être.
> - La série de remplacement est bloquée : OpenRouter refuse les requêtes de cette taille faute de marge sous la limite mensuelle de la clé.

Taken 2026-10-03T13:44:56.036Z against `https://openrouter.ai/api/v1` with `deepseek/deepseek-v4.1-flash`, `hivey`.

| configuration | passed | quality | never acted | claimed done | model time | cost |
| --- | --- | --- | --- | --- | --- | --- |
| `local only` | — | not measured | — | — | — | — |
| `local + escalation` | — | not measured | — | — | — | — |
| `remote only` | — | not measured | — | — | — | — |
| `hivey/free` | — | not measured | — | — | — | — |
| `hivey` | 50/56 | 89 % | 1/56 | 5/56 | 3918 s | $4.2916 ($0.0766/task) |
| `hivey/smart` | — | not measured | — | — | — | — |
| `deepseek-v4.1-flash alone` | 44/56 | 79 % | 1/56 | 11/56 | 2296 s | $0.1357 ($0.0024/task) |

### What the same configuration scored twice

Run to run, on the same tasks and the same build:

- `hivey`: 47/56, 50/56 — a spread of 3 task(s) with nothing changed between runs.

**So a difference smaller than that spread is not a result.** A single run of a configuration
cannot establish a gap of a few tasks, and a table showing one run per row invites exactly that
mistake — the reader sees two percentages and concludes something the data does not support.
Reported rather than averaged: an average hides the spread, and the spread is what tells you what
the percentage is worth.

### How to read it

**never acted** is how many of those tasks the model finished without taking a single tool
step. It is here because a score on its own does not say whether a model was wrong or whether
it never tried, and those are different problems: one is answered by a better model, the other
by the client and the prompt. A configuration with a low score and a high *never acted* has not
been measured on its reasoning at all.

**claimed done** is how many of those failures the agent reported as a success — it exited
cleanly and the check failed anyway. It is the number that decides whether a tool can be left
alone: a model that fails loudly costs you a turn, one that fails while claiming success costs
the trust that makes it usable.

**model time** is the sum of the task durations, **not** how long the run took. The harness runs
several tasks at once, so the wall clock is a fraction of this — about a sixth at the default
concurrency. The column was called *time* and read as a duration, which is why it now says what
it is: a figure whose name invites the wrong reading is a figure that will be misread.

**not priced** is not free. A local endpoint bills nothing and costs electricity and time; the
time is in the table and the price is absent rather than written as $0.00.

To reproduce it, or to measure a configuration that reads *not measured*:

```bash
npm run build
node scripts/evaluate.mjs \
  --url https://openrouter.ai/api/v1 --model deepseek/deepseek-v4.1-flash \
  --as "local only" --table eval/QUALITY.md
```

`--as` names the configuration, because the harness is given a model and only the person
running it knows which setup that model was standing in for. `--from <results.json>` rebuilds
this document from a run that already happened, which matters when a run takes half an hour.

## What this table deliberately leaves out

**No column for GitHub Copilot and none for IBM Bob.** Not because the comparison is unwelcome —
it is the comparison this product exists to win — but because nobody here has run them on these
tasks. A column filled in from a published figure compares two different measurements, on
different task sets, on different machines, on different days.

What it would take to add one honestly: the same tasks, through that product, on this machine, on
the same day, with the same checks deciding pass and fail. That is a day's work and it is worth
doing. Until somebody does it, the column is absent rather than estimated.

**And no figure that was not measured.** A configuration nobody ran reads `not measured`, never
`0 %`.
