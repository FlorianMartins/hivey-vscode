// User-defined skills and sub-agents.
//
// The parser is forgiving about layout and strict about identity, and the tests below are mostly
// about that line. A file written by hand has CRLF, stray blank lines, quotes nobody needed and a
// colon inside a sentence; none of that should stop it working. A name that cannot be typed after a
// slash should, because the failure otherwise happens later and looks like the skill not existing.
//
// The last group is the one that matters most: a definition file arrives with a cloned repository,
// so its `tools:` line is a REQUEST, never a grant.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  agentTemplate,
  parseDefinition,
  skillTemplate,
  skillsPrompt,
  toolsForAgent,
  type AgentDefinition,
  type Skill,
} from "../src/core/agent/definitions.js";

const skill = (text: string) => parseDefinition("skill", "review.md", text);
const agent = (text: string) => parseDefinition("agent", "db.md", text);

// ── Reading a file ───────────────────────────────────────────────────────────────────────────

test("a plain skill is read", () => {
  const { definition, problems } = skill(`---
name: review-rpg
description: Review an RPG member against the shop's conventions
---

Check the indicators first, then the file specs.
`);
  assert.deepEqual(problems, []);
  assert.equal(definition?.kind, "skill");
  assert.equal(definition?.name, "review-rpg");
  assert.equal((definition as Skill).description, "Review an RPG member against the shop's conventions");
  assert.match(definition!.body, /^Check the indicators/);
});

test("the things a hand-written file actually contains do not break it", () => {
  // CRLF, quoted values, a colon inside a sentence, blank lines, no trailing newline.
  const { definition, problems } = skill(
    '---\r\nname: "commit-style"\r\n\r\ndescription: \'Our format: subject, blank line, why\'\r\n---\r\n\r\nBody here.',
  );
  assert.deepEqual(problems, []);
  assert.equal(definition?.name, "commit-style");
  assert.equal((definition as Skill).description, "Our format: subject, blank line, why");
});

test("a description folded over several lines is read as one", () => {
  const { definition } = skill(`---
name: long
description:
  Use this when the member is fixed-format RPG
  and the change touches a file specification.
---
Body.
`);
  assert.match((definition as Skill).description, /fixed-format RPG and the change touches/);
});

test("a comment in the header is a comment", () => {
  const { definition, problems } = skill(`---
# our team's review checklist
name: review
description: Review a change
---
Body.
`);
  assert.deepEqual(problems, []);
  assert.equal(definition?.name, "review");
});

// ── Refusing a file ──────────────────────────────────────────────────────────────────────────

test("a file with no header is refused, and says what a header looks like", () => {
  const { definition, problems } = skill("Just some prose with no header at all.\n");
  assert.equal(definition, undefined);
  assert.match(problems[0]!, /no header/);
  assert.match(problems[0]!, /---/, "the message has to show the shape, not just name the problem");
});

test("a name that cannot be typed after a slash is refused", () => {
  for (const bad of ["Review RPG", "reviewRPG", "réviser", "a", "-lead", "trail-", "x".repeat(45)]) {
    const { definition, problems } = skill(`---\nname: ${bad}\ndescription: d\n---\nbody\n`);
    assert.equal(definition, undefined, `"${bad}" should be refused`);
    assert.ok(problems.some((p) => p.includes("usable name")), `"${bad}": ${problems.join(" ")}`);
  }
});

test("a missing description is refused, because it is what makes the skill findable", () => {
  const { problems } = skill(`---\nname: review\n---\nbody\n`);
  assert.ok(problems.some((p) => /description/.test(p)));
});

test("a header with nothing under it is refused", () => {
  const { problems } = skill(`---\nname: review\ndescription: d\n---\n\n   \n`);
  assert.ok(problems.some((p) => /no instructions/.test(p)));
});

test("every problem names the file, because they are reported in a list", () => {
  const { problems } = parseDefinition("skill", ".hiveycode/skills/x.md", "nonsense");
  assert.ok(problems.every((p) => p.startsWith(".hiveycode/skills/x.md:")));
});

// ── Sub-agents ───────────────────────────────────────────────────────────────────────────────

