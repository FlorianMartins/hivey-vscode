// "all the skills, tools, etc. are in French in the code, can you switch everything to English".
// What the MODEL reads — skill names and bodies, the description it is given — stays English
// whatever the interface language; what a PERSON reads — the hint in the panel — is translated at
// display time with `t(sk.hint)`.

import { test } from "node:test";
import assert from "node:assert/strict";
import { setLanguage, language, t, en, withoutModelText } from "../src/shared/i18n.js";
import { BUILTIN_SKILLS, builtinSkillsForModel } from "../src/core/session/skills.js";
import { FR } from "../src/shared/i18n.fr.js";

test("built-in skills reach the model in English, whatever the interface language", () => {
  const before = language();
  try {
    setLanguage("en");
    const english = builtinSkillsForModel(BUILTIN_SKILLS);
    setLanguage("fr");
    const french = builtinSkillsForModel(BUILTIN_SKILLS);
    assert.deepEqual(french, english, "the model saw different skills in French");
    assert.ok(french.some((sk) => sk.name === "/explain"), "/explain must not become /expliquer");
    assert.ok(!french.some((sk) => /[àâçéèêëîïôûùœ]/.test(sk.body)), "a skill body is in French");
  } finally {
    setLanguage(before);
  }
});

test("the panel still shows the hint in the person's language", () => {
  const before = language();
  try {
    setLanguage("fr");
    const explain = BUILTIN_SKILLS.find((sk) => sk.name === "/explain")!;
    assert.notEqual(t(explain.hint), explain.hint, "the hint is no longer translated for display");
  } finally {
    setLanguage(before);
  }
});

test("⚠️ a typed skill expands in the person's language — every body keeps its French translation", () => {
  // The expansion of `/explain` becomes the person's own message, on screen: it was left in English
  // and read as a regression ("the text is back in English"). The webview translates it with
  // `t(match.prompt)`, a variable the coverage test cannot see — so this checks it directly.
  const missing = BUILTIN_SKILLS.filter((sk) => sk.prompt).map((sk) => sk.prompt!).filter((p) => !(p in FR));
  assert.deepEqual(missing, [], `skill bodies with no French entry:\n${missing.map((m) => m.slice(0, 80)).join("\n")}`);
});

test("every skill hint keeps its French translation for the panel", () => {
  // The hints are translated at display time, through a variable the coverage test cannot see —
  // so this one checks them directly, or a hint would quietly fall back to English in the panel.
  const missing = BUILTIN_SKILLS.map((sk) => sk.hint).filter((hint) => !(hint in FR));
  assert.deepEqual(missing, [], `skill hints with no French entry:\n${missing.join("\n")}`);
});

test("the product's own instructions are not mistaken for the person's words", () => {
  // `/explain` typed in a French interface sends an English instruction; the reply language must be
  // read from what the person added, not from that.
  const instruction = en("Explain what this code does, then what it is for. Be concrete about the inputs and what comes back.");
  const left = withoutModelText(`${instruction}\n\nsurtout la partie sur les dates`);
  assert.ok(!left.includes("Explain what this code"), "the instruction was left in");
  assert.match(left, /surtout la partie sur les dates/);
  assert.equal(en("{0} rows", 3), "3 rows", "placeholders are filled, never translated");
});
