# Measured quality

What each configuration scores on this repository's own evaluation set
(56 tasks). Regenerate with `node scripts/evaluate.mjs --table eval/QUALITY.md`.

## Nothing here has been measured

**No figure below has been taken.** No model was reachable from the machine this was last
generated on, so every cell would have been invented — and a table of invented numbers is the
one artefact of this project that would be worth less than nothing, because it is the one
somebody quotes.

What does exist is the thing that makes a score mean anything: every task's check is proven to
**fail on its untouched fixture** and to **pass on its reference solution**, on every commit.
A task set that is honest in both directions is the hard half. What is missing is a machine
with a model on it.

```bash
npm run build
node scripts/evaluate.mjs \
  --url http://127.0.0.1:11434/v1 --model qwen2.5-coder:7b \
  --table eval/QUALITY.md
```

## The configurations it will compare

| configuration | how |
| --- | --- |
| `local only` | the model on your own machine, never escalated |
| `local + escalation` | the same model, with a remote one bought only by a proven failure |
| `hivey/free` | the free-tier preset |
| `hivey/balanced` | the everyday preset |
| `hivey/pro` | the preset that spends in order to be right |

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
