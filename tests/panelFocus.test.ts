// Two things a rebuild must not take away: the cursor you are typing with, and the page following
// the answer as it is written.
//
// The panel redraws on any of sixty-odd state messages, almost none of which the user causes — a
// file saved, the caret moved in an editor, a model list arriving. Each redraw replaces the whole
// DOM, so anything that lives only in the DOM is lost unless it is explicitly carried across. The
// draft text and the caret position were carried. The FOCUS was not, so typing a question was
// interrupted by the box going dead under the keyboard: "the text area locks as if you had clicked
// somewhere else" — which is exactly what had happened.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("a model's reasoning is open while it is written and shut once the answer starts", () => {
  // Both halves of "when the model thinks, the chat does not go to the last message": a shut block
  // does not GROW, so while the model was thinking there was nothing for the panel to follow. And
  // once the answer starts, the same block is in the way of it.
  //
  // Which makes this a property of the TURN rather than a preference of the reader — the right
  // answer changes halfway through, by itself — so there is no setting, and the assertion is on the
  // one line that does it.
  const source = readFileSync("src/webview/main.ts", "utf8");
  const append = source.slice(source.indexOf("appendReasoning("), source.indexOf("setPlan("));
  assert.match(append, /reasoningBlock\("",\s*\{\s*open:\s*true/, "thinking is not shown while it is written");

  const answer = source.slice(source.indexOf("appendText(chunk: string)"), source.indexOf("How much of what has arrived"));
  assert.match(answer, /this\.foldThinking\(\)/, "the reasoning is not folded when the answer takes over");
  const fold = source.slice(source.indexOf("private foldThinking()"), source.indexOf("private foldThinking()") + 400);
  assert.match(fold, /folded/, "it folds on every token instead of once, so it cannot be reopened");
});

/**
 * Asserted on the source, because there is no DOM here to assert it on.
 *
 * This project ships with no runtime dependencies, jsdom included, so the panel's behaviour cannot
 * be exercised. What CAN be checked is that the two lines whose absence caused this are present —
 * which is worth more than it sounds: both defects were an omission, not a mistake, and an omission
 * is precisely what a reader does not see.
 */
test("the composer carries its focus across a rebuild", () => {
  const source = readFileSync("src/webview/chat.ts", "utf8");
  const capture = source.slice(source.indexOf("export function captureDraft"), source.indexOf("function composer("));
  assert.match(capture, /focused:\s*document\.activeElement === area/, "the draft does not record whether it had focus");
  assert.match(capture, /area\.focus\(/, "the draft is restored without its focus, so typing is interrupted by any redraw");
  assert.match(
    capture,
    /if \(draft\.focused/,
    "focus is restored unconditionally, which pulls the cursor out of the file being edited instead",
  );
});

test("reasoning arrives through the scroll-follow, like the answer does", () => {
  const source = readFileSync("src/webview/main.ts", "utf8");
  const method = source.slice(source.indexOf("appendReasoning("), source.indexOf("setPlan("));
  assert.match(method, /following\(/, "thinking is appended outside the follow, so the panel stays on the previous answer");
});
