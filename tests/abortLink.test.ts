// The bridge between a caller's cancellation and one request's own controller.

import { test } from "node:test";
import assert from "node:assert/strict";
import { linkAbort } from "../src/core/util/http.js";

test("aborting the caller aborts every request made under it", () => {
  const parent = new AbortController();
  const a = new AbortController();
  const b = new AbortController();
  linkAbort(parent.signal, a);
  linkAbort(parent.signal, b);

  parent.abort(new Error("stopped by the user"));
  assert.equal(a.signal.aborted, true);
  assert.equal(b.signal.aborted, true);
});

test("one listener per signal, however many requests it carries", () => {
  // Twenty steps of an agent turn share one signal. A listener each would trip Node's "possible
  // EventTarget memory leak" warning at eleven, which is a real message in a real user's log.
  const parent = new AbortController();
  let added = 0;
  const original = parent.signal.addEventListener.bind(parent.signal);
  parent.signal.addEventListener = ((...args: Parameters<typeof original>) => {
    added += 1;
    return original(...args);
  }) as typeof original;

  for (let i = 0; i < 20; i++) linkAbort(parent.signal, new AbortController());
  assert.equal(added, 1);
});

test("a request that is already over is not cancelled later", () => {
  // The unlink is what a finished request calls. Without it the set would keep every controller of
  // the turn alive until the turn ended.
  const parent = new AbortController();
  const done = new AbortController();
  const unlink = linkAbort(parent.signal, done);
  unlink();

  parent.abort();
  assert.equal(done.signal.aborted, false);
});

test("a caller who has already given up cancels immediately", () => {
  // The window between "the user pressed stop" and "the next request goes out" is small and real:
  // an agent turn fires its next call the moment a tool returns.
  const parent = new AbortController();
  parent.abort(new Error("too late"));
  const child = new AbortController();
  linkAbort(parent.signal, child);
  assert.equal(child.signal.aborted, true);
});
