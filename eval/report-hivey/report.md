# Evaluation report

Run at 2026-10-06T13:49:24.057Z.

Endpoint: `https://openrouter.ai/api/v1`. Models: `hivey/free`.

## Summary

| model | passed | rate | time | steps | tokens in | tokens out | cost | out of steps | truncated | escalations |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `hivey/free` | 27/62 | 44 % | 9626.9 s | 211 | 703638 | 66102 | $0.0000 | 0 | 5 | 0 |

## `hivey/free`

| kind | passed | rate | time | steps | cost |
| --- | --- | --- | --- | --- | --- |
| bug | 16/24 | 67 % | 3457.4 s | 125 | $0.0000 |
| feature | 1/3 | 33 % | 410.4 s | 13 | $0.0000 |
| ibmi | 1/21 | 5 % | 3450.6 s | 23 | $0.0000 |
| noverify | 5/6 | 83 % | 1003.6 s | 23 | $0.0000 |
| refactor | 3/4 | 75 % | 621.1 s | 15 | $0.0000 |
| test | 1/4 | 25 % | 683.8 s | 12 | $0.0000 |

| task | result | time | steps | tokens | cost |
| --- | --- | --- | --- | --- | --- |
| `feature-cli-flag` | pass | 93.6 s | 11 | 36057+1437 | $0.0000 |
| `feature-validate` | **FAIL** | 136.7 s | 2 | 7688+4373 | $0.0000 |
| `fin-amortisation` | pass | 145.4 s | 14 | 66294+3688 | $0.0000 |
| `fin-fix-message` | **FAIL** | 180.2 s | — | — | — |
| `fin-iban` | pass | 136.6 s | 7 | 24567+1832 | $0.0000 |
| `fin-identifiers` | **FAIL** | 180.1 s | — | — | — |
| `fin-market-hours` | **FAIL** | 180.0 s | — | — | — |
| `fin-minor-units` | **FAIL** | 180.2 s | — | — | — |
| `fin-settlement` | **FAIL** | 180.2 s | — | — | — |
| `ibmi-cl-monmsg` | **FAIL** | 169.5 s | 4 | 13775+1826 | $0.0000 |
| `ibmi-cl-qualify` | **FAIL** | 180.0 s | — | — | — |
| `ibmi-cl-sbmjob` | **FAIL** | 180.0 s | — | — | — |
| `ibmi-db2-catalog` | **FAIL** | 180.0 s | — | — | — |
| `ibmi-db2-commit` | **FAIL** | 112.7 s | 2 | 8156+995 | $0.0000 |
| `ibmi-db2-ddl` | **FAIL** | 108.6 s | 0 | 2532+1967 | $0.0000 |
| `ibmi-dds-field` | **FAIL** | 150.3 s | 1 | 4996+4216 | $0.0000 |
| `ibmi-dds-logical` | **FAIL** | 127.0 s | 6 | 23131+2873 | $0.0000 |
| `ibmi-dds-printer` | **FAIL** | 180.0 s | — | — | — |
| `ibmi-rpg-copy-proto` | **FAIL** | 180.1 s | — | — | — |
| `ibmi-rpg-doc` | **FAIL** | 180.0 s | — | — | — |
| `ibmi-rpg-fixed-lr` | **FAIL** | 98.0 s | 1 | 5292+4736 | $0.0000 |
| `ibmi-rpg-freeform` | **FAIL** | 180.0 s | — | — | — |
| `ibmi-rpg-indicators` | **FAIL** | 180.0 s | — | — | — |
| `ibmi-rpg-monitor` | **FAIL** | 164.2 s | 9 | 33641+1750 | $0.0000 |
| `ibmi-rpg-move` | **FAIL** | 180.1 s | — | — | — |
| `ibmi-rpg-packed` | **FAIL** | 180.0 s | — | — | — |
| `ibmi-rpg-procedure` | **FAIL** | 180.1 s | — | — | — |
| `ibmi-rpg-sql-cursor` | **FAIL** | 180.0 s | — | — | — |
| `ibmi-rpg-srvpgm` | **FAIL** | 180.0 s | — | — | — |
| `ibmi-rpg-unittest` | **FAIL** | 172.3 s | 1 | 5265+4152 | $0.0000 |
| `ibmi-sql-db2` | pass | 180.0 s | — | — | — |
| `java-equals-hashcode` | pass | 135.7 s | 5 | 16914+943 | $0.0000 |
| `java-junit` | pass | 151.0 s | 11 | 41667+1829 | $0.0000 |
| `java-optional` | pass | 145.2 s | 9 | 24131+1056 | $0.0000 |
| `java-try-with-resources` | pass | 142.5 s | 6 | 23567+1182 | $0.0000 |
| `js-async-race` | pass | 144.3 s | 9 | 27823+1568 | $0.0000 |
| `js-money-rounding` | **FAIL** | 139.6 s | 3 | 7765+3161 | $0.0000 |
| `js-null-crash` | pass | 137.2 s | 11 | 36672+1277 | $0.0000 |
| `js-off-by-one` | pass | 105.3 s | 9 | 31469+1927 | $0.0000 |
| `noverify-column` | **FAIL** | 180.0 s | — | — | — |
| `noverify-constant` | pass | 176.8 s | 11 | 36791+1016 | $0.0000 |
| `noverify-option` | pass | 180.1 s | — | — | — |
| `noverify-rename` | pass | 106.5 s | 12 | 22975+973 | $0.0000 |
| `noverify-signature` | pass | 180.1 s | — | — | — |
| `noverify-status` | pass | 180.1 s | — | — | — |
| `py-aware-datetime` | pass | 180.0 s | — | — | — |
| `py-date-parse` | pass | 92.3 s | 7 | 20662+2173 | $0.0000 |
| `py-decimal-money` | pass | 180.0 s | — | — | — |
| `py-mutable-default` | pass | 76.3 s | 9 | 28133+1338 | $0.0000 |
| `py-reiterable` | pass | 155.4 s | 9 | 31134+1437 | $0.0000 |
| `refactor-extract` | pass | 180.2 s | — | — | — |
| `sql-fanout-double-count` | **FAIL** | 175.0 s | 4 | 7688+4269 | $0.0000 |
| `sql-index-advice` | pass | 71.3 s | 8 | 21553+845 | $0.0000 |
| `sql-join-fix` | pass | 156.0 s | 13 | 38766+1904 | $0.0000 |
| `sql-latest-per-group` | **FAIL** | 180.0 s | — | — | — |
| `sql-not-in-null` | pass | 129.8 s | 8 | 21274+1787 | $0.0000 |
| `test-regression` | **FAIL** | 180.3 s | — | — | — |
| `test-write-vat` | **FAIL** | 180.2 s | — | — | — |
| `ts-exhaustive-switch` | **FAIL** | 180.1 s | — | — | — |
| `ts-impossible-state` | pass | 150.2 s | 5 | 18377+1063 | $0.0000 |
| `ts-narrow-any` | **FAIL** | 145.5 s | 1 | 4836+1975 | $0.0000 |
| `ts-readonly-input` | pass | 74.0 s | 3 | 10047+534 | $0.0000 |

