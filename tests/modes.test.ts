// Modes, permissions, history: the three behaviours the new panel is built on. All of them live in
// core precisely so they can be tested here, in a millisecond, instead of by clicking.

import { test } from "node:test";
import assert from "node:assert/strict";
import { toolsForMode, promptForMode, MODES } from "../src/core/session/modes.js";
import { Permissions, MemoryPermissionStore, commandPrefix } from "../src/core/agent/permissions.js";
import { filterHistory, searchTranscript, excerptAround, normalise } from "../src/core/session/history.js";
import { Session, type SessionData } from "../src/core/session/session.js";
import type { Tool } from "../src/core/agent/loop.js";

function tool(name: string): Tool {
  return {
    schema: { name, description: name, parameters: { type: "object", properties: {} } },
    approval: () => false,
    run: async () => ({ content: "ok" }),
  };
}

const ALL = ["read_file", "list_files", "search_text", "get_diagnostics", "write_file", "edit_file", "run_command"].map(tool);

// ── Modes ────────────────────────────────────────────────────────────────────────────────────

test("chat mode has no tools at all", () => {
  assert.deepEqual(toolsForMode(ALL, "chat"), []);
});

test("plan mode can look but not touch", () => {
  const names = toolsForMode(ALL, "plan").map((t) => t.schema.name);
  assert.deepEqual(new Set(names), new Set(["read_file", "list_files", "search_text", "get_diagnostics"]));
  // The point of the restriction: it is code, not a sentence in a prompt.
  assert.ok(!names.includes("write_file"));
  assert.ok(!names.includes("run_command"));
});

test("agent mode keeps everything", () => {
  assert.equal(toolsForMode(ALL, "agent").length, ALL.length);
});

test("a tool that can read or write appears in plan mode only as its reading half", async () => {
  // The alternative designs are both bad: leave such a tool out and plan mode cannot query a
  // database, or leave it in whole and "plan mode changes nothing" becomes "…unless you click yes".
  let ran = "";
  const dual: Tool = {
    schema: { name: "run_sql", description: "sql", parameters: { type: "object", properties: {} } },
    approval: () => "run SQL",
    run: async (args) => { ran = String(args["q"]); return { content: "ok" }; },
    restrict() {
      return {
        ...dual,
        approval: () => false,
        run: async (args, ctx) =>
          String(args["q"]).startsWith("select") ? dual.run(args, ctx) : { content: "Refused.", isError: true },
      };
    },
  };

  const planned = toolsForMode([...ALL, dual], "plan");
  const restricted = planned.find((t) => t.schema.name === "run_sql");
  assert.ok(restricted, "the reading half is offered");
  assert.equal(restricted!.approval({}), false, "a read needs no dialog");

  const ctx = { report: () => {} };
  assert.equal((await restricted!.run({ q: "select 1" }, ctx)).content, "ok");
  const refused = await restricted!.run({ q: "delete from t" }, ctx);
  assert.equal(refused.isError, true, "plan mode refuses rather than asking");
  assert.equal(ran, "select 1", "the write never reached the real tool");
});

test("in agent mode the same tool is whole again", () => {
  const dual: Tool = {
    schema: { name: "run_sql", description: "sql", parameters: { type: "object", properties: {} } },
    approval: () => "run SQL",
    run: async () => ({ content: "ok" }),
    restrict() { return { ...dual, approval: () => false }; },
  };
  const agent = toolsForMode([dual], "agent").find((t) => t.schema.name === "run_sql");
  assert.equal(agent!.approval({}), "run SQL");
});

test("the integrations' read-only tools are in plan mode, their writing ones are not", () => {
  const names = [
    "git_status", "git_diff", "git_log", "git_blame", "git_show", "git_branches",
    "ibmi_member", "ibmi_members", "ibmi_objects", "ibmi_library_list",
    "git_commit", "git_stage", "git_branch", "ibmi_command",
  ].map(tool);
  const planned = new Set(toolsForMode(names, "plan").map((t) => t.schema.name));
  for (const allowed of ["git_status", "git_diff", "git_blame", "ibmi_member", "ibmi_objects"]) {
    assert.ok(planned.has(allowed), `${allowed} should be readable in plan mode`);
  }
  for (const refused of ["git_commit", "git_stage", "git_branch", "ibmi_command"]) {
    assert.ok(!planned.has(refused), `${refused} must not exist in plan mode`);
  }
});

test("a tool nobody allow-listed is powerless in plan mode", () => {
  const withNewTool = [...ALL, tool("delete_everything")];
  assert.ok(!toolsForMode(withNewTool, "plan").some((t) => t.schema.name === "delete_everything"));
});

test("each mode has its own prompt, and the plan one forbids changing anything", () => {
  const prompts = new Set(MODES.map((m) => promptForMode(m.id)));
  assert.equal(prompts.size, 3, "three modes, three prompts");
  assert.match(promptForMode("plan"), /cannot\s+change anything/i);
});

// ── Permissions ──────────────────────────────────────────────────────────────────────────────

test("by default everything that changes the machine is asked", () => {
  const p = new Permissions(new MemoryPermissionStore());
  assert.equal(p.decide("write_file", { path: "a.ts" }), "ask");
  assert.equal(p.allows("run_command", { command: "npm test" }), false);
});

test("a session grant lasts until the conversation ends", () => {
  const p = new Permissions(new MemoryPermissionStore());
  p.remember("write_file", { path: "a.ts" }, "session");
  assert.equal(p.allows("write_file", { path: "b.ts" }), true, "the shape is trusted, not the one path");
  p.clearSession();
  assert.equal(p.allows("write_file", { path: "b.ts" }), false, "a new conversation starts cautious");
});

