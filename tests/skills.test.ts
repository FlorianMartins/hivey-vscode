// Which skills are offered, and the asymmetry that keeps new ones visible.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ALWAYS_ON,
  BUILTIN_SKILLS,
  DEFAULT_GROUPS,
  detectGroups,
  familiesInPlay,
  groupsForPaths,
  languageIdForPath,
  enabledSkills,
  isSkillEnabled,
  normalizeGroups,
  SKILL_GROUPS,
  skillInvocation,
  toggleSkill,
} from "../src/core/session/skills.js";
import { existsSync, readdirSync } from "node:fs";
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
  assert.equal(skillInvocation("review-api"), "/review-api");
  assert.equal(skillInvocation("/review-api"), "/review-api");
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
  assert.equal(isSkillEnabled("/junit", policy), false, "nor a Java one");
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
  assert.ok(detectGroups(["dockerfile"]).includes("devops"));
});

test("an unrecognized workspace suggests nothing, rather than guessing", () => {
  // The caller reads an empty list as "ask, do not assume".
  assert.deepEqual(detectGroups(["cobol", "fortran"]), []);
  assert.deepEqual(detectGroups([]), []);
});

test("what is open switches its families ON, not merely suggests them", () => {
  // The defect this closes: `detectGroups` was computed and then used to tick a box in a wizard, so
  // somebody editing Python with default settings got `general` and nothing else while the
  // language's skills sat switched off. Florian: "the automatic detection of open programs doesn't
  // seem to do the automated enabling and disabling of skills".
  const { groups, fromOpenFiles } = familiesInPlay(["general"], ["python", "typescript"], true);
  assert.ok(groups.includes("python"), "an open Python file did not bring the Python family in");
  assert.ok(groups.includes("javascript"), "TypeScript implies the JavaScript family");
  assert.deepEqual(fromOpenFiles.sort(), ["javascript", "python"], "the panel cannot say why a family is lit");
});

test("a family the user chose survives a day spent in other files", () => {
  // The rule that makes this safe to do without asking: it ADDS. Dropping a family somebody
  // deliberately switched on, in order to be helpful, is the version of this nobody keeps enabled.
  const { groups, fromOpenFiles } = familiesInPlay(["general", "rust"], ["python"], true);
  assert.ok(groups.includes("rust"), "a chosen family was taken away because today's files differ");
  assert.ok(groups.includes("python"));
  assert.deepEqual(fromOpenFiles, ["python"], "only the detected one is attributed to the files");
});

test("deactivation is what happens when the file is no longer open", () => {
  // The other half of what was asked for, and the harmless half: a family that was on ONLY because
  // of a file is gone from the next conversation once that file is not open. Nothing is unset.
  assert.ok(familiesInPlay(["general"], ["python"], true).groups.includes("python"));
  assert.ok(!familiesInPlay(["general"], [], true).groups.includes("python"));
  // Whereas a chosen one stays, with nothing open at all.
  assert.ok(familiesInPlay(["general", "python"], [], true).groups.includes("python"));
});

test("switching the automation off leaves the chosen families exactly as they are", () => {
  const { groups, fromOpenFiles } = familiesInPlay(["general"], ["java", "python"], false);
  assert.deepEqual(groups, ["general"]);
  assert.deepEqual(fromOpenFiles, [], "nothing may be attributed to the files when nothing was read");
});

// ── Detection without an editor ──────────────────────────────────────────────────────────────────

test("a caller with only paths reaches the same families", () => {
  // The terminal has no editor to ask, and the evaluation harness drives the terminal: without this
  // every figure in eval/QUALITY.md was measured with `general` alone, with every language skill
  // family switched off.
  assert.deepEqual(groupsForPaths(["billing/vat.py"]), ["python"]);
  assert.deepEqual(groupsForPaths(["src/Main.java", "src/lib.rs"]).sort(), ["java", "rust"]);
  assert.deepEqual(groupsForPaths(["src/app.tsx", "src/app.css"]).sort(), ["frontend", "javascript"]);
  assert.deepEqual(groupsForPaths(["Dockerfile"]), ["devops"]);
  assert.deepEqual(groupsForPaths(["notes.txt", "LICENSE"]), [], "an unknown extension may not guess");
});

