// "the model switches to English" — the reply language is decided from the question and restated
// after the transcript, where a model reads it last, rather than left to one line at the top of
// the system prompt that a few screens of English tool output wash away.

import { test } from "node:test";
import assert from "node:assert/strict";
import { detectLanguage, languageDirective, turnDirectives } from "../src/core/prompts.js";

test("the question's language is read from what was written", () => {
  assert.equal(detectLanguage("Est-ce que tu peux corriger le test qui échoue dans `parser.ts` ?", "en"), "fr");
  assert.equal(detectLanguage("ajoute une option pour le timeout s'il te plaît", "en"), "fr");
  assert.equal(detectLanguage("Can you fix the failing test in `parser.ts`?", "fr"), "en");
  assert.equal(detectLanguage("Why does this throw when the list is empty?", "fr"), "en");
});

test("too short or too technical to tell: the interface language decides", () => {
  assert.equal(detectLanguage("parseInt(x)", "fr"), "fr");
  assert.equal(detectLanguage("ok", "en"), "en");
  assert.equal(detectLanguage("", "fr"), "fr");
});

test("the directive names the language and travels with the other per-turn directives", () => {
  const fr = languageDirective("fr");
  assert.match(fr, /French/);
  assert.match(fr, /tool output/, "it says to hold the language after reading English output");
  assert.match(turnDirectives({ dialect: "Db2 for i.", language: fr }), /Db2 for i\.\n\nReply language: French/);
});
