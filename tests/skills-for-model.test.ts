// The built-in skills were invisible to the model (chantier 4.2).
//
// Eighty-five of them — forty for IBM i, eight for finance, every one backed by an evaluation task
// that fails before it is applied — were reachable ONLY by a user typing the right slash command.
// Somebody who does not know `/packed` exists never benefits from it, which made a whole axis of
// this product's expertise conditional on knowing a magic word.
//
// ⚠️ And the premise of this chantier as first written was wrong: it said eighty-five skills sat in
// the prompt costing tokens and diluting attention. They were not in the prompt at all. The
// repository's own skills already used progressive disclosure, with the reasoning written in
// `skillsPrompt`. What was missing was the opposite of what I assumed.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { BUILTIN_SKILLS, builtinSkillsForModel } from "../src/core/session/skills.js";
import { skillsPrompt } from "../src/core/agent/definitions.js";

test("a built-in skill becomes a skill the model can be offered", () => {
  const packed = BUILTIN_SKILLS.find((sk) => sk.name === "/packed");
  assert.ok(packed, "the finance family should still have /packed");
  const [offered] = builtinSkillsForModel([packed!]);
  assert.equal(offered?.kind, "skill");
  assert.equal(offered?.name, "/packed");
  assert.equal(offered?.description, packed!.hint);
  assert.equal(offered?.body, packed!.prompt);
  assert.equal(offered?.source, "built in");
});

test("a skill that is an action on the conversation is not offered", () => {
  // `/compact` has no instructions to read. Offering it would let the model announce something it
  // cannot do, which is the same defect as describing a switched-off skill.
  const actions = BUILTIN_SKILLS.filter((sk) => sk.action && !sk.prompt);
  assert.ok(actions.length, "there is at least one action skill to exclude");
  assert.deepEqual(builtinSkillsForModel(actions), []);
});

test("the prompt carries names and one line, never the instructions", () => {
  // The whole point of progressive disclosure, and the property that keeps the prefix affordable.
  const offered = builtinSkillsForModel(BUILTIN_SKILLS.filter((sk) => sk.prompt).slice(0, 5));
  const prompt = skillsPrompt(offered);
  for (const skill of offered) {
    assert.ok(prompt.includes(skill.name), skill.name);
    assert.ok(prompt.includes(skill.description), skill.description);
    assert.ok(!prompt.includes(skill.body), `${skill.name}'s instructions are in the prefix`);
  }
  assert.match(prompt, /call `use_skill`/);
});

test("the panel offers only what the user switched on", () => {
  // A skill that is off must not be described either: the model would announce something the user
  // cannot invoke. Read from the source, because this is a claim about a filter at a call site.
  const chat = readFileSync("src/extension/chat.ts", "utf8");
  assert.match(chat, /settings\.skills\.groups\.includes\(sk\.group\)/);
  assert.match(chat, /isSkillEnabled\(sk\.name, settings\.skills\.disabled\)/);
  // And a repository skill of the same name wins, because the team that wrote one meant theirs.
  assert.match(chat, /!definitions\.skills\.some\(\(sk\) => skillInvocation\(sk\.name\) === b\.name\)/);
});

test("the terminal offers them too, so the harness can measure them", () => {
  // Same forgotten half as the plan tool and the spending caps: the terminal had no skills at all,
  // and the evaluation harness drives the terminal.
  const main = readFileSync("src/cli/main.ts", "utf8");
  assert.match(main, /skillsPrompt\(cliSkills\)/);
  assert.match(main, /builtinSkillsForModel\(/);
});

test("every offered skill has something to read", () => {
  // A name in the prompt whose `use_skill` returns nothing is worse than an absent skill: the model
  // spends a turn on it and learns nothing.
  for (const skill of builtinSkillsForModel([...BUILTIN_SKILLS])) {
    assert.ok(skill.body.trim().length > 20, `${skill.name} has almost no instructions`);
    assert.ok(skill.description.trim().length > 0, `${skill.name} has no description`);
  }
});
