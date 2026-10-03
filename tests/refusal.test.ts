// A provider that refused is not a model that failed.
//
// The rule existed for the local spending guard and had a hole the size of the thing it was built
// for: a refusal from the PROVIDER looked exactly like a turn the model got wrong. 62 tasks, six at
// a time, OpenRouter answered HTTP 402 — "this request would exceed your available credits given
// your current in-flight requests" — to 54 of them, and the harness recorded 8 passes out of 62. It
// would have published 13 % as that configuration's quality: not a wrong number, a number about
// nothing.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { isProviderRefusal, refusalKind } from "../src/core/providers/refusal.js";

test("credit and rate limiting are refusals", () => {
  for (const message of [
    "HTTP 402 Payment Required: This request would exceed your available credits given your current in-flight requests.",
    "insufficient credits, please add credits",
    "HTTP 429: Too Many Requests",
    "rate limit exceeded for this model",
    "quota exceeded",
  ]) {
    assert.ok(isProviderRefusal(message), message);
  }
  assert.equal(refusalKind("HTTP 402 Payment Required"), "credit");
  assert.equal(refusalKind("HTTP 429 Too Many Requests"), "rate");
});

test("a real failure is not a refusal", () => {
  // Narrow on purpose: only the two ways a provider says "not now" rather than "no". Treating an
  // error as a refusal would hide a genuine failure from the measurement, which is the same defect
  // pointing the other way.
  for (const message of [
    "HTTP 401 Unauthorized",
    "HTTP 400: model not found",
    "HTTP 500 Internal Server Error",
    "socket hang up",
    "context length exceeded",
    "",
  ]) {
    assert.equal(isProviderRefusal(message), false, message);
    assert.equal(refusalKind(message), undefined, message);
  }
});

test("the terminal records it, so the harness can tell them apart", () => {
  const main = readFileSync("src/cli/main.ts", "utf8");
  assert.match(main, /if \(isProviderRefusal\(message\)\) writeRefusal\(/);
  // And the report's rule is unchanged: a set holding any refusal states no rate at all.
  const report = readFileSync("src/core/eval/report.ts", "utf8");
  assert.match(report, /if \(!out\.refused\) out\.passRate = out\.passed \/ outcomes\.length;/);
});
