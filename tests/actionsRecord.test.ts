// What an earlier answer did, handed back to the model — see `actionsRecord` in core/session/segments.ts.

import { test } from "node:test";
import assert from "node:assert/strict";
import { Session } from "../src/core/session/session.js";

const opts = { systemPrompt: "You are a coding assistant.", maxTokens: 4000, nonce: "N0NCE" };

test("an earlier answer carries what the model did, not only what it said — a stopped one too", () => {
  const s = new Session();
  s.add({ role: "user", text: "center the ornaments" });
  const a = s.add({ role: "assistant", text: "I'll adjust the CSS." });
  a.segments = [
    { reasoning: "look first", steps: [{ tool: "read_file", call: "src/page.js", summary: "'use strict';", ok: true }] },
    {
      steps: [
        { tool: "edit_file", call: "src/page.css", summary: "src/page.css edited.", ok: true },
        { tool: "run_command", call: "npm test", summary: "exit code 1", ok: false },
      ],
    },
  ];
  s.add({ role: "user", text: "did you stop?" });
  const sent = s.build(opts).messages.find((m) => m.role === "assistant")!.content;
  assert.match(sent, /- read_file src\/page\.js → 'use strict';\n- edit_file src\/page\.css → src\/page\.css edited\.\n- run_command npm test → FAILED: exit code 1\]/);
  assert.ok(sent.endsWith("I'll adjust the CSS."));
});

test("the steps saved without segments are used, and an answer that ran nothing is sent as before", () => {
  const s = new Session();
  s.add({ role: "user", text: "q" });
  const a = s.add({ role: "assistant", text: "" });
  a.steps = [{ tool: "list_files", call: "src/**", summary: "src/a.js", ok: true }];
  s.add({ role: "assistant", text: "plain" });
  const msgs = s.build(opts).messages.filter((m) => m.role === "assistant");
  assert.match(msgs[0]!.content, /^\[Your actions during this answer[^\n]*\n- list_files src\/\*\* → src\/a\.js\]$/);
  assert.equal(msgs[1]!.content, "plain");
});
