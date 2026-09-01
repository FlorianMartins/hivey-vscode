// Which skills are offered, and the asymmetry that keeps new ones visible.

import { test } from "node:test";
import assert from "node:assert/strict";
import { ALWAYS_ON, BUILTIN_SKILLS, isSkillEnabled, skillInvocation, toggleSkill } from "../src/core/session/skills.js";

test("a skill nobody has switched off is on", () => {
  assert.equal(isSkillEnabled("/tests", []), true);
  assert.equal(isSkillEnabled("/tests", ["/doc"]), true);
  assert.equal(isSkillEnabled("/tests", ["/tests"]), false);
});

test("the stored list holds what is OFF, so a new skill arrives switched on", () => {
  // The asymmetry that matters. Storing the enabled set instead would mean every skill added by an
  // update, or committed by a colleague, ships invisible — which is how a feature exists and
  // nobody ever sees it.
  const disabled = ["/doc"];
  assert.equal(isSkillEnabled("/a-skill-invented-next-year", disabled), true);
});

test("compacting cannot be switched off", () => {
  // It is not a prompt, it is the control that relieves a full context. Hiding it would work
  // against the person exercising "total control of the tool".
  assert.equal(isSkillEnabled("/compact", ["/compact"]), true);
  assert.deepEqual(toggleSkill([], "/compact", false), []);
  assert.ok(ALWAYS_ON.has("/compact"));
});

test("toggling is idempotent and keeps the setting readable", () => {
  let list = toggleSkill([], "/doc", false);
  assert.deepEqual(list, ["/doc"]);
  list = toggleSkill(list, "/doc", false);
  assert.deepEqual(list, ["/doc"], "switching off twice is switching off once");
  list = toggleSkill(list, "/tests", false);
  assert.deepEqual(list, ["/doc", "/tests"], "sorted, so the settings file does not churn");
  list = toggleSkill(list, "/doc", true);
  assert.deepEqual(list, ["/tests"]);
});

test("a repository skill is spelled the same everywhere it is referred to", () => {
  // The join key between the panel's toggle, the stored setting and the prompt the model receives.
  // They disagreed at first, and the symptom was a toggle that appeared to do nothing.
  assert.equal(skillInvocation("review-rpg"), "/review-rpg");
  assert.equal(skillInvocation("/review-rpg"), "/review-rpg");
});

test("every built-in does exactly one thing, and says what", () => {
  for (const skill of BUILTIN_SKILLS) {
    assert.ok(skill.name.startsWith("/"), skill.name);
    assert.ok(skill.hint.length > 3, `${skill.name} has no usable description`);
    const kinds = [skill.prompt, skill.action].filter(Boolean).length;
    assert.equal(kinds, 1, `${skill.name} must be either a prompt or an action, not both or neither`);
  }
});

test("the names are unique, since the name is what the user types", () => {
  const names = BUILTIN_SKILLS.map((s) => s.name);
  assert.equal(new Set(names).size, names.length);
});
