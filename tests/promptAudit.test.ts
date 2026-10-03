// Exactly what left the machine.
//
// The ledger answers "what has left over time" and deliberately never holds content. Nobody could
// answer "what, literally, did you just send?" — the question somebody asks once before trusting
// the thing, and again the first time an answer is strange.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { renderPromptAudit, type PromptAudit } from "../src/core/audit/prompt.js";

const audit = (over: Partial<PromptAudit> = {}): PromptAudit => ({
  at: Date.UTC(2026, 9, 3, 12, 0, 0),
  model: "gpt-6.1-sol-pro",
  host: "openrouter.ai",
  isLocal: false,
  messages: [
    { role: "system", content: "You are a coding assistant." },
    { role: "user", content: "Fix ⟨EMAIL_1⟩'s bug" },
  ],
  tools: ["read_file", "edit_file"],
  redactions: "EMAIL×1",
  ...over,
});

test("the audit says it is the form that left, not the original", () => {
  // The whole point. Showing the pre-redaction text would say the client's name went out when a
  // marker went out — a worse lie than showing nothing.
  const md = renderPromptAudit(audit());
  assert.match(md, /pseudonymized form — the form that actually left/);
  assert.match(md, /⟨EMAIL_1⟩/);
  assert.match(md, /Substituted: EMAIL×1/);
});

test("a local endpoint is said to be verbatim, because it is", () => {
  const md = renderPromptAudit(audit({ isLocal: true, host: "127.0.0.1:11434", redactions: "" }));
  assert.match(md, /nothing was pseudonymized/);
  assert.ok(!/pseudonymized form/.test(md), "it must not claim a redaction that did not happen");
});

test("nothing substituted is said, rather than left blank", () => {
  const md = renderPromptAudit(audit({ redactions: "" }));
  assert.match(md, /Nothing matched a pattern/);
});

test("a prompt full of backticks does not break the page showing it", () => {
  // The failure that would hide what the audit was opened to show: three backticks inside the
  // content end the fence early, and the rest of the document renders as prose.
  const nasty = "here is a fence:\n```js\nconst a = 1;\n```\nand ````four```` too";
  const md = renderPromptAudit(audit({ messages: [{ role: "user", content: nasty }] }));
  const opener = /^(`{5,})$/m.exec(md);
  assert.ok(opener, "the fence must be longer than the longest run inside");
  // And the content survives intact.
  assert.ok(md.includes(nasty));
});

test("images are named as the thing redaction cannot touch", () => {
  const md = renderPromptAudit(audit({ messages: [{ role: "user", content: "look", images: 2 }] }));
  assert.match(md, /2 image\(s\) — not shown, and not redactable/);
});

test("the audit promises no storage, and the code keeps that promise", () => {
  const md = renderPromptAudit(audit());
  assert.match(md, /Nothing here is stored/);
  // A promise in prose is worth nothing without the property. The renderer is pure: it must not be
  // able to write anywhere.
  const source = readFileSync("src/core/audit/prompt.ts", "utf8");
  for (const forbidden of ["node:fs", "writeFile", "appendFile", "fetch(", "require("]) {
    assert.ok(!source.includes(forbidden), `the audit renderer must not reach for ${forbidden}`);
  }
});

test("each message carries its size, because the total explains nothing", () => {
  const md = renderPromptAudit(audit());
  assert.match(md, /## 1\. system — ~\d+ tokens/);
  assert.match(md, /## 2\. user — ~\d+ tokens/);
});
