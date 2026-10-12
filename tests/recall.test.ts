// Memory with recall: what slid out of the context window comes back word for word.
//
// "a 64k context is too small to work with — it's fine for chat, not for agent and code mode".

import { test } from "node:test";
import assert from "node:assert/strict";
import { RecallStore, recallTools, searchMemory } from "../src/core/agent/recall.js";

test("an output is kept whole, once, and the oldest go first past the limit", () => {
  const store = new RecallStore(30);
  const a = store.put("0123456789", "read_file a.ts");
  assert.equal(store.put("0123456789", "read_file a.ts"), a, "the same output is kept once");
  const b = store.put("abcdefghij", "read_file b.ts");
  const c = store.put("ABCDEFGHIJ", "read_file c.ts");
  assert.ok(store.get(a) && store.get(b) && store.get(c));
  store.put("klmnopqrst", "read_file d.ts"); // 40 > 30: the oldest goes
  assert.equal(store.get(a), undefined);
  assert.equal(store.get(c)?.text, "ABCDEFGHIJ");
});

test("recall gives the text back word for word, in pieces for a long one", async () => {
  const store = new RecallStore();
  const long = Array.from({ length: 3000 }, (_, i) => `line ${i}`).join("\n");
  const id = store.put(long, "run_command npm test");
  const [recall] = recallTools(store, () => []);
  const first = await recall!.run({ id }, { report: () => {} } as never);
  assert.match(first.content, new RegExp(`characters 0–8000 of ${long.length}`));
  assert.ok(first.content.includes(long.slice(0, 8000)), "the first piece is exact");
  assert.match(first.content, new RegExp(`recall \\{"id":"${id}","offset":8000\\}`), "and says how to continue");
  const next = await recall!.run({ id, offset: 8000, length: 20000 }, { report: () => {} } as never);
  assert.ok(next.content.includes(long.slice(8000, 28000)), "the next piece is exact too");
  const last = await recall!.run({ id, offset: 28000, length: 20000 }, { report: () => {} } as never);
  assert.ok(last.content.endsWith(long.slice(28000)), "and the last piece ends where the text ends");
  assert.doesNotMatch(last.content, /more characters/, "with nothing left to ask for");
  const unknown = await recall!.run({ id: "m999" }, { report: () => {} } as never);
  assert.equal(unknown.isError, true);
  assert.match(unknown.content, /search_memory/);
});

test("search_memory finds a passage in kept outputs and in the conversation's own turns", async () => {
  const store = new RecallStore();
  store.put("…\nfunction computeVat(amount) { return amount * 0.2 }\n…", "read_file src/tax.ts");
  const [, search] = recallTools(store, () => [
    { label: "user message #1", text: "The VAT rate in Belgium is 21 percent, not 20." },
  ]);
  const hits = (await search!.run({ query: "vat" }, { report: () => {} } as never)).content;
  assert.match(hits, /read_file src\/tax\.ts — recall \{"id":"m1"/, "a kept output, with how to recall it");
  assert.match(hits, /user message #1/, "and an earlier message no longer in the window");
  assert.match(searchMemory("nothing like this", [{ label: "x", text: "abc" }]), /Nothing in memory matches/);
});
