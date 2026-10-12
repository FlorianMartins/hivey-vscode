// A 402 that says what it CAN afford is not a dead end.
//
// OpenRouter's refusal carries the answer inside it:
//
//     "This request requires more credits, or fewer max_tokens.
//      You requested up to 4096 tokens, but can only afford 1991."
//     metadata.remedy_hint: "… or lower max_tokens / prompt size to fit your remaining balance."
//
// So the request can be repeated for what the balance allows, and the user gets a shorter answer
// instead of an error. ⚠️ And the bug this found is worse than the missing feature: the message
// contains the words `max_tokens`, so the generic "remove whatever the server names" rule DELETED
// the cap and retried without one — asking for an unbounded answer when the server had just said to
// ask for a smaller one. Exactly backwards, and guaranteed to be refused again.

import { test } from "node:test";
import assert from "node:assert/strict";
import { adaptRequest, affordableTokens } from "../src/core/providers/openai.js";

const REFUSAL =
  "This request requires more credits, or fewer max_tokens. You requested up to 4096 tokens, " +
  "but can only afford 1991. To increase, visit https://openrouter.ai/… and adjust the key's weekly limit";

test("the affordable number is read out of the refusal", () => {
  assert.equal(affordableTokens(REFUSAL), 1991);
  assert.equal(affordableTokens("but can only afford 12 tokens"), 12);
  assert.equal(affordableTokens("no numbers here"), undefined);
  assert.equal(affordableTokens(""), undefined);
});

test("the cap is LOWERED, never removed", () => {
  const adapted = adaptRequest({ model: "m", max_tokens: 4096, stream: true }, REFUSAL);
  assert.ok(adapted, "the request must be retried");
  assert.equal(adapted!["max_tokens"], 1991);
  assert.ok("max_tokens" in adapted!, "deleting the cap asks for MORE when the server asked for less");
});

test("a cap already small enough is not touched", () => {
  // Then the refusal is about the prompt, not the answer, and lowering an already-smaller cap would
  // claim to have fixed something.
  assert.equal(adaptRequest({ model: "m", max_tokens: 500 }, REFUSAL), undefined);
});

test("an affordable answer too short to be an answer is refused instead", () => {
  // 150 tokens is not an answer, and silently returning one would be worse than the error: the user
  // would read a truncated reply as the model's opinion. Better to say the balance is the problem.
  const broke = REFUSAL.replace("can only afford 1991", "can only afford 150");
  assert.equal(adaptRequest({ model: "m", max_tokens: 4096 }, broke), undefined);
});

test("the other adaptations still work, and this one does not swallow them", () => {
  // The rename, which is a different server saying a different thing.
  const renamed = adaptRequest({ model: "m", max_tokens: 4096 }, "Unsupported parameter: use max_completion_tokens");
  assert.equal(renamed?.["max_completion_tokens"], 4096);
  assert.ok(!("max_tokens" in (renamed ?? {})));
  // And a field the server names is still dropped.
  const dropped = adaptRequest({ model: "m", temperature: 0.7 }, "temperature is not supported by this model");
  assert.ok(dropped && !("temperature" in dropped));
});

test("a 402 reaches the adaptation at all", () => {
  // ⚠️ The defect that hid the other one. Only HTTP 400 was adapted, so the single refusal that
  // carries its own remedy — "you can only afford 1991" — was the one that never reached the code
  // that applies remedies. Fixing `adaptRequest` changed nothing until this line did.
  const { readFileSync } = require("node:fs") as typeof import("node:fs");
  const src = readFileSync("src/core/providers/openai.ts", "utf8");
  assert.match(src, /const adaptable = res\.status === 400 \|\| res\.status === 402;/);
  assert.ok(!/res\.status !== 400 \|\| tries >= 2\) return res;/.test(src), "the 400-only gate is back");
});

test("a shortened answer says so", () => {
  // A short answer returned in silence is worse than the refusal: the user reads a fragment as what
  // the model thinks.
  const { readFileSync } = require("node:fs") as typeof import("node:fs");
  assert.match(readFileSync("src/core/providers/types.ts", "utf8"), /shortenedTo\?: number;/);
  assert.match(readFileSync("src/core/providers/openai.ts", "utf8"), /this\.lastShortened = capped;/);
});