### What the failures said

**`feature-validate`** — agent exit 0

```
TAP version 13
# file:///tmp/hivey-eval-feature-validate-FEfQbH/siret.test.js:3
# import { isValidSiret } from "./siret.js";
#          ^^^^^^^^^^^^
# SyntaxError: The requested module './siret.js' does not provide an export named 'isValidSiret'
# [90m    at ModuleJob._instantiate (node:internal/modules/esm/module_job:123:21)[39m
# [90m    at async ModuleJob.run (node:internal/modules/esm/module_job:191:5)[39m
# [90m    at async ModuleLoader.import (node:internal/modules/esm/loader:336:24)[39m
# [90m    at async loadESM (node:internal/process/esm_loader:34:7)[39m
# [90m    at async handleMainPromise (node:internal/modules/run_main:106:12)[39m
# Node.js v18.19.1
# Subtest: /tmp/hivey-eval-feature-validate-FEfQbH/siret.test.js
not ok 1 - /tmp/hivey-eval-feature-validate-FEfQbH/siret.test.js
  ---
  duration_ms: 75.003811
  location: '/tmp/hivey-eval-feature-validate-FEfQbH/siret.test.js:1:1'
  failureType: 'testCodeFailure'
  exitCode: 1
  error: 'test failed'
  code: 'ERR_TEST_FAILURE'
  ...
1..1
# tests 1
# suites 0
# pass 0
# fail 1
# cancelled 0
# skipped 0
# todo 0
# duration_ms 80.463251
```

**`fin-fix-message`** — agent exit 124

