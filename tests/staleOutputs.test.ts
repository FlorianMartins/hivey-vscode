// Out-of-date file contents go first when a turn has to be fitted — see `shrinkToolOutputs`.

import { test } from "node:test";
import assert from "node:assert/strict";
import { shrinkToolOutputs, staleFileOutputs } from "../src/core/agent/loop.js";
import type { ChatMessage } from "../src/core/providers/types.js";

const call = (id: string, name: string, path: string): ChatMessage => ({
  role: "assistant",
  content: "",
  toolCalls: [{ id, name, args: JSON.stringify({ path }) }],
});
const out = (id: string, content: string): ChatMessage => ({ role: "tool", toolCallId: id, content });

test("a read is out of date once its file is read again or changed later in the turn", () => {
  const msgs = [call("1", "read_file", "a.js"), out("1", "x"), call("2", "read_file", "./b.js"), out("2", "x"), call("3", "edit_file", "a.js"), out("3", "ok"), call("4", "read_file", "b.js"), out("4", "x")];
  assert.deepEqual([...staleFileOutputs(msgs)].sort(), ["1", "2"]);
});

test("⚠️ fitting the window drops the old version of an edited file before cutting anything current", () => {
  const big = "const x = 1;\n".repeat(2000);
  const msgs: ChatMessage[] = [
    { role: "user", content: "fix it" },
    call("1", "read_file", "page.css"),
    out("1", big),
    call("2", "read_file", "other.js"),
    out("2", big),
    call("3", "edit_file", "page.css"),
    out("3", "Edited page.css."),
    call("4", "read_file", "page.css"),
    out("4", big),
  ];
  assert.ok(shrinkToolOutputs(msgs, 3000));
  assert.match(msgs[2]!.content, /^\[Outdated, removed to fit/);
  assert.equal(msgs[4]!.content, big, "the only copy of other.js is left whole while the stale one was enough");
  assert.equal(msgs[8]!.content, big);
});
