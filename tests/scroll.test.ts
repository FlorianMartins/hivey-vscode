// Following the answer while it is written.
//
// The rule reads as obvious and was implemented wrongly twice, both times in the same way: the
// panel asked "is the reader at the end?" after adding the text rather than before. These tests are
// written around that moment, because it is the only part of this anyone gets wrong.

import { test } from "node:test";
import assert from "node:assert/strict";
import { atEnd, placeAfterChange, STICK_TOLERANCE_PX } from "../src/core/ui/scroll.js";

/** A transcript `scrollHeight` tall in a 300 px panel, with the reader wherever `top` says. */
const view = (scrollHeight: number, scrollTop: number) => ({ scrollHeight, scrollTop, clientHeight: 300 });

test("at the end means at the end, give or take a line", () => {
  assert.ok(atEnd(view(600, 300)), "exactly at the bottom");
  assert.ok(atEnd(view(600, 300 - STICK_TOLERANCE_PX)), "a couple of lines up is still the bottom");
  assert.ok(!atEnd(view(600, 300 - STICK_TOLERANCE_PX - 1)), "one pixel further is not");
});

test("a reader at the end is carried to the new end", () => {
  assert.equal(placeAfterChange(view(600, 300), view(640, 300)), 640);
});

test("a reader who went up is left exactly where they are", () => {
  assert.equal(placeAfterChange(view(600, 120), view(640, 120)), undefined, "the next token pulled them back down");
});

/**
 * The defect itself, stated as a test.
 *
 * One frame of the typing animation adds a line or two — more than the tolerance the moment a code
 * block or a step row lands. Measured AFTERWARDS, a reader who has not moved at all is suddenly
 * "not at the end", and the follow stops for the rest of the answer. Measured before, they are
 * carried along. Same reader, same frame, opposite outcome.
 */
test("the answer depends on when it is asked, which is why it is asked first", () => {
  const before = view(600, 300);
  const after = view(680, 300); // 80 px of new text in one frame: over the tolerance

  assert.ok(atEnd(before), "the reader was at the end when the frame began");
  assert.ok(!atEnd(after), "and is not, once the text has grown under them");
  assert.equal(placeAfterChange(before, after), 680, "so the measurement that counts is the first one");
});

test("growth under the tolerance follows either way — which is why this hid for so long", () => {
  const before = view(600, 300);
  const after = view(620, 300);
  assert.ok(atEnd(after), "a small chunk keeps the reader nominally at the end");
  assert.equal(placeAfterChange(before, after), 620);
});
