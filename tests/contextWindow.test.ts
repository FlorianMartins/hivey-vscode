// The budget that decides how much of a conversation the model is allowed to see.

import { test } from "node:test";
import assert from "node:assert/strict";
import { contextBudget, repoMapBudget, CONTEXT_FLOOR_TOKENS } from "../src/core/context/budget.js";
import { shouldSuggestCompact, COMPACT_RATIO } from "../src/core/session/digest.js";

test("a figure the user typed is obeyed, including a small one", () => {
  assert.equal(contextBudget(4000, 1_000_000), 4000);
  assert.equal(contextBudget(200_000, 8192), 200_000);
});

test("with no figure, the budget is the model's window less what the turn still needs", () => {
  // ⚠️ This used to stop at a 32,000-token ceiling, and that ceiling was never technical — it was
  // about money: "an unbounded budget on a million-token window would turn every question into a
  // bill". A sound argument made in the wrong place. The spending caps already watch this and they
  // ASK; the ceiling did the same job by silently withholding the model's own window, which is the
  // version the user cannot see, answer or weigh. Asked for directly: « si le modèle propose 1M,
  // prendre le 1M plutôt que 64k ».
  assert.equal(contextBudget(undefined, 8192), CONTEXT_FLOOR_TOKENS);
  assert.ok(contextBudget(undefined, 200_000) > 100_000, "a 200k model should give six figures");
  assert.ok(contextBudget(undefined, 1_000_000) > 700_000, "a million-token model should give most of a million");
});

test("the reserve is never smaller than room for the answer and the steps after it", () => {
  // Not a preference: a prompt filling the whole window leaves nothing for the reply, and in agent
  // mode nothing for the tool results of the steps that follow. The turn would truncate on its first
  // answer, which is the failure `loop.ts` calls "it only does the reasoning and gives no answer".
  const window = 1_000_000;
  const answer = 8000;
  assert.ok(window - contextBudget(undefined, window, answer) >= answer * 3);
  // And a big answer budget takes its room even when a fifth of the window would not have covered it.
  assert.ok(300_000 - contextBudget(undefined, 300_000, 40_000) >= 40_000 * 3);
});

test("the floor wins when the reserve would leave nothing to work with", () => {
  // ⚠️ The two bounds meet here, and the floor is the one that has to win. A 60k window with a 20k
  // answer budget cannot give three answers' room AND a usable prompt — honouring the reserve would
  // hand the model a budget of zero, which is not a smaller context, it is no conversation at all.
  // The floor is what keeps such a model usable, exactly as it did before any of this derivation
  // existed.
  assert.equal(contextBudget(undefined, 60_000, 20_000), CONTEXT_FLOOR_TOKENS);
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
  assert.ok(repoMapBudget(32_000) <= 12_000);
  assert.ok(repoMapBudget(1_000_000) <= 12_000);
});

test("a conversation on a modern model survives more than three exchanges before being summarized", () => {
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
    `summarizing begins after ${exchanges} exchanges on a 200k model (budget ${budget}, ratio ${COMPACT_RATIO})`,
  );
});
