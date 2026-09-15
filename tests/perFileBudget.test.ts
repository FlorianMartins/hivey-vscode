// How much of one attached file is kept, which follows the context budget AND how many files there
// are. The second half was missing, and two files open with a large budget produced a question
// estimated at 468 726 tokens.

import { test } from "node:test";
import assert from "node:assert/strict";
import { perFileBudget, ATTACHMENT_CEILING_TOKENS } from "../src/core/util/tokens.js";

test("one file may take most of a small budget, because the conversation is about it", () => {
  assert.equal(perFileBudget(8_000), 4_800);
  assert.equal(perFileBudget(32_000), ATTACHMENT_CEILING_TOKENS);
});

test("a model-sized budget keeps model-sized files, up to the attachment ceiling", () => {
  // The complaint that produced the fraction in the first place: every file attached from the
  // editor came back "(truncated)", because a 4 000-token cap survived into a window two hundred
  // times its size. So the share still grows with the budget —
  assert.ok(perFileBudget(200_000) >= 8_000, "a big budget must still keep big files");
  // — but not without end. The budget is a ceiling on the conversation and was being read as a
  // target for each file in it: "a prompt plus two files, 234 000 tokens". Past the ceiling the
  // overflow is sent as the file's outline, which says more per token than its first N lines.
  assert.equal(perFileBudget(1_000_000), ATTACHMENT_CEILING_TOKENS);
  assert.equal(perFileBudget(400_000, 2), ATTACHMENT_CEILING_TOKENS);
});

test("what is attached TOGETHER is what is bounded", () => {
  // The defect. Each file was given two fifths of the budget with no idea how many there were, so
  // two files asked for four fifths of it and three for more than all of it.
  for (const budget of [8_000, 32_000, 200_000, 1_000_000]) {
    for (const files of [1, 2, 3, 5]) {
      const total = perFileBudget(budget, files) * files;
      // Three fifths, or the per-file floor when even that is more — the floor is the one
      // documented way past the share, and the next test is about it.
      const allowed = Math.max(budget * 0.6, 1_000 * files);
      assert.ok(
        total <= allowed + files,
        `${files} files on a ${budget} budget ask for ${total} tokens, which is more than the three ` +
          `fifths they are allowed — and more than the question and the answer leave room for`,
      );
    }
  }
});

test("the ceiling can be lifted by whoever is paying for the tokens", () => {
  // The answer to "is there a way to bring this down?" is a lever, not a number I chose for
  // everybody: `hiveyCode.context.attachmentTokens`, with 0 meaning whole files.
  assert.equal(perFileBudget(400_000, 2, 0), 120_000);
  assert.equal(perFileBudget(400_000, 2, 4_000), 4_000);
});

test("a file attached on purpose always says something", () => {
  // The floor, and the one case where the three fifths may be exceeded: eight files at a thousand
  // tokens each is a better answer than two files at four thousand. `Session.build` trims what will
  // not fit, which is the right place for that decision.
  assert.ok(perFileBudget(8_000, 20) >= 1_000);
  assert.ok(perFileBudget(1_000, 1) >= 1_000);
});
