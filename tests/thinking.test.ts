// The provider's thinking by default; the prompted kind only where there is none.
//
// Florian: « pour le mode de raisonnement je veux utiliser celui du fournisseur par defaut et pas
// forcer celui de deepseek sur tous, le mode de reflexion deepseek doit etre uniquement sur les
// modeles par defaut sans raisonnement ». These tests are that sentence, made unbreakable.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  effortToSend,
  promptedThinking,
  THINK_CLOSE,
  THINK_OPEN,
  thinkingMode,
  thinkingSplitter,
  splitThinkingText,
} from "../src/core/router/thinking.js";

test("a model that reasons natively is never given the prompted block", () => {
  // The provider's own thinking is trained, protocol-separated from the answer, and not billed
  // twice. Asking such a model to ALSO deliberate in the prompt makes it think twice, pay for both,
  // and spend the answer budget competing with its own reasoning.
  assert.equal(thinkingMode("anthropic/claude-sonnet-5.5", "high"), "native");
  assert.equal(thinkingMode("deepseek/deepseek-v4.1-flash", "medium"), "native");
});

test("a model with no native thinking gets the prompted block", () => {
  // Nothing in the catalogue and no family word: a plain model. This is the only place the
  // DeepSeek-style harness belongs.
  assert.equal(thinkingMode("mistralai/codestral-latest", "medium"), "prompted");
});

test("no thinking asked for means neither mechanism runs", () => {
  // `none` is the user's decision, not an absence of information. A prompted block they turned off
  // would spend their answer budget on deliberation they declined.
  assert.equal(thinkingMode("anthropic/claude-sonnet-5.5", "none"), "off");
  assert.equal(thinkingMode("mistralai/codestral-latest", "none"), "off");
});

test("an effort is never sent to a model that cannot use it", () => {
  // ⚠️ The live defect. The reasoning control is HIDDEN when the model cannot reason, but the stored
  // preference survives a model change — so switching from a reasoning model to a plain one went on
  // sending `effort: "high"` to an endpoint with no idea what to do with it. Hidden in the UI is not
  // the same as not sent.
  assert.equal(effortToSend("mistralai/codestral-latest", "high"), "none");
  assert.equal(effortToSend("anthropic/claude-sonnet-5.5", "high"), "high");
  assert.equal(effortToSend("anthropic/claude-sonnet-5.5", "none"), "none");
});

test("the prompted instruction scales its length with the effort, and allows skipping", () => {
  // The entire cost of prompted thinking is answer budget, so "think as long as you like" at low
  // effort is a turn that reasons and never answers. And a model obliged to deliberate about
  // renaming a variable burns tokens to reach the obvious.
  assert.match(promptedThinking("low"), /two or three sentences/);
  assert.match(promptedThinking("high"), /as long as it takes/);
  assert.match(promptedThinking("medium"), /skip the block entirely/);
  assert.equal(promptedThinking("none"), "");
});

test("the splitter routes the block to reasoning and the rest to the answer", () => {
  const s = thinkingSplitter();
  const out = s.push(`${THINK_OPEN}weighing it up${THINK_CLOSE}The answer.`);
  assert.equal(out.reasoning, "weighing it up");
  assert.equal(out.text, "The answer.");
  assert.deepEqual(s.flush(), {});
});

test("a delimiter split across chunks is still a delimiter", () => {
  // The whole job. A delimiter arrives cut in half often enough that handling it IS the feature, and
  // a splitter that only works on whole tokens shows `<<<THINKING>>>` to the user.
  const s = thinkingSplitter();
  const seen = { text: "", reasoning: "" };
  for (const chunk of ["<<<THINK", "ING>>>first I ", "check<<<ANS", "WER>>>Done."]) {
    const out = s.push(chunk);
    seen.text += out.text ?? "";
    seen.reasoning += out.reasoning ?? "";
  }
  const last = s.flush();
  seen.text += last.text ?? "";
  seen.reasoning += last.reasoning ?? "";
  assert.equal(seen.reasoning, "first I check");
  assert.equal(seen.text, "Done.");
});

test("a turn with no block is pure answer, with no lag left behind", () => {
  const s = thinkingSplitter();
  const out = s.push("Just the answer, no deliberation.");
  const rest = s.flush();
  assert.equal((out.text ?? "") + (rest.text ?? ""), "Just the answer, no deliberation.");
  assert.equal(out.reasoning ?? rest.reasoning, undefined);
});

test("an unterminated block is reasoning, never the answer", () => {
  // ⚠️ A model that opened the block and ran out of budget produced working-out. Showing it as the
  // reply would present deliberation as a conclusion — worse than showing nothing, because the user
  // cannot tell.
  const s = thinkingSplitter();
  const out = s.push(`${THINK_OPEN}I am still think`);
  // What is held back at flush time is only ever the tail that could still have become a delimiter;
  // the rest streams as it arrives. So the property to assert is where the WHOLE block lands.
  const rest = s.flush();
  assert.equal((out.reasoning ?? "") + (rest.reasoning ?? ""), "I am still think");
  assert.equal(out.text ?? rest.text, undefined, "an unfinished deliberation must not become the reply");
});

test("a half-written closing delimiter is held, then released as reasoning", () => {
  // The flush path that actually holds something: `<<<ANS` could still become `<<<ANSWER>>>`, so it
  // waits — and when the stream ends instead, it was reasoning all along.
  const s = thinkingSplitter();
  const out = s.push(`${THINK_OPEN}weighed it<<<ANS`);
  const rest = s.flush();
  assert.equal((out.reasoning ?? "") + (rest.reasoning ?? ""), "weighed it<<<ANS");
  assert.equal(out.text ?? rest.text, undefined);
});

test("text that merely looks like a delimiter is not one", () => {
  const s = thinkingSplitter();
  const out = s.push("Use <<<THINK as a marker.");
  const rest = s.flush();
  assert.equal((out.text ?? "") + (rest.text ?? ""), "Use <<<THINK as a marker.");
  assert.equal(out.reasoning ?? rest.reasoning, undefined);
});

test("the saved answer never keeps the deliberation", () => {
  // ⚠️ The provider hands back the RAW reply at the end of a turn, block included, and the saved
  // answer is taken from that field rather than from what was streamed. Without splitting it too,
  // the block was stripped from the screen and written back into the transcript — visible on
  // reopening, and re-sent to the model on the next turn as though it were the answer.
  const whole = splitThinkingText(`${THINK_OPEN}let me check the types${THINK_CLOSE}Use a guard clause.`);
  assert.equal(whole.text, "Use a guard clause.");
  assert.equal(whole.reasoning, "let me check the types");
});

test("a reply with no block comes back untouched", () => {
  const whole = splitThinkingText("Just an answer.");
  assert.equal(whole.text, "Just an answer.");
  assert.equal(whole.reasoning, "");
});
