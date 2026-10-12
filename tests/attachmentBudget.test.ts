// How much of an attached document reaches the model.
//
// "It only reads the first 200 lines and not the whole file." There was no 200-line limit anywhere:
// there were eight different token constants, one per path — 3 000 for the file on screen, 6 000 for
// the same file attached by hand, 2 000 for a selection, 4 000 for a mention, 8 000 for a paste —
// every one chosen when the whole context budget was a flat 8 000 tokens, and not one of them moved
// when the budget started following the model's window. Three thousand tokens is about two hundred
// lines of prose.
//
// A constant in eight places is not a decision. It is eight decisions that happen to agree until
// one of them is changed.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { perFileBudget } from "../src/core/util/tokens.js";
import { contextBudget } from "../src/core/context/budget.js";

test("an attached document follows the model, not a constant from the flat-budget era", () => {
  // The same file, on a model that can hold it: what reaches the model has to grow.
  const small = perFileBudget(contextBudget(undefined, 8_192));
  const large = perFileBudget(contextBudget(undefined, 200_000));
  assert.ok(large > small * 2, `a 200k model gets ${large} tokens of a file where an 8k model gets ${small}`);
  // And it has to be worth more than the two hundred lines that were reported.
  assert.ok(large >= 12_000, `${large} tokens is still only about ${Math.round(large / 15)} lines of prose`);
});

/**
 * No token constant may be written at an attachment call site.
 *
 * Asserted on the source because that is where the defect lived: every individual number was
 * defensible, and the bug was that there were eight of them. A unit test on the budget function
 * cannot see a ninth being introduced next to it.
 */
test("no attachment path carries a token budget of its own", () => {
  const dir = join("src", "extension");
  const offenders: string[] = [];
  for (const name of readdirSync(dir)) {
    if (!name.endsWith(".ts")) continue;
    const text = readFileSync(join(dir, name), "utf8");
    text.split("\n").forEach((line, i) => {
      // `activeContext(3000)`, `activeFileContext(6000)` — a literal where the budget belongs.
      if (/\bactive(File)?Context\(\s*\d/.test(line)) offenders.push(`${name}:${i + 1}: ${line.trim()}`);
      // `headToTokens(whatever, 8000)` in the extension: the core may hold constants, the wiring
      // may not — it is the wiring that knows which model is selected.
      if (/\bheadToTokens\([^)]*,\s*\d{3,}\s*\)/.test(line)) offenders.push(`${name}:${i + 1}: ${line.trim()}`);
    });
  }
  assert.deepEqual(
    offenders,
    [],
    `these cut an attachment to a fixed size instead of the budget:\n${offenders.join("\n")}`,
  );
});
