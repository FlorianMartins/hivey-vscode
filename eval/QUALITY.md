# Measured quality

What each configuration scores on this repository's own evaluation set
(56 tasks). Regenerate with `node scripts/evaluate.mjs --table eval/QUALITY.md`.

Taken 2026-10-03T03:06:06.925Z against `http://127.0.0.1:11434/v1` with `qwen2.5-coder:7b`.

| configuration | passed | quality | never acted | time | cost |
| --- | --- | --- | --- | --- | --- |
| `local only` | 0/56 | 0 % | 51/56 | 2005 s | not priced |
| `local + escalation` | — | not measured | — | — | — |
| `hivey/free` | — | not measured | — | — | — |
| `hivey/balanced` | — | not measured | — | — | — |
| `hivey/pro` | — | not measured | — | — | — |

### How to read it

**never acted** is how many of those tasks the model finished without taking a single tool
step. It is here because a score on its own does not say whether a model was wrong or whether
it never tried, and those are different problems: one is answered by a better model, the other
by the client and the prompt. A configuration with a low score and a high *never acted* has not
been measured on its reasoning at all.

**not priced** is not free. A local endpoint bills nothing and costs electricity and time; the
time is in the table and the price is absent rather than written as $0.00.

To reproduce it, or to measure a configuration that reads *not measured*:

```bash
npm run build
node scripts/evaluate.mjs \
  --url http://127.0.0.1:11434/v1 --model qwen2.5-coder:7b \
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
