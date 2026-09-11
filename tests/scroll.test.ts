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

// ── Being left alone while the document grows over your head ─────────────────────────────────────
//
// The second defect, and the harder one to see: "leave the reader alone" was implemented as "do not
// touch scrollTop", which is not the same thing. An agent turn writes its step lines and its plan
// ABOVE the answer text, so every tool that runs inserts rows over the reader's head. Their pixel
// offset from the top is unchanged and the content at that offset is not — so the transcript drifts
// upward into older messages, by itself, while they are reading.

test("content inserted above the reader moves them with it, so the glass does not change", () => {
  const before = view(2000, 800);
  // Two step rows, 120 px, landed above the viewport: everything the reader sees moved down.
  const after = view(2120, 800);
  const place = placeAfterChange(before, after, { before: 900, after: 1020 });
  assert.equal(place, 920, "the reader should have been moved down by exactly what was inserted above");
});

test("content that grows BELOW the reader does not move them", () => {
  // The answer itself getting longer is the ordinary case, and it must not shift anybody: the
  // anchor at the top of their viewport has not moved.
  const before = view(2000, 800);
  const after = view(2400, 800);
  assert.equal(placeAfterChange(before, after, { before: 900, after: 900 }), undefined);
});

test("content removed above the reader moves them back up by the same amount", () => {
  // Deleting an earlier exchange, or a plan block collapsing.
  const place = placeAfterChange(view(2000, 800), view(1880, 800), { before: 900, after: 780 });
  assert.equal(place, 680);
});

test("compensation never computes a position past the last scrollable pixel", () => {
  // More was inserted above the reader than there is room to move down into. The arithmetic wants
  // 1600 + 400 = 2000; the last position this content can be scrolled to is 2200 − 300 = 1900.
  // Handing the browser 2000 would have it clamp to the end anyway, so the clamp is done here where
  // it can be reasoned about rather than discovered.
  const place = placeAfterChange(view(2000, 1600), view(2200, 1600), { before: 1700, after: 2100 });
  assert.equal(place, 1900);
});

test("a reader at the end still follows, anchor or no anchor", () => {
  // Following wins over compensating: someone at the bottom asked to be at the bottom.
  assert.equal(placeAfterChange(view(600, 300), view(900, 300), { before: 100, after: 400 }), 900);
});

test("without an anchor the old behaviour is unchanged", () => {
  // Every caller that has nothing above the reader to anchor against — an empty transcript, a
  // mutation at the very top — keeps the two-outcome contract.
  assert.equal(placeAfterChange(view(2000, 800), view(2120, 800)), undefined);
});
