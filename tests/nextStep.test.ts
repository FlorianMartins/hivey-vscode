// The suggested next request, read from a small model's reply.

import { test } from "node:test";
import assert from "node:assert/strict";
import { nextStepMessages, parseNextStep } from "../src/core/session/nextStep.js";

test("the suggestion is one clean line, and NONE means nothing", () => {
  assert.equal(parseNextStep("Ajoute un test pour la fonction mediane"), "Ajoute un test pour la fonction mediane");
  assert.equal(parseNextStep('Next: "Run the tests"\nbecause…'), "Run the tests");
  assert.equal(parseNextStep("- Supprime le setInterval en double"), "Supprime le setInterval en double");
  assert.equal(parseNextStep("NONE"), undefined);
  assert.equal(parseNextStep("  \n"), undefined);
  assert.ok(parseNextStep("x".repeat(400))!.length <= 140, "a composer line, not a paragraph");
});

test("the request carries the question, the answer and the language", () => {
  const m = nextStepMessages("Retire le bandeau", "C'est fait.", "fr");
  assert.equal(m.length, 2);
  assert.match(m[1]!.content, /Retire le bandeau/);
  assert.match(m[1]!.content, /in French/);
  const long = nextStepMessages("q", "a".repeat(20_000), "en")[1]!.content;
  assert.ok(long.length < 7000, "a long answer is cut from the middle");
});
