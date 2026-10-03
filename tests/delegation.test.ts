// Delegation is not transitive (chantier 4.3).
//
// `toolsForAgent` returns EVERY available tool when a definition has no `tools:` line — and
// `run_agent` is one of them. So a sub-agent defined without a restriction could dispatch
// sub-agents, which could dispatch sub-agents. The width of each level is bounded by its step cap;
// the DEPTH was bounded by nothing, and no guard or test existed anywhere.
//
// The rule is the one the tool's own description already promises: "it works on its own and returns
// only its conclusion". A sub-agent is a leaf.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { BUILTIN_AGENTS, NEVER_DELEGATES, toolsForAgent, type AgentDefinition } from "../src/core/agent/definitions.js";

const AVAILABLE = ["read_file", "write_file", "run_command", "run_agent", "use_skill"];

const agent = (tools: string[]): AgentDefinition => ({
  kind: "agent",
  name: "helper",
  description: "d",
  tools,
  source: "test",
  body: "b",
});

test("an agent with no tool list does not inherit the power to delegate", () => {
  // The defect. "Whatever the mode allows" is the right default for reading and writing — a
  // definition file must not be able to grant itself a tool the mode does not offer — and it was the
  // wrong default for this one tool, because it is the only one that recurses.
  const granted = toolsForAgent(agent([]), AVAILABLE);
  assert.ok(granted.includes("write_file"), "an unrestricted agent still gets the mode's tools");
  assert.ok(!granted.includes("run_agent"), "a sub-agent must not be able to dispatch sub-agents");
});

test("and it cannot ask for it either", () => {
  // Asking explicitly is not an authorization: the intersection exists precisely so a definition
  // file that arrived with a cloned repository cannot grant itself something.
  assert.deepEqual(toolsForAgent(agent(["read_file", "run_agent"]), AVAILABLE), ["read_file"]);
});

test("the rule is one list, so a second recursive tool cannot be forgotten", () => {
  assert.ok(NEVER_DELEGATES.has("run_agent"));
  for (const name of NEVER_DELEGATES) {
    assert.ok(!toolsForAgent(agent([]), AVAILABLE).includes(name), name);
  }
});

test("no built-in agent wanted to delegate in the first place", () => {
  // Which is why this costs nothing: the four that ship are each a leaf by intent.
  for (const built of BUILTIN_AGENTS) {
    assert.ok(!built.tools.includes("run_agent"), `${built.name} lists run_agent`);
  }
});

test("a dispatch names the agent it dispatched", () => {
  // `callSignature` declared `run_agent: ["agent", "task"]` while the schema's parameter is `name`,
  // so the argument was never found, the fallback took `task`, and the step line showed the task
  // without ever saying WHICH agent received it. That is exactly the defect that file exists to
  // prevent: "somebody reviewing what an agent did to their repository needs the call".
  const source = readFileSync("src/core/agent/callSignature.ts", "utf8");
  assert.match(source, /run_agent: \["name", "task"\]/);
  const schema = readFileSync("src/extension/definitions.ts", "utf8");
  assert.match(schema, /name: \{ type: "string", enum: names/, "the schema still calls it `name`");
});

test("the terminal offers sub-agents, and theirs is a leaf too", () => {
  // Fourth forgotten half of this phase, after the plan tool, the spending caps and the skills —
  // and, as every time, it meant the evaluation harness could not measure delegation at all.
  const tools = readFileSync("src/cli/tools.ts", "utf8");
  assert.match(tools, /name: "run_agent"/);
  // Through the shared intersection, which subtracts NEVER_DELEGATES: a sub-agent dispatched from
  // the terminal must be exactly as much of a leaf as one dispatched from the panel.
  assert.match(tools, /toolsForAgent\(definition,/);
  // And the fan-out rule is the agents' property, not the client's: read-only may go at once.
  assert.match(tools, /const READ_ONLY_TOOLS = new Set\(/);

  const main = readFileSync("src/cli/main.ts", "utf8");
  assert.match(main, /agents: cliAgents/);
  // Redacted through the SAME vault as the main turn: a second notion of what is safe to send would
  // be a second answer to the question this product exists to answer.
  assert.match(main, /redactMessages\(messages, vault, \{/);
  // And it reads the repository's own definitions, with the parser from core.
  assert.match(main, /parseDefinition\("agent", join\(dir, name\), text\)/);
});