```
/test_runner/test:374:18)
    Test.postRun (node:internal/test_runner/test:715:19)
    Test.run (node:internal/test_runner/test:673:12)
    async startSubtest (node:internal/test_runner/harness:214:3)
  ...
# Subtest: a one-field message is still well formed
not ok 3 - a one-field message is still well formed
  ---
  duration_ms: 0.550542
  location: 'file:///tmp/hivey-eval-fin-fix-message-lXEZ9A/fix.test.js:45:1'
  failureType: 'testCodeFailure'
  error: |-
    Expected values to be strictly equal:
    
    undefined !== 3
    
  code: 'ERR_ASSERTION'
  name: 'AssertionError'
  expected: 3
  operator: 'strictEqual'
  stack: |-
    TestContext.<anonymous> (file:///tmp/hivey-eval-fin-fix-message-lXEZ9A/fix.test.js:49:10)
    Test.runInAsyncScope (node:async_hooks:203:9)
    Test.run (node:internal/test_runner/test:631:25)
    Test.processPendingSubtests (node:internal/test_runner/test:374:18)
    Test.postRun (node:internal/test_runner/test:715:19)
    Test.run (node:internal/test_runner/test:673:12)
    async Test.processPendingSubtests (node:internal/test_runner/test:374:7)
  ...
1..3
# tests 3
# suites 0
# pass 0
# fail 3
# cancelled 0
# skipped 0
# todo 0
# duration_ms 89.574916
```

**`fin-identifiers`** — agent exit 124

```
ertFalse(valid_isin("0S0378331005"))  # country code must be letters
    ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
AssertionError: True is not false

======================================================================
FAIL: test_isin_with_one_wrong_digit (test_ids.IdentifierTest.test_isin_with_one_wrong_digit)
----------------------------------------------------------------------
Traceback (most recent call last):
  File "/tmp/hivey-eval-fin-identifiers-ZdVScg/test_ids.py", line 14, in test_isin_with_one_wrong_digit
    self.assertFalse(valid_isin("US0378331006"))
AssertionError: True is not false

======================================================================
FAIL: test_lei_with_one_wrong_character (test_ids.IdentifierTest.test_lei_with_one_wrong_character)
----------------------------------------------------------------------
Traceback (most recent call last):
  File "/tmp/hivey-eval-fin-identifiers-ZdVScg/test_ids.py", line 27, in test_lei_with_one_wrong_character
    self.assertFalse(valid_lei("529900T8BM49AURSDO56"))
AssertionError: True is not false

----------------------------------------------------------------------
Ran 6 tests in 0.000s

FAILED (failures=4)
```

**`fin-market-hours`** — agent exit 124

```
onError: True is not false

======================================================================
FAIL: test_closes_at_half_past_five (test_market.MarketTest.test_closes_at_half_past_five)
----------------------------------------------------------------------
Traceback (most recent call last):
  File "/tmp/hivey-eval-fin-market-hours-XiX2SK/test_market.py", line 27, in test_closes_at_half_past_five
    self.assertTrue(is_open(utc(2026, 1, 15, 16, 29)))   # 17:29 local
    ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
AssertionError: False is not true

======================================================================
FAIL: test_open_in_winter (test_market.MarketTest.test_open_in_winter)
----------------------------------------------------------------------
Traceback (most recent call last):
  File "/tmp/hivey-eval-fin-market-hours-XiX2SK/test_market.py", line 18, in test_open_in_winter
    self.assertFalse(is_open(utc(2026, 1, 15, 7, 30)))   # 08:30 local, before the open
    ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
AssertionError: True is not false

----------------------------------------------------------------------
Ran 5 tests in 0.000s

FAILED (failures=4)
```

**`fin-minor-units`** — agent exit 124

```
gSubtests (node:internal/test_runner/test:374:18)
    Test.postRun (node:internal/test_runner/test:715:19)
    Test.run (node:internal/test_runner/test:673:12)
    async Test.processPendingSubtests (node:internal/test_runner/test:374:7)
  ...
# Subtest: an unknown currency is refused rather than assumed
not ok 5 - an unknown currency is refused rather than assumed
  ---
  duration_ms: 0.210785
  location: 'file:///tmp/hivey-eval-fin-minor-units-TD9fI9/convert.test.js:26:1'
  failureType: 'testCodeFailure'
  error: 'Missing expected exception.'
  code: 'ERR_ASSERTION'
  name: 'AssertionError'
  operator: 'throws'
  stack: |-
    TestContext.<anonymous> (file:///tmp/hivey-eval-fin-minor-units-TD9fI9/convert.test.js:27:10)
    Test.runInAsyncScope (node:async_hooks:203:9)
    Test.run (node:internal/test_runner/test:631:25)
    Test.processPendingSubtests (node:internal/test_runner/test:374:18)
    Test.postRun (node:internal/test_runner/test:715:19)
    Test.run (node:internal/test_runner/test:673:12)
    async Test.processPendingSubtests (node:internal/test_runner/test:374:7)
  ...
1..5
# tests 5
# suites 0
# pass 1
# fail 4
# cancelled 0
# skipped 0
# todo 0
# duration_ms 95.744798
```

