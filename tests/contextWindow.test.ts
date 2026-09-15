// The budget that decides how much of a conversation the model is allowed to see.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  contextBudget,
  repoMapBudget,
  CONTEXT_FLOOR_TOKENS,
  CONTEXT_CEILING_TOKENS,
} from "../src/core/context/budget.js";
import { shouldSuggestCompact, COMPACT_RATIO } from "../src/core/session/digest.js";

test("a figure the user typed is obeyed, including a small one", () => {
  assert.equal(contextBudget(4000, 1_000_000), 4000);
  assert.equal(contextBudget(200_000, 8192), 200_000);
});

test("with no figure, the budget follows the model's own window", () => {
  // A local 8k model must not be handed a budget it cannot receive, and a 200k model must not be
  // held to a figure chosen when the only models were local.
  assert.equal(contextBudget(undefined, 8192), CONTEXT_FLOOR_TOKENS);
  assert.ok(contextBudget(undefined, 200_000) > CONTEXT_FLOOR_TOKENS);
  assert.equal(contextBudget(undefined, 1_000_000), CONTEXT_CEILING_TOKENS);
});

test("an unknown window behaves exactly as before", () => {
  // The catalogue does not know every local runtime's window. Deriving from a zero would be worse
  // than not deriving at all.
  assert.equal(contextBudget(undefined, 0), CONTEXT_FLOOR_TOKENS);
  assert.equal(contextBudget(undefined, Number.NaN), CONTEXT_FLOOR_TOKENS);
});

test("the repository map does not grow with the budget for ever", () => {
  // It sits in the cacheable prefix, so every token of it is paid for on every turn — and past a
  // few thousand tokens a list of paths and symbols stops being knowledge and starts being hay.
  assert.equal(repoMapBudget(8000), 3200);
  assert.ok(repoMapBudget(CONTEXT_CEILING_TOKENS) <= 12_000);
  assert.ok(repoMapBudget(1_000_000) <= 12_000);
});

test("a conversation on a modern model survives more than three exchanges before being summarised", () => {
  // The reported symptom, as an assertion: "three messages and I had used almost the whole context,
  // without getting a single answer". Compaction fires at two thirds of the budget and REPLACES the
  // transcript with a summary in the prompt, so a budget too small for the model does not save
  // money — it makes the assistant answer from a digest of a conversation it could have read.
  const budget = contextBudget(undefined, 200_000);
  const perExchange = 1500; // a question, an answer, and the excerpt each one carries
  let exchanges = 0;
  while (!shouldSuggestCompact(perExchange * (exchanges + 1), budget, (exchanges + 1) * 2)) exchanges += 1;
  assert.ok(
    exchanges >= 10,
    `summarising begins after ${exchanges} exchanges on a 200k model (budget ${budget}, ratio ${COMPACT_RATIO})`,
  );
});
