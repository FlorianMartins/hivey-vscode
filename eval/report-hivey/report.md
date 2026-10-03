# Evaluation report

Run at 2026-10-03T11:53:09.585Z.

Endpoint: `https://openrouter.ai/api/v1`. Models: `hivey`.

## Summary

| model | passed | rate | time | steps | tokens in | tokens out | cost | out of steps | truncated | escalations |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `hivey` | 48/56 | 86 % | 3725.8 s | 516 | 3448638 | 138198 | $4.3422 | 3 | 0 | 0 |

## `hivey`

| kind | passed | rate | time | steps | cost |
| --- | --- | --- | --- | --- | --- |
| bug | 24/24 | 100 % | 1357.9 s | 240 | $1.7732 |
| feature | 3/3 | 100 % | 152.8 s | 27 | $0.2047 |
| ibmi | 15/21 | 71 % | 1607.0 s | 170 | $1.7687 |
| refactor | 2/4 | 50 % | 355.9 s | 37 | $0.2549 |
| test | 4/4 | 100 % | 252.2 s | 42 | $0.3408 |

| task | result | time | steps | tokens | cost |
| --- | --- | --- | --- | --- | --- |
| `feature-cli-flag` | pass | 50.5 s | 9 | 53935+2097 | $0.0697 |
| `feature-validate` | pass | 52.5 s | 10 | 58576+1646 | $0.0673 |
| `fin-amortisation` | pass | 45.3 s | 10 | 61425+1391 | $0.0661 |
| `fin-fix-message` | pass | 81.6 s | 12 | 91477+3424 | $0.1047 |
| `fin-iban` | pass | 50.2 s | 9 | 62353+1846 | $0.0716 |
| `fin-identifiers` | pass | 134.9 s | 14 | 104911+4779 | $0.1261 |
| `fin-market-hours` | pass | 61.2 s | 12 | 82297+2130 | $0.0868 |
| `fin-minor-units` | pass | 57.3 s | 10 | 64285+1931 | $0.0731 |
| `fin-settlement` | pass | 64.0 s | 10 | 65500+2438 | $0.0793 |
| `ibmi-cl-monmsg` | pass | 49.7 s | 6 | 40912+1660 | $0.0546 |
| `ibmi-cl-qualify` | **FAIL** | 100.9 s | 9 | 60240+4390 | $0.0986 |
| `ibmi-cl-sbmjob` | **FAIL** | 41.3 s | 4 | 27833+1200 | $0.0388 |
| `ibmi-db2-catalog` | pass | 55.7 s | 8 | 52567+1785 | $0.0659 |
| `ibmi-db2-commit` | **FAIL** | 87.5 s | 10 | 81032+3740 | $0.1040 |
| `ibmi-db2-ddl` | pass | 32.0 s | 3 | 25365+1540 | $0.0405 |
| `ibmi-dds-field` | pass | 91.8 s | 9 | 66094+3730 | $0.0961 |
| `ibmi-dds-logical` | pass | 59.4 s | 7 | 48526+2352 | $0.0686 |
| `ibmi-dds-printer` | **FAIL** | 154.9 s | 10 | 89224+8085 | $0.1563 |
| `ibmi-rpg-copy-proto` | pass | 77.3 s | 10 | 70987+3025 | $0.0921 |
| `ibmi-rpg-doc` | pass | 89.6 s | 12 | 79189+3561 | $0.1007 |
| `ibmi-rpg-fixed-lr` | pass | 58.4 s | 7 | 48590+2272 | $0.0676 |
| `ibmi-rpg-freeform` | **FAIL** | 50.6 s | 4 | 29491+1764 | $0.0461 |
| `ibmi-rpg-indicators` | pass | 76.5 s | 9 | 66043+3219 | $0.0900 |
| `ibmi-rpg-monitor` | pass | 59.3 s | 9 | 66611+1773 | $0.0749 |
| `ibmi-rpg-move` | pass | 120.6 s | 10 | 74438+5197 | $0.1186 |
| `ibmi-rpg-packed` | pass | 119.9 s | 9 | 70390+5674 | $0.1202 |
| `ibmi-rpg-procedure` | pass | 81.2 s | 12 | 83135+3665 | $0.1063 |
| `ibmi-rpg-sql-cursor` | **FAIL** | 30.2 s | 3 | 22165+915 | $0.0308 |
| `ibmi-rpg-srvpgm` | pass | 110.3 s | 11 | 77332+5732 | $0.1253 |
| `ibmi-rpg-unittest` | pass | 92.7 s | 13 | 105473+3638 | $0.1146 |
| `ibmi-sql-db2` | pass | 59.9 s | 8 | 52506+2402 | $0.0727 |
| `java-equals-hashcode` | pass | 58.1 s | 9 | 61801+2378 | $0.0793 |
| `java-junit` | pass | 52.6 s | 8 | 58088+2394 | $0.0751 |
| `java-optional` | pass | 67.3 s | 15 | 81972+3101 | $0.1008 |
| `java-try-with-resources` | pass | 55.7 s | 8 | 53971+1906 | $0.0676 |
| `js-async-race` | pass | 64.7 s | 11 | 60652+2089 | $0.0725 |
| `js-money-rounding` | pass | 43.8 s | 9 | 51775+1448 | $0.0597 |
| `js-null-crash` | pass | 41.2 s | 9 | 47444+952 | $0.0521 |
| `js-off-by-one` | pass | 52.4 s | 13 | 84922+1652 | $0.0806 |
| `py-aware-datetime` | pass | 56.1 s | 10 | 68390+1945 | $0.0766 |
| `py-date-parse` | pass | 47.0 s | 9 | 54739+1423 | $0.0621 |
| `py-decimal-money` | pass | 59.0 s | 10 | 73419+2403 | $0.0831 |
| `py-mutable-default` | pass | 50.6 s | 10 | 64946+1617 | $0.0712 |
| `py-reiterable` | pass | 50.0 s | 9 | 64268+1626 | $0.0705 |
| `refactor-extract` | pass | 57.3 s | 14 | 81610+1765 | $0.0844 |
| `sql-fanout-double-count` | pass | 53.0 s | 10 | 58829+2035 | $0.0709 |
| `sql-index-advice` | pass | 38.9 s | 9 | 45870+1401 | $0.0561 |
| `sql-join-fix` | pass | 50.7 s | 9 | 50169+2027 | $0.0657 |
| `sql-latest-per-group` | pass | 48.1 s | 10 | 56039+1745 | $0.0664 |
| `sql-not-in-null` | pass | 46.7 s | 10 | 54537+1495 | $0.0633 |
| `test-regression` | pass | 57.8 s | 12 | 73476+2045 | $0.0819 |
| `test-write-vat` | pass | 49.1 s | 9 | 56279+1906 | $0.0691 |
| `ts-exhaustive-switch` | pass | 49.8 s | 8 | 54396+1889 | $0.0677 |
| `ts-impossible-state` | **FAIL** | 51.3 s | 8 | 55083+2023 | $0.0697 |
| `ts-narrow-any` | **FAIL** | 180.0 s | — | — | — |
| `ts-readonly-input` | pass | 47.4 s | 8 | 53061+1932 | $0.0679 |

### What the failures said

**`ibmi-cl-qualify`** — agent exit 0

```

```

**`ibmi-cl-sbmjob`** — agent exit 0

```

```

**`ibmi-db2-commit`** — agent exit 0

```

```

**`ibmi-dds-printer`** — agent exit 0

```

```

**`ibmi-rpg-freeform`** — agent exit 0

```

```

**`ibmi-rpg-sql-cursor`** — agent exit 0

```

```

**`ts-impossible-state`** — agent exit 0

```

```

**`ts-narrow-any`** — agent exit 124

```

```