**`fin-settlement`** — agent exit 124

```
al/test_runner/test:715:19)
    Test.run (node:internal/test_runner/test:673:12)
    async Test.processPendingSubtests (node:internal/test_runner/test:374:7)
  ...
# Subtest: T+1 and T+0
not ok 6 - T+1 and T+0
  ---
  duration_ms: 0.128311
  location: 'file:///tmp/hivey-eval-fin-settlement-fssqAl/settlement.test.js:30:1'
  failureType: 'testCodeFailure'
  error: |-
    Expected values to be strictly equal:
    + actual - expected
    
    + '2026-10-10'
    - '2026-10-12'
                ^
  code: 'ERR_ASSERTION'
  name: 'AssertionError'
  expected: '2026-10-12'
  actual: '2026-10-10'
  operator: 'strictEqual'
  stack: |-
    TestContext.<anonymous> (file:///tmp/hivey-eval-fin-settlement-fssqAl/settlement.test.js:31:10)
    Test.runInAsyncScope (node:async_hooks:203:9)
    Test.run (node:internal/test_runner/test:631:25)
    Test.processPendingSubtests (node:internal/test_runner/test:374:18)
    Test.postRun (node:internal/test_runner/test:715:19)
    Test.run (node:internal/test_runner/test:673:12)
    async Test.processPendingSubtests (node:internal/test_runner/test:374:7)
  ...
1..6
# tests 6
# suites 0
# pass 1
# fail 5
# cancelled 0
# skipped 0
# todo 0
# duration_ms 92.323752
```

**`ibmi-cl-monmsg`** — agent exit 0

```

```

**`ibmi-cl-qualify`** — agent exit 124

```

```

**`ibmi-cl-sbmjob`** — agent exit 124

```

```

**`ibmi-db2-catalog`** — agent exit 124

```

```

**`ibmi-db2-commit`** — agent exit 0

```

```

**`ibmi-db2-ddl`** — agent exit 0

```

```

**`ibmi-dds-field`** — agent exit 0

```

```

**`ibmi-dds-logical`** — agent exit 0

```

```

**`ibmi-dds-printer`** — agent exit 124

```

```

**`ibmi-rpg-copy-proto`** — agent exit 124

```

```

**`ibmi-rpg-doc`** — agent exit 124

```

```

**`ibmi-rpg-fixed-lr`** — agent exit 0

```

```

**`ibmi-rpg-freeform`** — agent exit 124

```

```

**`ibmi-rpg-indicators`** — agent exit 124

```

```

**`ibmi-rpg-monitor`** — agent exit 0

```

```

**`ibmi-rpg-move`** — agent exit 124

```

```

**`ibmi-rpg-packed`** — agent exit 124

```

```

**`ibmi-rpg-procedure`** — agent exit 124

```

```

**`ibmi-rpg-sql-cursor`** — agent exit 124

```

```

**`ibmi-rpg-srvpgm`** — agent exit 124

```

```

**`ibmi-rpg-unittest`** — agent exit 0

```

```

**`js-money-rounding`** — agent exit 0

```
95
  ...
# Subtest: a half cent on a refund rounds DOWN, also away from zero
not ok 3 - a half cent on a refund rounds DOWN, also away from zero
  ---
  duration_ms: 1.008622
  location: 'file:///tmp/hivey-eval-js-money-rounding-KzP3BS/total.test.js:13:1'
  failureType: 'testCodeFailure'
  error: |-
    Expected values to be strictly equal:
    
    -12 !== -13
    
  code: 'ERR_ASSERTION'
  name: 'AssertionError'
  expected: -13
  actual: -12
  operator: 'strictEqual'
  stack: |-
    TestContext.<anonymous> (file:///tmp/hivey-eval-js-money-rounding-KzP3BS/total.test.js:17:10)
    Test.runInAsyncScope (node:async_hooks:203:9)
    Test.run (node:internal/test_runner/test:631:25)
    Test.processPendingSubtests (node:internal/test_runner/test:374:18)
    Test.postRun (node:internal/test_runner/test:715:19)
    Test.run (node:internal/test_runner/test:673:12)
    async Test.processPendingSubtests (node:internal/test_runner/test:374:7)
  ...
# Subtest: a whole refund matches the invoice it cancels
ok 4 - a whole refund matches the invoice it cancels
  ---
  duration_ms: 0.096862
  ...
1..4
# tests 4
# suites 0
# pass 3
# fail 1
# cancelled 0
# skipped 0
# todo 0
# duration_ms 99.820232
```

