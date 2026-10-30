// When to stop listening — see core/dictation/silence.ts.

import { test } from "node:test";
import assert from "node:assert/strict";
import { SilenceDetector } from "../src/core/dictation/silence.js";

/** Feed readings every 120 ms; the time it said stop, or undefined. */
function run(readings: number[], silenceMs = 1500): number | undefined {
  const d = new SilenceDetector({ silenceMs });
  for (let i = 0; i < readings.length; i++) if (d.push(readings[i]!, i * 120)) return i * 120;
  return undefined;
}
const repeat = (v: number, n: number) => Array.from({ length: n }, () => v);

test("speech, then quiet: it stops once the quiet has lasted the delay", () => {
  // A quiet room (0.004), two seconds of voice (0.08), then quiet again.
  const at = run([...repeat(0.004, 6), ...repeat(0.08, 17), ...repeat(0.004, 30)]);
  assert.ok(at !== undefined, "it never stopped");
  const quietFrom = (6 + 17) * 120;
  assert.ok(at! - quietFrom >= 1500 && at! - quietFrom < 1500 + 240, `stopped ${at! - quietFrom} ms into the quiet`);
});

test("nothing ends before a voice was heard: thinking before speaking keeps the recording", () => {
  assert.equal(run(repeat(0.004, 100)), undefined);
});

test("a short pause in the middle of a sentence does not end it", () => {
  const at = run([...repeat(0.004, 6), ...repeat(0.08, 10), ...repeat(0.004, 6), ...repeat(0.08, 10), ...repeat(0.004, 30)]);
  const secondQuiet = (6 + 10 + 6 + 10) * 120;
  assert.ok(at !== undefined && at >= secondQuiet + 1500, "the 0.7 s pause ended it");
});

test("a noisy room: its noise is learned, and a voice above it still counts", () => {
  // A fan at 0.03 — above the absolute floor — and a voice at 0.15.
  const at = run([...repeat(0.03, 6), ...repeat(0.15, 15), ...repeat(0.03, 30)]);
  assert.ok(at !== undefined, "the voice over the fan was not heard, or the fan was taken for a voice");
  assert.equal(run(repeat(0.03, 100)), undefined, "the fan alone is not a voice");
});

test("a recording with no voice in it is known as such — and one with too little read is not judged", () => {
  // Noise with no voice is where the recogniser invents (`*musique*`, `[bruits de la salle]`).
  const quiet = new SilenceDetector({ silenceMs: 1500 });
  for (let i = 0; i < 40; i++) quiet.push(0.004, i * 120);
  assert.equal(quiet.heardNothing, true);
  const spoken = new SilenceDetector({ silenceMs: 1500 });
  [...repeat(0.004, 6), ...repeat(0.08, 10), ...repeat(0.004, 10)].forEach((r, i) => spoken.push(r, i * 120));
  assert.equal(spoken.heardNothing, false);
  // A recorder that writes its file only at the end sent nothing: transcribe it as before.
  assert.equal(new SilenceDetector({ silenceMs: 1500 }).heardNothing, false);
});
