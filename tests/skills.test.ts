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
  normalizeGroups,
  SKILL_GROUPS,
  skillInvocation,
  toggleSkill,
} from "../src/core/session/skills.js";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

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
  const policy = { groups: normalizeGroups(["python"]), disabled: [] };
  const on = enabledSkills(policy).map((s) => s.name);
  assert.ok(on.includes("/pytest"));
  assert.ok(on.includes("/fix"), "general comes along, always");
  assert.ok(!on.includes("/junit"), "and Java does not");
});

test("general survives every choice", () => {
  // A profile that silenced /fix because you said "Rust" is a profile nobody uses twice.
  assert.ok(normalizeGroups(["rust"]).includes("general"));
  assert.ok(normalizeGroups([]).includes("general"));
});

test("families are returned in catalogue order, deduplicated, and unknown ones dropped", () => {
  const out = normalizeGroups(["rust", "python", "rust", "nonsense" as never]);
  assert.deepEqual(out, SKILL_GROUPS.map((g) => g.id).filter((id) => out.includes(id)));
  assert.equal(new Set(out).size, out.length);
  assert.ok(!out.includes("nonsense" as never));
});

test("a skill switched off inside an active family stays off", () => {
  const policy = { groups: normalizeGroups(["python"]), disabled: ["/pytest"] };
  assert.equal(isSkillEnabled("/pytest", policy), false);
  assert.equal(isSkillEnabled("/hints", policy), true);
});

test("a skill switched off in a family that is not in play does not come back on activation", () => {
  // Because the two lists answer different questions: membership and per-skill preference. Turning
  // Python on must not undo the four Python skills you switched off last week.
  const disabled = ["/pytest"];
  assert.equal(isSkillEnabled("/pytest", { groups: normalizeGroups(["python"]), disabled }), false);
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

test("an unrecognized workspace suggests nothing, rather than guessing", () => {
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

// ── The IBM i families, and the task behind each skill ───────────────────────────────────────────
//
// The roadmap's requirement for phase 1 is forty IBM i skills, each backed by an evaluation task
// whose check fails before the work is done. A requirement like that survives exactly as long as
// somebody remembers it, so it is read off the skills themselves: a new IBM i skill with no task
// named — and no reason given for having none — fails here.

const IBMI_GROUPS = new Set(["rpg", "dds", "db2i", "cl"]);
/**
 * The families whose skills must each be backed by an evaluation task.
 *
 * IBM i because the roadmap's phase 1 asked for it, and finance because phase 3 asked for the same
 * thing in the same words — and the reason is the same in both: a skill is a few lines of text, so a
 * family nobody can measure is a family nobody should count.
 */
const BACKED_GROUPS = new Set([...IBMI_GROUPS, "finance"]);
const ibmiSkills = BUILTIN_SKILLS.filter((s) => IBMI_GROUPS.has(s.group));
const backedSkills = BUILTIN_SKILLS.filter((s) => BACKED_GROUPS.has(s.group));

test("there are at least forty IBM i skills", () => {
  assert.ok(ibmiSkills.length >= 40, `only ${ibmiSkills.length}: ${ibmiSkills.map((s) => s.name).join(" ")}`);
  // And spread across the four families rather than forty variations of one.
  for (const group of IBMI_GROUPS) {
    const count = ibmiSkills.filter((s) => s.group === group).length;
    assert.ok(count >= 5, `the ${group} family has only ${count}`);
  }
});

test("every IBM i and finance skill names the evaluation task that exercises it, or says why it cannot", () => {
  const unbacked = backedSkills.filter((s) => !s.evalTask && !s.evalGap);
  assert.deepEqual(unbacked.map((s) => s.name), [], "these are backed by nothing and explain nothing");
});

test("every task a skill names exists on disk", () => {
  // The failure this catches is a renamed directory: the skill still points somewhere, and nothing
  // else in the repository would notice.
  const missing: string[] = [];
  for (const skill of backedSkills) {
    if (!skill.evalTask) continue;
    if (!existsSync(join("eval", "tasks", skill.evalTask, "task.json"))) missing.push(`${skill.name} → ${skill.evalTask}`);
  }
  assert.deepEqual(missing, [], "these skills point at a task that is not there");
});

test("the declared gaps are few, and each says what is missing", () => {
  // A gap is honest; a drawer full of gaps is the requirement quietly abandoned.
  const gaps = ibmiSkills.filter((s) => s.evalGap);
  assert.ok(gaps.length <= 4, `${gaps.length} skills are unbacked: ${gaps.map((s) => s.name).join(" ")}`);
  for (const skill of gaps) {
    assert.match(skill.evalGap ?? "", /partition/, `${skill.name}'s gap does not say what is missing`);
    assert.equal(skill.evalTask, undefined, `${skill.name} claims both a task and a gap`);
  }
});

test("the tasks behind the IBM i skills really are IBM i tasks", () => {
  // The cheat this prevents: backing /tofree with a JavaScript task because the mapping only
  // checks that a directory exists.
  const wrong: string[] = [];
  for (const skill of ibmiSkills) {
    if (!skill.evalTask) continue;
    const meta = JSON.parse(readFileSync(join("eval", "tasks", skill.evalTask, "task.json"), "utf8")) as { kind: string };
    // `ibmi` is the kind for the platform's own work; a test-writing or bug task is allowed when the
    // fixture is IBM i source, which the directory name carries.
    if (meta.kind !== "ibmi" && !skill.evalTask.startsWith("ibmi-")) wrong.push(`${skill.name} → ${skill.evalTask} (${meta.kind})`);
  }
  assert.deepEqual(wrong, [], "these skills are backed by a task about something else");
});

test("the finance family exists, is complete, and every skill in it is backed", () => {
  const finance = BUILTIN_SKILLS.filter((s) => s.group === "finance");
  assert.ok(finance.length >= 8, `only ${finance.length}: ${finance.map((s) => s.name).join(" ")}`);
  // The subjects the roadmap names, each present.
  const names = finance.map((s) => s.name).join(" ");
  for (const subject of ["/rounding", "/decimal", "/packed", "/settlement", "/markethours", "/identifiers", "/fixmsg"]) {
    assert.ok(names.includes(subject), `${subject} is missing from the finance family`);
  }
  // And every one of them names a task that exists — no gaps here: all of this is testable in
  // ordinary code, unlike an IBM i partition.
  for (const skill of finance) {
    assert.ok(skill.evalTask, `${skill.name} is backed by nothing`);
    assert.equal(skill.evalGap, undefined, `${skill.name} claims a gap, and finance has no excuse for one`);
    assert.ok(existsSync(join("eval", "tasks", skill.evalTask!, "task.json")), `${skill.name} → ${skill.evalTask}`);
  }
  // The roadmap asks for JavaScript, Python, Java and RPG where relevant: the tasks behind this
  // family span at least three languages.
  const kinds = new Set(
    finance.map((s) => {
      const files = readdirSync(join("eval", "tasks", s.evalTask!, "files"));
      if (files.some((f) => f.endsWith(".py"))) return "python";
      if (files.some((f) => f.endsWith(".rpgle"))) return "rpg";
      if (files.some((f) => f.endsWith(".js"))) return "javascript";
      return "other";
    }),
  );
  assert.ok(kinds.size >= 3, `the finance tasks span only ${[...kinds].join(", ")}`);
});
