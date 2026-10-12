// Verification during the turn, not only after it (chantier 4.4).
//
// A turn ended the moment the model stopped calling tools, and nothing asked whether the work had
// been checked. The product had two answers to "this looks unfinished" and both were expensive:
// tell the user, or escalate to a bigger, billed model. The cheap middle — ask the same model to
// finish what it started — did not exist. It usually can: it forgot, it did not fail.

import { test } from "node:test";
import assert from "node:assert/strict";
import { selfCheckMessage, type TurnStep } from "../src/core/router/outcome.js";

const step = (over: Partial<TurnStep> = {}): TurnStep => ({ tool: "read_file", ok: true, summary: "ok", ...over });
const edited = (path = "src/a.ts") => step({ tool: "edit_file", call: path, summary: `Edited ${path}.` });

test("a turn that changed something and checked nothing is asked to finish", () => {
  const message = selfCheckMessage([edited()]);
  assert.ok(message);
  // Evidence-shaped, not a question: "are you sure?" invites a model to reassure.
  assert.match(message!, /You changed something \(src\/a\.ts\)/);
  assert.match(message!, /nothing in this turn ran a test, a build, a compile or a linter/);
  // And it closes the escape hatch that would otherwise be taken: inventing a command.
  assert.match(message!, /do not invent a command/);
});

test("a turn that changed nothing is finished", () => {
  // Most turns. A question answered in prose has nothing to verify, and nudging it would turn every
  // short answer into two round trips.
  assert.equal(selfCheckMessage([]), undefined);
  assert.equal(selfCheckMessage([step(), step({ tool: "search_text" })]), undefined);
});

test("a turn that did check is left alone", () => {
  const checked = [edited(), step({ tool: "run_command", call: "npm test", summary: "ok" })];
  assert.equal(selfCheckMessage(checked), undefined);
  // Even when the check FAILED: that is a different problem, and `verifyTurn` already escalates on
  // it. Asking the model to run a check it has just run and watched fail would be noise.
  const failed = [edited(), step({ tool: "run_command", call: "npm test", ok: false, summary: "1 failing" })];
  assert.equal(selfCheckMessage(failed), undefined);
});

test("a change that did not take is not a change", () => {
  // A refused edit, a rejected diff: nothing happened, so there is nothing to verify.
  assert.equal(selfCheckMessage([step({ tool: "edit_file", ok: false, summary: "rejected" })]), undefined);
});

test("the files are named, and the list is bounded", () => {
  const many = Array.from({ length: 9 }, (_, i) => edited(`src/f${i}.ts`));
  const message = selfCheckMessage(many)!;
  assert.match(message, /src\/f0\.ts/);
  assert.ok(!message.includes("src/f6.ts"), "the list must not grow with the diff");
  // Deduplicated: editing one file four times is one file.
  const repeated = [edited("src/a.ts"), edited("src/a.ts"), edited("src/a.ts")];
  assert.equal(selfCheckMessage(repeated)!.match(/src\/a\.ts/g)?.length, 1);
});

// ── The mechanism, as opposed to the policy.

test("the loop asks once, spends a step, and drops the premature answer", async () => {
  // Three properties in one test because they are one decision. One nudge, because a second would be
  // an argument and a model that insists would make the step cap the only brake. It costs a step,
  // because it is a real round trip and real money. And the premature answer is dropped: it said the
  // work was done, the model is about to supersede it, and showing both reads as the assistant
  // contradicting itself two lines apart.
  const { runTurn } = await import("../src/core/agent/loop.js");
  const replies = [
    { text: "Done.", toolCalls: [] as Array<{ id: string; name: string; args: string }> },
    { text: "Ran the tests; they pass.", toolCalls: [] },
    { text: "Still done.", toolCalls: [] },
  ];
  let asked = 0;
  const provider = {
    id: "stub",
    async chat() {
      const reply = replies[Math.min(asked++, replies.length - 1)]!;
      return {
        text: reply.text,
        reasoning: "",
        toolCalls: reply.toolCalls,
        usage: { promptTokens: 1, completionTokens: 1, cachedTokens: 0 },
        stopReason: "stop" as const,
      };
    },
    async complete() {
      return "";
    },
    async listModels() {
      return [];
    },
  };

  const result = await runTurn({
    provider: provider as never,
    model: "m",
    messages: [{ role: "user", content: "fix it" }],
    tools: [],
    // Always willing to nudge, so that the ONCE-ONLY guard is the only thing that stops this. With
    // a policy that gives up by itself, the guard would be untested and the loop would be one bad
    // policy away from running to its step cap arguing with itself.
    selfCheck: () => "You changed something and ran no check.",
  });

  assert.equal(asked, 2, "asked once more, and once only");
  assert.equal(result.text, "Ran the tests; they pass.", "the premature answer is gone");
  assert.equal(result.stoppedBecause, "answer");
});

test("no self-check means the turn ends exactly as it did before", async () => {
  // The mechanism is opt-in from the caller, so a client that passes nothing — a sub-agent, a
  // one-shot — behaves identically to before this existed.
  const { runTurn } = await import("../src/core/agent/loop.js");
  let asked = 0;
  const provider = {
    id: "stub",
    async chat() {
      asked++;
      return {
        text: "Done.",
        reasoning: "",
        toolCalls: [],
        usage: { promptTokens: 1, completionTokens: 1, cachedTokens: 0 },
        stopReason: "stop" as const,
      };
    },
    async complete() {
      return "";
    },
    async listModels() {
      return [];
    },
  };
  const result = await runTurn({ provider: provider as never, model: "m", messages: [], tools: [] });
  assert.equal(asked, 1);
  assert.equal(result.text, "Done.");
});

test("both halves ask, and by the same rule", () => {
  const { readFileSync } = require("node:fs") as typeof import("node:fs");
  for (const file of ["src/extension/chat.ts", "src/cli/main.ts"]) {
    const source = readFileSync(file, "utf8");
    assert.match(source, /selfCheck: \(trace\) =>/, `${file} never asks`);
    assert.match(source, /selfCheckMessage\(/, `${file} has its own idea of unfinished`);
  }
});

test("whether the self-check fired is recorded, because the chantier could not be judged without it", () => {
  // The bench showed no improvement — 48/56 before, 47/56 after, and the figure it was meant to move
  // unchanged — and the honest next question was "did it ever fire?", which nothing could answer.
  // Arguing about that instead of measuring it is the failure this phase exists against.
  const { readFileSync } = require("node:fs") as typeof import("node:fs");
  assert.match(readFileSync("src/core/agent/loop.ts", "utf8"), /selfChecked: boolean;/);
  // Recorded only when it fired: `false` on every turn is a column of noughts saying nothing.
  assert.match(readFileSync("src/cli/main.ts", "utf8"), /result\.selfChecked \? \{ selfChecked: true \} : \{\}/);
});
