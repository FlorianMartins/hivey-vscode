// What a request is waiting for, said while it waits.
//
// "when two work at the same time … avoid the feeling of waiting with nothing happening".

import { test } from "node:test";
import assert from "node:assert/strict";
import { waitLabel, WaitWatch, type WaitLabel } from "../src/core/agent/waiting.js";

test("a short wait says nothing, a long one says what it is", () => {
  const base = { serverReportsProgress: true, started: false };
  assert.deepEqual(waitLabel({ ...base, elapsedMs: 800 }), { kind: "none" }, "no flicker on every step");
  // « le modèle n'est utilisé par personne et dit en file d'attente »: an idle server takes 2–3 s to
  // prepare a long new conversation before its first progress. That is not a queue.
  assert.deepEqual(waitLabel({ ...base, elapsedMs: 2700 }), { kind: "waiting", seconds: 2 }, "preparing is not queueing");
  assert.deepEqual(waitLabel({ ...base, elapsedMs: 7900 }), { kind: "waiting", seconds: 7 });
  assert.deepEqual(waitLabel({ ...base, elapsedMs: 9200 }), { kind: "queued", seconds: 9 }, "a long silence on a progress server is the queue");
  assert.deepEqual(
    waitLabel({ ...base, serverReportsProgress: false, elapsedMs: 4200 }),
    { kind: "waiting", seconds: 4 },
    "a server that never reports progress cannot tell a queue from a slow prompt",
  );
  assert.deepEqual(waitLabel({ ...base, elapsedMs: 9000, started: true }), { kind: "none" }, "the answer has started");
});

test("reading a long conversation is a percentage, a short or cached one is nothing", () => {
  const base = { serverReportsProgress: true, started: false, elapsedMs: 5000 };
  assert.deepEqual(waitLabel({ ...base, progress: { total: 70_000, cache: 0, processed: 35_000 } }), { kind: "reading", percent: 50 });
  assert.deepEqual(
    waitLabel({ ...base, progress: { total: 70_000, cache: 69_900, processed: 69_950 } }),
    { kind: "none" },
    "restored from the cache: nothing worth a percentage",
  );
  assert.deepEqual(waitLabel({ ...base, progress: { total: 600, cache: 0, processed: 100 } }), { kind: "none" });
});

test("the watch follows a request: queued, then read, then answered — and says each once", () => {
  let now = 0;
  const shown: WaitLabel[] = [];
  let reports = false;
  const watch = new WaitWatch((l) => shown.push(l), () => reports, () => (reports = true), () => now);
  watch.request();
  now = 2500;
  watch.delta({});
  watch.delta({ progress: { total: 50_000, cache: 0, processed: 10_000 } });
  watch.delta({ progress: { total: 50_000, cache: 0, processed: 10_000 } });
  watch.delta({ reasoning: "…" });
  watch.stop();
  assert.deepEqual(shown, [
    { kind: "none" },
    { kind: "waiting", seconds: 2 },
    { kind: "reading", percent: 20 },
    { kind: "none" },
  ]);
  assert.equal(reports, true, "the server is now known to report progress — its next silence is a queue");
});
