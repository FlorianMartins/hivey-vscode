// An answer as it happened: thinking and actions, then the words written there — step by step.
//
// « on a du mal à comprendre quelle réponse va avec quelle action et quel raisonnement sur les longues tâches ».

import { test } from "node:test";
import assert from "node:assert/strict";
import { SegmentBuilder } from "../src/core/session/segments.js";

test("a turn is cut where the model thinks or writes again after acting", () => {
  const b = new SegmentBuilder();
  b.reasoning("Read the banner code first.");
  b.text("Je regarde guilde.js.");
  b.acted();
  b.step({ tool: "read_file", summary: "'use strict';", ok: true, call: "public/guilde.js" });
  b.reasoning("The reload is in surveillerVersion.");
  b.acted();
  b.step({ tool: "edit_file", summary: "Edited public/guilde.js.", ok: true });
  b.text("C'est fait : le bandeau est retiré.");
  assert.deepEqual(b.segments, [
    // Written before the action it announces: its lead, drawn before it — not a comment after it.
    { reasoning: "Read the banner code first.", lead: "Je regarde guilde.js.", steps: [{ tool: "read_file", summary: "'use strict';", ok: true, call: "public/guilde.js" }] },
    { reasoning: "The reload is in surveillerVersion.", steps: [{ tool: "edit_file", summary: "Edited public/guilde.js.", ok: true }] },
    { text: "C'est fait : le bandeau est retiré." },
  ]);
});

test("streamed pieces of one thought or one paragraph stay together", () => {
  const b = new SegmentBuilder();
  b.reasoning("Read ");
  b.reasoning("first.");
  b.text("Je ");
  b.text("lis.");
  assert.deepEqual(b.segments, [{ reasoning: "Read first.", text: "Je lis." }]);
});