test("an agent carries its tools, its model and its step budget", () => {
  const { definition, problems } = agent(`---
name: db-explorer
description: Explores Db2 for i schemas
tools: ibmi_sql, ibmi_objects, read_file
model: qwen2.5-coder:7b
max-steps: 6
---
You explore schemas.
`);
  assert.deepEqual(problems, []);
  const a = definition as AgentDefinition;
  assert.deepEqual(a.tools, ["ibmi_sql", "ibmi_objects", "read_file"]);
  assert.equal(a.model, "qwen2.5-coder:7b");
  assert.equal(a.maxSteps, 6);
});

test("a tool list is read however it was written", () => {
  const forms = ["a, b, c", "[a, b, c]", "a b c", '"a", "b", "c"'];
  for (const form of forms) {
    const { definition } = agent(`---\nname: probe\ndescription: d\ntools: ${form}\n---\nbody\n`);
    assert.deepEqual((definition as AgentDefinition).tools, ["a", "b", "c"], form);
  }
});

test("an absurd step budget is refused rather than clamped", () => {
  // Clamping would run something other than what the file says, silently. The author asked for 500
  // steps; they should be told that is not on offer, not given 50 and left to wonder.
  for (const bad of ["0", "500", "many"]) {
    const { definition, problems } = agent(`---\nname: probe\ndescription: d\nmax-steps: ${bad}\n---\nbody\n`);
    assert.equal(definition, undefined, bad);
    assert.ok(problems.some((p) => /max-steps/.test(p)));
  }
});

// ── The rule that is not the user's to change ────────────────────────────────────────────────

test("an agent's tools are an intersection with the mode, never a union", () => {
  // The point of the whole design. A definition file arrives with a cloned repository; treating its
  // `tools:` line as an authorisation would let a file grant itself `run_command` in plan mode, and
  // the mode would become a suggestion rather than a guarantee.
  const definition = agent(`---
name: probe
description: d
tools: read_file, run_command, write_file
---
body
`).definition as AgentDefinition;

  const inPlanMode = toolsForAgent(definition, ["read_file", "list_files", "search_text"]);
  assert.deepEqual(inPlanMode, ["read_file"], "run_command was asked for and is not on offer");

  const inAgentMode = toolsForAgent(definition, ["read_file", "run_command", "write_file", "edit_file"]);
  assert.deepEqual(inAgentMode, ["read_file", "run_command", "write_file"]);
});

test("an agent with no tool list gets what the mode allows and nothing more", () => {
  const definition = agent(`---\nname: probe\ndescription: d\n---\nbody\n`).definition as AgentDefinition;
  assert.deepEqual(toolsForAgent(definition, ["read_file", "list_files"]), ["read_file", "list_files"]);
  assert.deepEqual(toolsForAgent(definition, []), [], "chat mode has no tools, so neither does its sub-agent");
});

// ── What the model is told ───────────────────────────────────────────────────────────────────

test("the prompt lists skills by name and description, never their instructions", () => {
  const skills: Skill[] = [
    { kind: "skill", name: "a", description: "does A", body: "SECRET INSTRUCTIONS A", source: "a.md" },
    { kind: "skill", name: "b", description: "does B", body: "SECRET INSTRUCTIONS B", source: "b.md" },
  ];
  const prompt = skillsPrompt(skills);
  assert.match(prompt, /- a: does A/);
  assert.match(prompt, /- b: does B/);
  // A dozen skills' full text in every prompt would spend the context budget before the question.
  assert.ok(!prompt.includes("SECRET INSTRUCTIONS"), "instructions are fetched on demand, not broadcast");
});

test("no skills means no block at all, not an empty heading", () => {
  assert.equal(skillsPrompt([]), "");
});

test("the templates are valid definitions, not forms to fill in", () => {
  // A template that does not parse is a trap: the user edits it, it fails, and the failure looks
  // like their edit.
  const s = parseDefinition("skill", "t.md", skillTemplate("my-skill"));
  assert.deepEqual(s.problems, []);
  assert.equal(s.definition?.name, "my-skill");

  const a = parseDefinition("agent", "t.md", agentTemplate("my-agent"));
  assert.deepEqual(a.problems, []);
  assert.equal(a.definition?.name, "my-agent");
  assert.deepEqual((a.definition as AgentDefinition).tools, ["read_file", "list_files", "search_text"]);
});