test("every language the extension map produces is one detectGroups knows", () => {
  // The two halves are written separately and would drift apart in silence: an extension that maps to
  // a language no family keys on looks handled and detects nothing. That is the worst of the three
  // possible states, because it reads as support.
  const samples = [
    "a.html", "a.htm", "a.css", "a.scss", "a.less", "a.vue", "a.svelte",
    "a.js", "a.jsx", "a.mjs", "a.cjs", "a.ts", "a.tsx", "a.mts", "a.cts",
    "a.py", "a.java", "a.kt", "a.groovy", "a.cs", "a.fs", "a.vb",
    "a.c", "a.h", "a.cpp", "a.cc", "a.cxx", "a.hpp", "a.m", "a.mm",
    "a.go", "a.rs", "a.dart", "a.sql", "a.pls",
    "a.tf", "a.yaml", "a.yml", "a.sh", "a.bash",
    "Dockerfile", "Makefile",
  ];
  const orphans: string[] = [];
  for (const path of samples) {
    const id = languageIdForPath(path);
    assert.ok(id, `${path} is not in the extension map`);
    if (!detectGroups([id!]).length) orphans.push(`${path} -> ${id}`);
  }
  assert.deepEqual(orphans, [], `these map to a language no family keys on:\n${orphans.join("\n")}`);
});

test("every family keyed on an extension is reachable from a path", () => {
  // The other direction. `detectGroups` knows eleven families; the ones a file name can imply must
  // actually be implied by one, or a skill family exists that nothing but a settings page can switch on.
  const reachable = new Set(
    groupsForPaths([
      "a.css", "a.ts", "a.py", "a.java", "a.cs", "a.cpp", "a.go", "a.rs", "a.dart", "a.sql",
      "Dockerfile",
    ]),
  );
  for (const g of ["frontend", "javascript", "python", "java", "dotnet", "cpp", "go", "rust", "flutter", "data", "devops"]) {
    assert.ok(reachable.has(g as never), `the ${g} family cannot be reached from any file name`);
  }
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
  assert.ok(!names.some((n) => ["/a11y", "/junit", "/borrow", "/pytest"].includes(n)));
  assert.ok(names.length >= 8 && names.length <= 15, `general should be a handful, got ${names.length}`);
});

// ── The finance family, and the task behind each skill ───────────────────────────────────────────
//
// A skill is a few lines of text, so a family nobody can measure is a family nobody should count:
// every finance skill must name an evaluation task whose check fails before the work is done.

const financeSkills = BUILTIN_SKILLS.filter((s) => s.group === "finance");

test("every task a skill names exists on disk", () => {
  // The failure this catches is a renamed directory: the skill still points somewhere, and nothing
  // else in the repository would notice.
  const missing: string[] = [];
  for (const skill of BUILTIN_SKILLS) {
    if (!skill.evalTask) continue;
    if (!existsSync(join("eval", "tasks", skill.evalTask, "task.json"))) missing.push(`${skill.name} → ${skill.evalTask}`);
  }
  assert.deepEqual(missing, [], "these skills point at a task that is not there");
});

test("the finance family exists, is complete, and every skill in it is backed", () => {
  const finance = financeSkills;
  assert.ok(finance.length >= 7, `only ${finance.length}: ${finance.map((s) => s.name).join(" ")}`);
  // The subjects the roadmap names, each present.
  const names = finance.map((s) => s.name).join(" ");
  for (const subject of ["/rounding", "/decimal", "/settlement", "/markethours", "/identifiers", "/fixmsg"]) {
    assert.ok(names.includes(subject), `${subject} is missing from the finance family`);
  }
  // And every one of them names a task that exists — no gaps here: all of this is testable in
  // ordinary code.
  for (const skill of finance) {
    assert.ok(skill.evalTask, `${skill.name} is backed by nothing`);
    assert.ok(existsSync(join("eval", "tasks", skill.evalTask!, "task.json")), `${skill.name} → ${skill.evalTask}`);
  }
  // The roadmap asks for more than one language: the tasks behind this family span at least two.
  const kinds = new Set(
    finance.map((s) => {
      const files = readdirSync(join("eval", "tasks", s.evalTask!, "files"));
      if (files.some((f) => f.endsWith(".py"))) return "python";
      if (files.some((f) => f.endsWith(".js"))) return "javascript";
      return "other";
    }),
  );
  assert.ok(kinds.size >= 2, `the finance tasks span only ${[...kinds].join(", ")}`);
});