test("a permanent rule is written to the store and survives", () => {
  const store = new MemoryPermissionStore();
  new Permissions(store).remember("edit_file", {}, "always");
  const fresh = new Permissions(store);
  assert.equal(fresh.allows("edit_file", {}), true);
});

test("trusting `npm test` does not trust `npm publish`", () => {
  const p = new Permissions(new MemoryPermissionStore());
  p.remember("run_command", { command: "npm test -- --watch=false" }, "always");
  assert.equal(p.allows("run_command", { command: "npm test" }), true);
  assert.equal(p.allows("run_command", { command: "npm publish" }), false, "a different subcommand is a different intent");
  assert.equal(p.allows("run_command", { command: "rm -rf /" }), false);
});

test("a refusal beats an authorisation, whichever was written first", () => {
  const p = new Permissions(new MemoryPermissionStore());
  p.remember("run_command", { command: "git push" }, "always");
  p.remember("run_command", {}, "never", true);
  assert.equal(p.decide("run_command", { command: "git push" }), "never");
});

test("the command prefix is the intent, not the whole line", () => {
  assert.equal(commandPrefix("npm run test -- --watch"), "npm run");
  assert.equal(commandPrefix("git commit -m 'x'"), "git commit");
  assert.equal(commandPrefix("ls -la /tmp"), "ls");
});

test("forgetting a rule brings the question back", () => {
  const p = new Permissions(new MemoryPermissionStore());
  p.remember("write_file", {}, "always");
  p.forget("write_file");
  assert.equal(p.decide("write_file", {}), "ask");
});

// ── History ──────────────────────────────────────────────────────────────────────────────────

const DAY = 86_400_000;
const NOW = new Date("2026-08-21T12:00:00").getTime();

function session(over: Partial<SessionData> & { id: string }): SessionData {
  const s = new Session({ createdAt: NOW, updatedAt: NOW, ...over });
  return s.toJSON();
}

const SESSIONS: SessionData[] = [
  session({
    id: "a",
    title: "Facturation TVA",
    updatedAt: NOW - 60_000,
    mode: "agent",
    entries: [
      { id: "1", role: "user", at: NOW, included: true, text: "la TVA est mal arrondie sur les factures" },
      { id: "2", role: "assistant", at: NOW, included: true, text: "il manque un arrondi au centime", usdCost: 0.012 },
    ],
  }),
  session({ id: "b", title: "Refactor du routeur", updatedAt: NOW - 3 * DAY, mode: "plan", entries: [
    { id: "3", role: "user", at: NOW, included: true, text: "comment découper ce routeur ?" },
  ] }),
  session({ id: "c", title: "Question rapide", updatedAt: NOW - 20 * DAY, mode: "chat", entries: [
    { id: "4", role: "user", at: NOW, included: true, text: "différence entre map et flatMap" },
  ] }),
];

test("by default the history is everything, newest first", () => {
  const rows = filterHistory(SESSIONS, {}, NOW);
  assert.deepEqual(rows.map((r) => r.id), ["a", "b", "c"]);
});

test("a period filter keeps only what it should", () => {
  assert.deepEqual(filterHistory(SESSIONS, { period: "today" }, NOW).map((r) => r.id), ["a"]);
  assert.deepEqual(filterHistory(SESSIONS, { period: "week" }, NOW).map((r) => r.id), ["a", "b"]);
  assert.equal(filterHistory(SESSIONS, { period: "month" }, NOW).length, 3);
});

test("filtering by mode answers “what did I ask it to plan”", () => {
  assert.deepEqual(filterHistory(SESSIONS, { mode: "plan" }, NOW).map((r) => r.id), ["b"]);
});

test("search looks inside the messages and says which fragment matched", () => {
  const rows = filterHistory(SESSIONS, { query: "arrondi" }, NOW);
  assert.deepEqual(rows.map((r) => r.id), ["a"]);
  assert.match(rows[0]!.excerpt!, /arrondi/);
});

test("search ignores case and accents, because nobody types them twice the same way", () => {
  assert.equal(normalise("Déployé"), "deploye");
  assert.equal(filterHistory(SESSIONS, { query: "FACTURATION" }, NOW).length, 1);
  assert.equal(filterHistory(SESSIONS, { query: "decouper" }, NOW).length, 1);
});

test("paid-only answers “which conversations cost money”", () => {
  const rows = filterHistory(SESSIONS, { paidOnly: true }, NOW);
  assert.deepEqual(rows.map((r) => r.id), ["a"]);
  assert.equal(rows[0]!.usdCost.toFixed(3), "0.012");
});

test("sorting by cost and by length reorders the same set", () => {
  assert.equal(filterHistory(SESSIONS, { sort: "cost" }, NOW)[0]!.id, "a");
  assert.equal(filterHistory(SESSIONS, { sort: "messages" }, NOW)[0]!.id, "a");
});

test("searching inside the open conversation returns the matching entries", () => {
  // "arrondie" contains "arrondi": a search inside a conversation matches word fragments, which is
  // what someone hunting for a half-remembered exchange actually wants.
  const matches = searchTranscript(SESSIONS[0]!, "arrondi");
  assert.deepEqual(matches.map((m) => m.entryId), ["1", "2"]);
  assert.equal(matches[0]!.count, 1);
  assert.deepEqual(searchTranscript(SESSIONS[0]!, "  "), [], "an empty query matches nothing");
});

test("an excerpt reads as a sentence, not as a word", () => {
  const text = "a".repeat(200) + " arrondi " + "b".repeat(200);
  const out = excerptAround(text, "arrondi");
  assert.ok(out.startsWith("…") && out.endsWith("…"));
  assert.ok(out.includes("arrondi"));
  assert.ok(out.length < 160);
});