**`noverify-column`** — agent exit 124

```
Parse error near line 2: table notes has 4 columns but 3 values were supplied
Parse error near line 3: table notes has 4 columns but 3 values were supplied
Parse error near line 4: table notes has 4 columns but 3 values were supplied
```

**`sql-fanout-double-count`** — agent exit 0

```
--- expected.txt	2026-10-06 13:38:53.641415691 +0000
+++ -	2026-10-06 13:41:48.640894927 +0000
@@ -1,3 +1,3 @@
-1|Durand|1750|1750
+1|Durand|3500|5250
 2|Lefevre|400|400
 3|Moreau|200|0
```

**`sql-latest-per-group`** — agent exit 124

```
--- expected.txt	2026-10-06 13:41:34.118591577 +0000
+++ -	2026-10-06 13:44:34.137552345 +0000
@@ -1,3 +1,6 @@
 CHF|2026-10-02|0.9365
+CHF|2026-10-01|0.9410
 GBP|2026-10-02|0.8710
+USD|2026-09-30|1.1050
 USD|2026-10-02|1.1085
+USD|2026-10-01|1.1120
```

**`test-regression`** — agent exit 124

```
AP version 13
# Subtest: spaces become dashes
ok 1 - spaces become dashes
  ---
  duration_ms: 0.809478
  ...
# Subtest: accented letters become their unaccented equivalent
not ok 2 - accented letters become their unaccented equivalent
  ---
  duration_ms: 1.081148
  location: 'file:///tmp/hivey-eval-test-regression-pc2UML/slug.test.js:9:1'
  failureType: 'testCodeFailure'
  error: |-
    Expected values to be strictly equal:
    + actual - expected
    
    + 'cr-me-br-l-e'
    - 'crme-brule'
         ^
  code: 'ERR_ASSERTION'
  name: 'AssertionError'
  expected: 'crme-brule'
  actual: 'cr-me-br-l-e'
  operator: 'strictEqual'
  stack: |-
    TestContext.<anonymous> (file:///tmp/hivey-eval-test-regression-pc2UML/slug.test.js:10:10)
    Test.runInAsyncScope (node:async_hooks:203:9)
    Test.run (node:internal/test_runner/test:631:25)
    Test.processPendingSubtests (node:internal/test_runner/test:374:18)
    Test.postRun (node:internal/test_runner/test:715:19)
    Test.run (node:internal/test_runner/test:673:12)
    async startSubtest (node:internal/test_runner/harness:214:3)
  ...
1..2
# tests 2
# suites 0
# pass 1
# fail 1
# cancelled 0
# skipped 0
# todo 0
# duration_ms 91.254054
```

**`test-write-vat`** — agent exit 124

```
TAP version 13
# file:///tmp/hivey-eval-test-write-vat-Y6BsXJ/vat.test.js:1
# import { describe, it, assert, throws } from "node:test";
#                        ^^^^^^
# SyntaxError: The requested module 'node:test' does not provide an export named 'assert'
# [90m    at ModuleJob._instantiate (node:internal/modules/esm/module_job:123:21)[39m
# [90m    at async ModuleJob.run (node:internal/modules/esm/module_job:191:5)[39m
# [90m    at async ModuleLoader.import (node:internal/modules/esm/loader:336:24)[39m
# [90m    at async loadESM (node:internal/process/esm_loader:34:7)[39m
# [90m    at async handleMainPromise (node:internal/modules/run_main:106:12)[39m
# Node.js v18.19.1
# Subtest: /tmp/hivey-eval-test-write-vat-Y6BsXJ/vat.test.js
not ok 1 - /tmp/hivey-eval-test-write-vat-Y6BsXJ/vat.test.js
  ---
  duration_ms: 74.540994
  location: '/tmp/hivey-eval-test-write-vat-Y6BsXJ/vat.test.js:1:1'
  failureType: 'testCodeFailure'
  exitCode: 1
  error: 'test failed'
  code: 'ERR_TEST_FAILURE'
  ...
1..1
# tests 1
# suites 0
# pass 0
# fail 1
# cancelled 0
# skipped 0
# todo 0
# duration_ms 80.272525
```

**`ts-exhaustive-switch`** — agent exit 124

```

```

**`ts-narrow-any`** — agent exit 0

```

```

