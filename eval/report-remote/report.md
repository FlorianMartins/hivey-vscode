# Evaluation report

Run at 2026-10-03T09:18:24.296Z.

Endpoint: `https://openrouter.ai/api/v1`. Models: `x-ai/grok-4.7`.

## Summary

| model | passed | rate | time | steps | tokens in | tokens out | cost | out of steps | truncated | escalations |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `x-ai/grok-4.7` | 52/56 | 93 % | 1485.1 s | 221 | 606229 | 83919 | $1.0684 | 0 | 0 | 0 |

## `x-ai/grok-4.7`

| kind | passed | rate | time | steps | cost |
| --- | --- | --- | --- | --- | --- |
| bug | 24/24 | 100 % | 216.9 s | 113 | $0.3341 |
| feature | 2/3 | 67 % | 26.4 s | 12 | $0.0374 |
| ibmi | 19/21 | 90 % | 923.2 s | 72 | $0.5778 |
| refactor | 3/4 | 75 % | 224.9 s | 12 | $0.0445 |
| test | 4/4 | 100 % | 93.7 s | 12 | $0.0746 |

| task | result | time | steps | tokens | cost |
| --- | --- | --- | --- | --- | --- |
| `feature-cli-flag` | pass | 9.6 s | 6 | 12963+535 | $0.0126 |
| `feature-validate` | pass | 10.8 s | 4 | 11374+440 | $0.0185 |
| `fin-amortisation` | pass | 7.0 s | 4 | 11841+299 | $0.0113 |
| `fin-fix-message` | pass | 7.8 s | 4 | 13170+529 | $0.0207 |
| `fin-iban` | pass | 10.6 s | 5 | 15572+567 | $0.0213 |
| `fin-identifiers` | pass | 15.9 s | 7 | 26360+1100 | $0.0303 |
| `fin-market-hours` | pass | 8.5 s | 5 | 13042+455 | $0.0154 |
| `fin-minor-units` | pass | 10.0 s | 4 | 12386+372 | $0.0182 |
| `fin-settlement` | pass | 9.1 s | 4 | 12725+485 | $0.0134 |
| `ibmi-cl-monmsg` | pass | 9.8 s | 2 | 7480+496 | $0.0110 |
| `ibmi-cl-qualify` | pass | 22.4 s | 2 | 7580+1559 | $0.0176 |
| `ibmi-cl-sbmjob` | **FAIL** | 87.2 s | 2 | 7595+7360 | $0.0526 |
| `ibmi-db2-catalog` | pass | 27.2 s | 1 | 4793+2064 | $0.0170 |
| `ibmi-db2-commit` | **FAIL** | 21.8 s | 4 | 10068+1473 | $0.0188 |
| `ibmi-db2-ddl` | pass | 9.2 s | 2 | 8102+463 | $0.0098 |
| `ibmi-dds-field` | pass | 18.9 s | 3 | 10969+1587 | $0.0184 |
| `ibmi-dds-logical` | pass | 33.9 s | 2 | 7327+2659 | $0.0220 |
| `ibmi-dds-printer` | pass | 87.6 s | 3 | 11334+6187 | $0.0513 |
| `ibmi-rpg-copy-proto` | pass | 33.4 s | 5 | 10427+2164 | $0.0254 |
| `ibmi-rpg-doc` | pass | 24.9 s | 6 | 14285+1126 | $0.0228 |
| `ibmi-rpg-fixed-lr` | pass | 51.6 s | 2 | 7507+3300 | $0.0277 |
| `ibmi-rpg-freeform` | pass | 92.5 s | 4 | 14077+6124 | $0.0497 |
| `ibmi-rpg-indicators` | pass | 21.4 s | 4 | 10451+1218 | $0.0198 |
| `ibmi-rpg-monitor` | pass | 8.2 s | 4 | 9859+294 | $0.0098 |
| `ibmi-rpg-move` | pass | 273.4 s | 5 | 12927+17714 | $0.1199 |
| `ibmi-rpg-packed` | pass | 44.0 s | 4 | 10241+2799 | $0.0271 |
| `ibmi-rpg-procedure` | pass | 22.8 s | 4 | 10885+1574 | $0.0184 |
| `ibmi-rpg-sql-cursor` | pass | 10.5 s | 3 | 10635+678 | $0.0125 |
| `ibmi-rpg-srvpgm` | pass | 13.6 s | 6 | 10445+782 | $0.0152 |
| `ibmi-rpg-unittest` | pass | 61.3 s | 2 | 7796+5719 | $0.0395 |
| `ibmi-sql-db2` | pass | 8.9 s | 4 | 9681+350 | $0.0111 |
| `java-equals-hashcode` | pass | 5.6 s | 3 | 7509+267 | $0.0080 |
| `java-junit` | pass | 10.0 s | 2 | 8002+605 | $0.0091 |
| `java-optional` | pass | 17.7 s | 6 | 8128+1272 | $0.0151 |
| `java-try-with-resources` | pass | 11.1 s | 2 | 7552+718 | $0.0112 |
| `js-async-race` | pass | 8.6 s | 4 | 10898+340 | $0.0091 |
| `js-money-rounding` | pass | 7.5 s | 4 | 11402+266 | $0.0133 |
| `js-null-crash` | pass | 5.6 s | 4 | 10482+250 | $0.0096 |
| `js-off-by-one` | pass | 8.0 s | 5 | 10576+215 | $0.0107 |
| `py-aware-datetime` | pass | 8.9 s | 6 | 15183+445 | $0.0169 |
| `py-date-parse` | pass | 7.5 s | 5 | 13275+216 | $0.0136 |
| `py-decimal-money` | pass | 8.0 s | 5 | 14215+355 | $0.0169 |
| `py-mutable-default` | pass | 9.3 s | 5 | 14258+441 | $0.0133 |
| `py-reiterable` | pass | 8.8 s | 5 | 14387+451 | $0.0159 |
| `refactor-extract` | pass | 9.4 s | 4 | 11559+417 | $0.0145 |
| `sql-fanout-double-count` | pass | 12.0 s | 6 | 14740+556 | $0.0153 |
| `sql-index-advice` | pass | 4.7 s | 4 | 7220+164 | $0.0070 |
| `sql-join-fix` | pass | 11.6 s | 6 | 10636+575 | $0.0117 |
| `sql-latest-per-group` | pass | 13.2 s | 7 | 15992+401 | $0.0123 |
| `sql-not-in-null` | pass | 12.3 s | 7 | 12910+629 | $0.0133 |
| `test-regression` | pass | 8.6 s | 5 | 10605+412 | $0.0125 |
| `test-write-vat` | pass | 13.8 s | 3 | 10523+870 | $0.0134 |
| `ts-exhaustive-switch` | **FAIL** | 6.0 s | 2 | 7569+257 | $0.0063 |
| `ts-impossible-state` | pass | 17.7 s | 2 | 7487+1120 | $0.0150 |
| `ts-narrow-any` | **FAIL** | 180.1 s | — | — | — |
| `ts-readonly-input` | pass | 5.3 s | 2 | 7224+205 | $0.0055 |

### What the failures said

**`ibmi-cl-sbmjob`** — agent exit 0

```

```

**`ibmi-db2-commit`** — agent exit 0

```

```

**`ts-exhaustive-switch`** — agent exit 0

```

```

**`ts-narrow-any`** — agent exit 124

```

```

