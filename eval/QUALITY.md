# Measured quality

What each configuration scores on this repository's own evaluation set
(62 tasks). Regenerate with `node scripts/evaluate.mjs --table eval/QUALITY.md`.

> **Read these figures with the following in mind.**
>
> - Les trois premières lignes (`hivey/free`, `remote only`, `hivey`) sont mesurées sur les **62** mêmes tâches, avec les consignes corrigées et **sans aucun refus**. Ce sont les seules comparables entre elles.
> - ⚠️ La ligne `hivey` a d'abord donné **2/62** — non pas pour une faute du modèle, mais parce que le solde du compte OpenRouter était épuisé (−0,11 $) et que chaque tâche était refusée avant de commencer. Crédit rétabli, la même série donne 55/62. Un refus n'est pas un échec : voir `core/eval/report.ts`.
> - ⚠️ La dernière ligne (`deepseek-v4.1-flash alone`) a été mesurée sur **56** tâches, avant que trois consignes ne soient réparées, et n'est donc PAS comparable aux trois autres. Elle reste pour la décision qu'elle a servi à prendre (ADR-0034).
> - Écart constaté entre séries identiques : **48, 47 et 50** réussites sur 56. Une différence plus petite que cet écart n'est pas un résultat.

Taken 2026-10-03T13:14:46.752Z against `https://openrouter.ai/api/v1` with `hivey/free`, `qwen/qwen3.7-flash`, `hivey`, `deepseek/deepseek-v4.1-flash`.

| configuration | passed | quality | never acted | claimed done | model time | cost |
| --- | --- | --- | --- | --- | --- | --- |
| `local only` | — | not measured | — | — | — | — |
| `local + escalation` | — | not measured | — | — | — | — |
| `remote only` | 45/62 | 73 % | 0/62 | 17/62 | 1780 s | $0.0428 ($0.0007/task) |
| `hivey/free` | 32/62 | 52 % | 3/62 | 27/62 | 2997 s | $0.0000 ($0.0000/task) |
| `hivey` | 55/62 | 89 % | 2/62 | 6/62 | 4326 s | $4.5941 ($0.0741/task) |
| `hivey/smart` | — | not measured | — | — | — | — |
| `deepseek-v4.1-flash alone` | 44/56 | 79 % | 1/56 | 11/56 | 2296 s | $0.1357 ($0.0024/task) |

### A re-measurement was attempted on 2026-10-06 and withdrawn

Recorded rather than left out, because an attempt that produced no number is itself a result — and
because the next person to try will otherwise repeat it.

The `hivey/free` preset was re-run on the full 62 tasks after the skill families were fixed. It came
back **27 passed and 30 tasks killed by the harness's 180-second clock** — 48 % of the set. The same
preset scored 32/62 two days earlier with 3 timeouts.

The obvious suspect was the skills change itself: an IBM i prompt now carries about forty more skill
names, which costs tokens on every turn. Splitting the set says otherwise:

| | IBM i tasks killed | other tasks killed |
|---|---|---|
| 2026-10-04 | 9 % | 2 % |
| 2026-10-06 | 53 % | **55 %** |

Only the IBM i tasks gain those forty skills, and the two groups moved together. **A cause that does
not follow the shape of the change is not that change** — the free endpoint had simply become much
slower. A set in that state measures the provider's throughput on the day and would publish it as the
model's quality.

So no figure from that run is published, and the 2026-10-04 line above stands. The bench now refuses
to state a rate once timeouts pass its own measured noise (three tasks, ADR-0034), the per-task clock
is adjustable (`--timeout`), and the clock is recorded in every results file — because a published row
never used to say under which one it was obtained.

### ⚠️ Every line above was measured with the skill families switched off

Not a caveat about precision — a condition that was never intended and was found on 2026-10-06, after
these figures were published. The terminal, which the harness drives, offered `general` skills alone
and nothing else: `cfg.skillGroups ?? ["general"]`, with no caller anywhere that sets `skillGroups`.

**Twenty-two of these sixty-two tasks are IBM i tasks.** The RPG, DDS, CL and Db2 for i skill
families — written for those tasks, every skill backed by one of them — were switched off while the
bench ran. So were `frontend`, `javascript`, `python` and the rest on the tasks that would have used
them.

What that means for the numbers above, stated exactly:

- They are **real measurements of a real configuration**, and that configuration is the one a user got
  by default on the terminal. Nothing here is invalidated as a record of what happened.
- They are **not** a measurement of what this product offers now. The terminal detects its families
  from the files in the tree as of this version, and the panel from the files the editor has open.
- Whether that **raises** these scores is **not measured**, and no figure here will be adjusted to
  guess at it. A skills list is not free: it costs prefix tokens on every turn, and a model given
  forty extra names can also be distracted by them. The direction is plausible; it is not a result.

The next run replaces these lines rather than being compared with them, and the configuration column
will say which side of this change it was measured on.

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
  --url https://openrouter.ai/api/v1 --model hivey/free \
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
