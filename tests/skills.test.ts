// Which skills are offered, and the asymmetry that keeps new ones visible.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ALWAYS_ON,
  BUILTIN_SKILLS,
  DEFAULT_GROUPS,
  detectGroups,
  enabledSkills,
  isSkillEnabled,
  normaliseGroups,
  SKILL_GROUPS,
  skillInvocation,
  toggleSkill,
} from "../src/core/session/skills.js";

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

// ── Families ─────────────────────────────────────────────────────────────────────────────────

test("every skill belongs to a family the picker knows how to show", () => {
  // A skill in a group the picker does not list would be invisible — enabled, invoked by nobody,
  // and impossible to switch off.
  const known = new Set(SKILL_GROUPS.map((g) => g.id));
  for (const skill of BUILTIN_SKILLS) {
    assert.ok(known.has(skill.group), `${skill.name} is in the unknown group "${skill.group}"`);
  }
});

test("every family has something in it", () => {
  // An empty group renders as a heading with nothing under it.
  for (const group of SKILL_GROUPS) {
    assert.ok(
      BUILTIN_SKILLS.some((s) => s.group === group.id),
      `the "${group.id}" group is empty`,
    );
  }
});

test("the general family is the one that applies whatever the language", () => {
  const general = BUILTIN_SKILLS.filter((s) => s.group === "general").map((s) => s.name);
  // These are the ones that should never depend on which language is open.
  for (const name of ["/compact", "/tests", "/doc", "/commit"]) {
    assert.ok(general.includes(name), `${name} should be general`);
  }
});

test("a language skill names the tools of its language, not just its language", () => {
  // The point of a per-language skill is the body of convention it carries. A prompt that only says
  // "write tests, in Java" is the generic one with a word changed, and is worth nothing.
  const find = (name: string) => BUILTIN_SKILLS.find((s) => s.name === name)?.prompt ?? "";
  assert.match(find("/junit"), /@ParameterizedTest/);
  assert.match(find("/pytest"), /parametrize/);
  assert.match(find("/a11y"), /WCAG/);
  assert.match(find("/hints"), /mypy/);
});

// ── Families are opt-in, skills are opt-out ──────────────────────────────────────────────────
//
// The asymmetry is the whole model, and it exists because of a real complaint: every box was
// ticked in a picker whose purpose is choosing. Being handed a pre-answered question is worse than
// being handed no question.

test("only the general family is in play to begin with", () => {
  assert.deepEqual(DEFAULT_GROUPS, ["general"]);
  const policy = { groups: DEFAULT_GROUPS, disabled: [] };
  assert.equal(isSkillEnabled("/fix", policy), true, "a general skill is on");
  assert.equal(isSkillEnabled("/pytest", policy), false, "a Python skill is not");
  assert.equal(isSkillEnabled("/tofree", policy), false, "nor an RPG one");
});

test("choosing a family brings all of its skills, without touching the others", () => {
  const policy = { groups: normaliseGroups(["python"]), disabled: [] };
  const on = enabledSkills(policy).map((s) => s.name);
  assert.ok(on.includes("/pytest"));
  assert.ok(on.includes("/fix"), "general comes along, always");
  assert.ok(!on.includes("/junit"), "and Java does not");
});

test("general survives every choice", () => {
  // A profile that silenced /fix because you said "Rust" is a profile nobody uses twice.
  assert.ok(normaliseGroups(["rust"]).includes("general"));
  assert.ok(normaliseGroups([]).includes("general"));
});

test("families are returned in catalogue order, deduplicated, and unknown ones dropped", () => {
  const out = normaliseGroups(["rust", "python", "rust", "nonsense" as never]);
  assert.deepEqual(out, SKILL_GROUPS.map((g) => g.id).filter((id) => out.includes(id)));
  assert.equal(new Set(out).size, out.length);
  assert.ok(!out.includes("nonsense" as never));
});

test("a skill switched off inside an active family stays off", () => {
  const policy = { groups: normaliseGroups(["python"]), disabled: ["/pytest"] };
  assert.equal(isSkillEnabled("/pytest", policy), false);
  assert.equal(isSkillEnabled("/hints", policy), true);
});

test("a skill switched off in a family that is not in play does not come back on activation", () => {
  // Because the two lists answer different questions: membership and per-skill preference. Turning
  // Python on must not undo the four Python skills you switched off last week.
  const disabled = ["/pytest"];
  assert.equal(isSkillEnabled("/pytest", { groups: normaliseGroups(["python"]), disabled }), false);
});

test("compacting survives an empty policy", () => {
  assert.equal(isSkillEnabled("/compact", { groups: [], disabled: ["/compact"] }), true);
});

// ── Detection ────────────────────────────────────────────────────────────────────────────────

test("what the editor has open suggests the families, and nothing else", () => {
  assert.deepEqual(detectGroups(["python"]), ["python"]);
  assert.deepEqual(detectGroups(["typescriptreact", "css"]).sort(), ["frontend", "javascript"]);
  assert.ok(detectGroups(["rpgle"]).includes("rpg"));
  assert.ok(detectGroups(["dds.dspf"]).includes("dds"));
});

test("an unrecognised workspace suggests nothing, rather than guessing", () => {
  // The caller reads an empty list as "ask, do not assume".
  assert.deepEqual(detectGroups(["cobol", "fortran"]), []);
  assert.deepEqual(detectGroups([]), []);
});

test("every family holds at least three skills", () => {
  // A heading with one entry under it makes the list longer without making the choice easier.
  for (const group of SKILL_GROUPS) {
    const count = BUILTIN_SKILLS.filter((s) => s.group === group.id).length;
    assert.ok(count >= 3, `the "${group.id}" family holds only ${count}`);
  }
});

test("nothing is offered by a family nobody selected", () => {
  const names = enabledSkills({ groups: ["general"], disabled: [] }).map((s) => s.name);
  assert.ok(!names.some((n) => ["/a11y", "/junit", "/borrow", "/dspf"].includes(n)));
  assert.ok(names.length >= 8 && names.length <= 15, `general should be a handful, got ${names.length}`);
});
