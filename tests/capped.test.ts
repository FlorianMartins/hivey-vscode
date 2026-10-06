// Saying when a result was cut short.
//
// A search that returns sixty matches of two hundred and does not say so has told the model there
// are sixty. It then reasons about a complete picture it does not have, which is worse than an error
// because nothing looks wrong. The same defect in `read_file` sent a real session chasing `sed`.

import { test } from "node:test";
import assert from "node:assert/strict";
import { cappedAt, describeCap } from "../src/core/agent/capped.js";

test("a result under the cap says nothing at all", () => {
  // A note on every call is noise that teaches the model to skip the notes that matter.
  assert.equal(describeCap(cappedAt(12, 60), "matches", "Narrow the pattern."), "");
});

test("a result at the cap says so, and says what to do", () => {
  const said = describeCap(cappedAt(60, 60), "matches", "Narrow the pattern or pass a glob.");
  assert.match(said, /stopped at 60 matches/);
  assert.match(said, /probably more/);
  assert.match(said, /Narrow the pattern or pass a glob\./);
});

test("the remedy is in the model's own vocabulary, not ours", () => {
  // "Use a more specific query" tells a model nothing it can act on. The name of the argument does.
  const said = describeCap(cappedAt(300, 300), "files", "Pass a narrower `glob`, or raise `limit`.");
  assert.match(said, /`glob`/);
  assert.match(said, /`limit`/);
});

test("exactly at the cap counts as capped", () => {
  // ⚠️ A collector that stops when it reaches the cap cannot tell "exactly sixty" from "sixty of two
  // hundred". Claiming completeness on the boundary is the one answer that can be confidently wrong,
  // so the boundary belongs on the cautious side.
  assert.equal(cappedAt(60, 60).hitCap, true);
  assert.equal(cappedAt(59, 60).hitCap, false);
});
