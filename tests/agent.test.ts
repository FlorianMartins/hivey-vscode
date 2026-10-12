// The agent turn. These tests pin the contract the sidebar, the inline chat and the terminal
// client all depend on — above all, that nothing runs without permission and that a refusal is a
// conversation, not a crash.

import { test } from "node:test";
import assert from "node:assert/strict";
import { runTurn, type Tool } from "../src/core/agent/loop.js";
import { RecallStore, recallTools } from "../src/core/agent/recall.js";
import type { ChatRequest, ChatResult, Provider } from "../src/core/providers/types.js";

type Scripted = { text?: string; toolCalls?: Array<{ id: string; name: string; args: string }>; truncated?: boolean; reasoning?: string; interrupted?: boolean };

function scriptedProvider(script: Scripted[]): Provider & { seen: ChatRequest[] } {
  let i = 0;
  const seen: ChatRequest[] = [];
  return {
    id: "fake",
    baseUrl: "http://127.0.0.1:11434/v1",
    isLocal: true,
    seen,
    async chat(req, onDelta): Promise<ChatResult> {
      seen.push({ ...req, messages: req.messages.map((m) => ({ ...m })) });
      const s = script[Math.min(i++, script.length - 1)] ?? {};
      if (s.text) onDelta?.({ text: s.text });
      return {
        text: s.text ?? "",
        reasoning: s.reasoning ?? "",
        toolCalls: s.toolCalls ?? [],
        usage: { promptTokens: 10, completionTokens: 5, cachedTokens: 0 },
        stopReason: s.truncated ? "length" : s.toolCalls?.length ? "tool_calls" : "stop",
        ...(s.interrupted ? { interrupted: true } : {}),
      };
    },
    async listModels() {
      return [];
    },
  };
}

function tool(name: string, opts: Partial<Tool> = {}): Tool & { calls: Array<Record<string, unknown>> } {
  const calls: Array<Record<string, unknown>> = [];
  return {
    calls,
    schema: { name, description: name, parameters: { type: "object", properties: {} } },
    approval: opts.approval ?? (() => false),
    ...(opts.parallel ? { parallel: opts.parallel } : {}),
    run:
      opts.run ??
      (async (args) => {
        calls.push(args);
        return { content: `${name} ok` };
      }),
  } as Tool & { calls: Array<Record<string, unknown>> };
}

const base = { model: "m", messages: [{ role: "user" as const, content: "go" }] };

test("a turn without tool calls returns the answer", async () => {
  const provider = scriptedProvider([{ text: "here it is" }]);
  const r = await runTurn({ ...base, provider });
  assert.equal(r.text, "here it is");
  assert.equal(r.stoppedBecause, "answer");
  assert.equal(provider.seen.length, 1);
});

test("a tool call runs and its result comes back to the model", async () => {
  const readFile = tool("read_file");
  const provider = scriptedProvider([
    { toolCalls: [{ id: "c1", name: "read_file", args: '{"path":"a.ts"}' }] },
    { text: "the file defines add()" },
  ]);
  const r = await runTurn({ ...base, provider, tools: [readFile] });

  assert.deepEqual(readFile.calls[0], { path: "a.ts" });
  assert.equal(r.text, "the file defines add()");
  const second = provider.seen[1]!.messages;
  assert.equal(second[second.length - 1]!.role, "tool");
  assert.equal(second[second.length - 1]!.content, "read_file ok");
});

test("a dangerous tool does not run without approval", async () => {
  const run = tool("run_command", { approval: (a) => `run \`${a["cmd"]}\`` });
  const provider = scriptedProvider([
    { toolCalls: [{ id: "c1", name: "run_command", args: '{"cmd":"rm -rf /"}' }] },
    { text: "understood, I will not" },
  ]);
  const asked: string[] = [];
  const r = await runTurn({
    ...base,
    provider,
    tools: [run],
    approve: async (req) => {
      asked.push(req.description);
      return false;
    },
  });

  assert.deepEqual(asked, ["run `rm -rf /`"]);
  assert.equal(run.calls.length, 0, "the tool never ran");
  assert.equal(r.trace[0]!.approved, false);
  const told = provider.seen[1]!.messages.at(-1)!.content;
  assert.match(told, /declined/i, "the model is told, so it can offer something else");
  assert.equal(r.stoppedBecause, "answer");
});

test("with no approver at all, anything that needs approval is refused", async () => {
  const run = tool("run_command", { approval: () => "run something" });
  const provider = scriptedProvider([{ toolCalls: [{ id: "c1", name: "run_command", args: "{}" }] }, { text: "ok" }]);
  await runTurn({ ...base, provider, tools: [run] });
  assert.equal(run.calls.length, 0, "silence is not consent");
});

test("a tool that throws becomes an error result, not a failed turn", async () => {
  const broken = tool("read_file", {
    run: async () => {
      throw new Error("ENOENT");
    },
  });
  const provider = scriptedProvider([{ toolCalls: [{ id: "c1", name: "read_file", args: "{}" }] }, { text: "that file is gone" }]);
  const r = await runTurn({ ...base, provider, tools: [broken] });
  assert.match(provider.seen[1]!.messages.at(-1)!.content, /ENOENT/);
  assert.equal(r.text, "that file is gone");
});

test("malformed arguments are handed back to the model instead of crashing", async () => {
  const t = tool("read_file");
  const provider = scriptedProvider([{ toolCalls: [{ id: "c1", name: "read_file", args: "{not json" }] }, { text: "sorry" }]);
  await runTurn({ ...base, provider, tools: [t] });
  assert.match(provider.seen[1]!.messages.at(-1)!.content, /not valid JSON/);
  assert.equal(t.calls.length, 0);
});

test("an unknown tool is answered, never ignored", async () => {
  const provider = scriptedProvider([{ toolCalls: [{ id: "c1", name: "nope", args: "{}" }] }, { text: "ok" }]);
  await runTurn({ ...base, provider, tools: [] });
  const last = provider.seen[1]!.messages.at(-1)!;
  assert.equal(last.role, "tool");
  assert.match(last.content, /no tool called "nope"/);
  // With no tools at all, the answer says so rather than trailing off into an empty list — which
  // reads to a model like a broken harness rather than like an answer.
  assert.match(last.content, /no tools are available/);
});

test("an unknown tool that is nearly a real one is corrected rather than only refused", async () => {
  // Models invent plurals and synonyms constantly. A bare refusal costs a whole step to recover
  // from; naming the nearest real tool usually costs none.
  const real = tool("read_file");
  const provider = scriptedProvider([{ toolCalls: [{ id: "c1", name: "read_files", args: "{}" }] }, { text: "ok" }]);
  await runTurn({ ...base, provider, tools: [real] });
  assert.match(provider.seen[1]!.messages.at(-1)!.content, /Did you mean "read_file"/);
});

test("every call gets exactly one result, even when several arrive at once", async () => {
  const a = tool("a");
  const b = tool("b");
  const provider = scriptedProvider([
    {
      toolCalls: [
        { id: "c1", name: "a", args: "{}" },
        { id: "c2", name: "b", args: "{}" },
      ],
    },
    { text: "done" },
  ]);
  await runTurn({ ...base, provider, tools: [a, b] });
  const results = provider.seen[1]!.messages.filter((m) => m.role === "tool");
  assert.deepEqual(results.map((r) => r.toolCallId), ["c1", "c2"]);
});

test("the step budget stops a loop that will not end", async () => {
  const t = tool("a");
  const provider = scriptedProvider([{ toolCalls: [{ id: "c", name: "a", args: "{}" }] }]);
  const r = await runTurn({ ...base, provider, tools: [t], maxSteps: 3 });
  assert.equal(r.stoppedBecause, "max-steps");
  assert.equal(t.calls.length, 3);
});

test("with no step limit a long task runs to its end — past the old cap of thirty", async () => {
  // "remove that cap, the model has to be able to do what it is asked from A to Z".
  const t = tool("a");
  const long = Array.from({ length: 45 }, (_, i) => ({ toolCalls: [{ id: `c${i}`, name: "a", args: `{"n":${i}}` }] }));
  const provider = scriptedProvider([...long, { text: "all done" }]);
  const r = await runTurn({ ...base, provider, tools: [t], maxSteps: Infinity });
  assert.equal(r.stoppedBecause, "answer");
  assert.equal(t.calls.length, 45);
  assert.match(r.text, /all done/);
});

test("redaction happens on the way out and is undone on the way in", async () => {
  const provider = scriptedProvider([{ text: "the address ⟨EMAIL_1⟩ is invalid" }]);
  const r = await runTurn({
    provider,
    model: "m",
    messages: [{ role: "user", content: "check alice@corp.fr" }],
    beforeRequest: (msgs) => msgs.map((m) => ({ ...m, content: m.content.replace("alice@corp.fr", "⟨EMAIL_1⟩") })),
    afterResponse: (t) => t.replace("⟨EMAIL_1⟩", "alice@corp.fr"),
  });
  assert.equal(provider.seen[0]!.messages[0]!.content, "check ⟨EMAIL_1⟩", "the real address never left");
  assert.equal(r.text, "the address alice@corp.fr is invalid", "the user reads their own data");
});

test("a refusal in beforeRequest stops the turn instead of sending the original messages", async () => {
  // The rule this pins: when the gate says no — a secret the user would not release, a consent
  // dialog they closed — the safe path and the error path must not diverge. Falling back to the
  // unredacted messages would send the data precisely when the answer was "do not send it".
  const provider = scriptedProvider([{ text: "should never be reached" }]);
  await assert.rejects(
    () =>
      runTurn({
        ...base,
        provider,
        beforeRequest: () => {
          throw new Error("Envoi refusé");
        },
      }),
    /refusé/,
  );
  assert.equal(provider.seen.length, 0, "nothing was sent");
});

test("cancelling stops the turn between steps", async () => {
  const ctl = new AbortController();
  const t = tool("a", {
    run: async () => {
      ctl.abort();
      return { content: "ok" };
    },
  });
  const provider = scriptedProvider([{ toolCalls: [{ id: "c", name: "a", args: "{}" }] }]);
  const r = await runTurn({ ...base, provider, tools: [t], signal: ctl.signal, maxSteps: 5 });
  assert.equal(r.stoppedBecause, "cancelled");
  assert.equal(provider.seen.length, 1, "no request after the cancellation");
});

test("usage adds up across the steps of one turn", async () => {
  const t = tool("a");
  const provider = scriptedProvider([{ toolCalls: [{ id: "c", name: "a", args: "{}" }] }, { text: "done" }]);
  const r = await runTurn({ ...base, provider, tools: [t] });
  assert.equal(r.usage.promptTokens, 20);
  assert.equal(r.usage.completionTokens, 10);
});

// ── The breakpoint that moves ────────────────────────────────────────────────────────────────────
//
// Caching the system prompt caches the part that never grows. Everything a turn PRODUCES — the
// model's tool calls, the file it read, the output of the command it ran — is appended and sent
// again on the next step, and unmarked it is charged at full price every time: the cost of a
// twelve-step turn grows with the square of its length.

test("asked for it, each step marks the end of what it sent so the next starts from a cache hit", async () => {
  const t1 = tool("a");
  const provider = scriptedProvider([
    { toolCalls: [{ id: "c1", name: "a", args: "{}" }] },
    { toolCalls: [{ id: "c2", name: "a", args: "{}" }] },
    { text: "done" },
  ]);
  // Long enough to be worth caching: below a couple of thousand tokens a breakpoint is a 25 % write
  // premium on something that will never be read back.
  const big = "x ".repeat(4000);
  await runTurn({
    ...base,
    provider,
    tools: [t1],
    promptCache: true,
    messages: [{ role: "system", content: big, cacheable: true }],
  });

  for (const [step, sent] of provider.seen.entries()) {
    const last = sent.messages[sent.messages.length - 1]!;
    assert.equal(last.cacheable, true, `step ${step} did not mark the end of what it sent`);
  }
  // And the flag must not stick to the loop's own copy, or a twelve-step turn accumulates twelve
  // breakpoints — four is the most Anthropic accepts before refusing the request.
  const lastRequest = provider.seen[provider.seen.length - 1]!.messages;
  assert.ok(
    lastRequest.filter((m) => m.cacheable).length <= 2,
    `the marks accumulated: ${lastRequest.filter((m) => m.cacheable).length}`,
  );
});

test("nothing is marked unless it was asked for", async () => {
  // The default is the request shape that is known to work everywhere. See the providers tests for
  // what turning it on changes and what that cost.
  const provider = scriptedProvider([{ text: "ok" }]);
  const big = "x ".repeat(4000);
  await runTurn({ ...base, provider, messages: [{ role: "user", content: big }] });
  assert.ok(!provider.seen[0]!.messages.some((m) => m.cacheable));
});

test("a short request is not marked even when it is asked for, because the write costs more", async () => {
  // A title, a commit message, a classification: one short request, never repeated. Anthropic
  // charges 1.25× to store a prefix and a tenth to read it back, so marking one that is never read
  // is a straight 25 % penalty.
  const provider = scriptedProvider([{ text: "ok" }]);
  await runTurn({ ...base, provider, promptCache: true, messages: [{ role: "user", content: "write a commit message" }] });
  assert.ok(!provider.seen[0]!.messages.some((m) => m.cacheable));
});

// ── Running out of room is not the same as finishing ────────────────────────────────────────────
//
// The provider says which of the two happened, in `finish_reason`, and nothing read it — so an
// answer cut off mid-sentence and a complete one were indistinguishable to everything above. On a
// model that thinks before it answers the consequence is worse than a missing paragraph: the
// reasoning is charged against the same output budget, so a long think can consume all of it and
// the turn ends with a full block of thinking and no reply. Reported as "it only does the reasoning
// and gives no answer", and felt first in plan mode — the mode that asks the model to investigate
// before it writes.

test("a turn cut off by the output budget says so", () => {
  const provider = scriptedProvider([{ text: "As I was say", truncated: true }]);
  return runTurn({ ...base, provider, messages: [{ role: "user", content: "hello" }] }).then((result) => {
    assert.equal(result.truncated, true, "the turn claims to have finished when it was cut off");
  });
});

test("a turn that finished does not claim to have been cut off", () => {
  const provider = scriptedProvider([{ text: "All of it." }]);
  return runTurn({ ...base, provider, messages: [{ role: "user", content: "hello" }] }).then((result) => {
    assert.equal(result.truncated, false);
  });
});

test("⚠️ an agent reply cut off by the cap is continued, not taken for the answer", async () => {
  // "Here is the plan, then I'll get started:" — and the turn ended there: the plan, or the call it
  // announced, was lost to max_tokens and the loop returned the half-sentence as the answer.
  const write = tool("write_file");
  const provider = scriptedProvider([
    { text: "Voici le plan, puis j'attaque :", truncated: true },
    { toolCalls: [{ id: "1", name: "write_file", args: "{}" }] },
    { text: "Fait." },
  ]);
  const r = await runTurn({ ...base, provider, tools: [write] });
  assert.equal(write.calls.length, 1, "the call that was cut off is written again and run");
  assert.equal(r.stoppedBecause, "answer");
  assert.equal(r.truncated, false);
  const asked = provider.seen[1]!.messages.at(-1)!;
  assert.equal(asked.role, "user");
  assert.match(String(asked.content), /cut off by the output token limit/);
});

test("a cut where only the thinking was written is left to the caller's roomier retry", async () => {
  // Asking again at the same cap would be eaten the same way; the extension retries with four times
  // the room, and continuing here used to pre-empt it (caught by the integration suite).
  const provider = scriptedProvider([{ reasoning: "Thinking at length…", truncated: true }, { text: "never asked" }]);
  const r = await runTurn({ ...base, provider, tools: [tool("read_file")] });
  assert.equal(provider.seen.length, 1, "no continuation at the same budget");
  assert.equal(r.truncated, true);
  assert.equal(r.text, "");
});

test("continuing after a cut is bounded", async () => {
  // A model that writes past any cap must not spend the whole step budget doing it.
  const provider = scriptedProvider([{ text: "and on and on", truncated: true }]);
  const r = await runTurn({ ...base, provider, tools: [tool("read_file")] });
  assert.equal(provider.seen.length, 3, "one reply and two continuations, then it stops");
  assert.equal(r.truncated, true, "and says it was cut off");
});

test("the budget the caller asked for is the budget that is sent", () => {
  // The turn used a constant of 4 096 written at the call site, which is comfortable for a chat
  // reply and not enough for a reasoning model writing a plan. It is a setting now, and this is the
  // assertion that it reaches the provider rather than being decoration.
  const provider = scriptedProvider([{ text: "ok" }]);
  return runTurn({ ...base, provider, maxTokens: 12_345, messages: [{ role: "user", content: "hi" }] }).then(() => {
    assert.equal(provider.seen[0]!.maxTokens, 12_345);
  });
});

// ── The vault has to reach the tool arguments ───────────────────────────────────────────────────
//
// `vault.restore()` was applied to what the user READS — the answer, the reasoning — and not to what
// the tools DO. In agent mode against a remote endpoint that is the difference between an edit that
// lands and one that cannot: `write_file` writes the placeholder to disk, and `edit_file` looks for
// an excerpt containing `⟨HOST_1⟩` in a file that has the real host in it, and finds nothing.

test("a placeholder inside a tool call is the real value by the time the tool runs", async () => {
  const seen: Array<Record<string, unknown>> = [];
  const tool: Tool = {
    schema: { name: "write_file", description: "", parameters: { type: "object", properties: { path: { type: "string" }, body: { type: "string" } }, required: ["path"] } },
    approval: () => false,
    async run(args) {
      seen.push(args);
      return { content: "written" };
    },
  };
  const provider = scriptedProvider([
    { toolCalls: [{ id: "1", name: "write_file", args: JSON.stringify({ path: "a.ts", body: "connect(⟨HOST_1⟩)" }) }] },
    { text: "done" },
  ]);

  await runTurn({
    ...base,
    provider,
    tools: [tool],
    restoreArgs: (text) => text.replace("⟨HOST_1⟩", "db.internal.example"),
    messages: [{ role: "user", content: "write it" }],
  });

  assert.equal(seen[0]?.["body"], "connect(db.internal.example)", "the tool was handed a placeholder");
});

test("arguments the vault does not know are left exactly as they are", async () => {
  // A marker the model invented, or one the user typed themselves, is not a secret this vault hid:
  // substituting it would be inventing a value, and leaving it is the only honest answer.
  const seen: Array<Record<string, unknown>> = [];
  const tool: Tool = {
    schema: { name: "write_file", description: "", parameters: { type: "object", properties: { body: { type: "string" } } } },
    approval: () => false,
    async run(args) {
      seen.push(args);
      return { content: "ok" };
    },
  };
  const provider = scriptedProvider([
    { toolCalls: [{ id: "1", name: "write_file", args: JSON.stringify({ body: "⟨UNKNOWN_9⟩" }) }] },
    { text: "done" },
  ]);
  await runTurn({
    ...base,
    provider,
    tools: [tool],
    restoreArgs: (text) => text.replace("⟨HOST_1⟩", "db.internal.example"),
    messages: [{ role: "user", content: "write it" }],
  });
  assert.equal(seen[0]?.["body"], "⟨UNKNOWN_9⟩");
});

test("⚠️ a reply whose stream was cut is continued, in chat mode too", async () => {
  // "it cuts off in the middle sometimes" — the connection closed before the model finished. No
  // tools here: continuing a text has no side effect, so chat mode is continued as well.
  const provider = scriptedProvider([
    { text: "The first half of the answer", interrupted: true },
    { text: "and the end of it." },
  ]);
  const r = await runTurn({ ...base, provider });
  assert.equal(provider.seen.length, 2, "asked to continue once");
  assert.match(String(provider.seen[1]!.messages.at(-1)!.content), /interrupted before you finished/);
  assert.match(r.text, /The first half of the answer\s+and the end of it\./);
  assert.equal(r.interrupted, undefined, "the turn finished in the end");
});

test("continuing after an interruption is bounded, and the turn says it stayed interrupted", async () => {
  const provider = scriptedProvider([{ text: "again cut", interrupted: true }]);
  const r = await runTurn({ ...base, provider });
  assert.equal(provider.seen.length, 3, "one reply and two continuations, then it stops");
  assert.equal(r.interrupted, true);
});

test("⚠️ a turn that outgrows the context mid-way shortens old tool outputs and goes on", async () => {
  // "HTTP 400 Bad Request: request (69882 tokens) exceeds the available context size (69632
  // tokens)" — in the MIDDLE of an agent turn: tool results piled up and nothing trimmed them.
  const big = "line of a long build log\n".repeat(2000); // ~48 000 characters
  const read = tool("read_file", { run: async () => ({ content: big }) });
  let calls = 0;
  const seen: string[][] = [];
  const provider: Provider = {
    id: "fake",
    baseUrl: "http://127.0.0.1:11434/v1",
    isLocal: true,
    async chat(req): Promise<ChatResult> {
      calls++;
      seen.push(req.messages.filter((m) => m.role === "tool").map((m) => m.content));
      const toolChars = req.messages.filter((m) => m.role === "tool").reduce((n, m) => n + m.content.length, 0);
      if (calls <= 2) {
        return { text: "", reasoning: "", toolCalls: [{ id: `c${calls}`, name: "read_file", args: "{}" }], usage: { promptTokens: 1, completionTokens: 1, cachedTokens: 0 }, stopReason: "tool_calls" };
      }
      if (toolChars > 60_000) throw new Error("HTTP 400 Bad Request: request (69882 tokens) exceeds the available context size (69632 tokens), try increasing it");
      return { text: "Done, from what fitted.", reasoning: "", toolCalls: [], usage: { promptTokens: 1, completionTokens: 1, cachedTokens: 0 }, stopReason: "stop" };
    },
    async listModels() {
      return [];
    },
  };
  const r = await runTurn({ ...base, provider, tools: [read] });
  assert.equal(r.text, "Done, from what fitted.", "the turn finished instead of dying on the error");
  const last = seen.at(-1)!;
  assert.match(last[0]!, /characters of this output were removed to fit/, "the OLDEST output was shortened");
  assert.equal(last[1], big, "the latest output — the one the next step is about — is left whole");
});

test("⚠️ with the window known, the turn is fitted BEFORE it is sent — no error at all", async () => {
  // "we can't leave a limit like that": the server's refusal is the last line of defence, not the
  // mechanism. Knowing the window, the loop shortens old tool outputs before asking.
  const big = "line of a long build log\n".repeat(4000); // ~96 000 characters ≈ 24 000 tokens each
  const read = tool("read_file", { run: async () => ({ content: big }) });
  let calls = 0;
  let largest = 0;
  const provider: Provider = {
    id: "fake",
    baseUrl: "http://127.0.0.1:11434/v1",
    isLocal: true,
    async chat(req): Promise<ChatResult> {
      calls++;
      const chars = req.messages.reduce((n, m) => n + m.content.length, 0);
      largest = Math.max(largest, chars);
      if (chars / 4 > 69632) throw new Error("request (80000 tokens) exceeds the available context size (69632 tokens)");
      if (calls <= 3) {
        return { text: "", reasoning: "", toolCalls: [{ id: `c${calls}`, name: "read_file", args: "{}" }], usage: { promptTokens: 1, completionTokens: 1, cachedTokens: 0 }, stopReason: "tool_calls" };
      }
      return { text: "All read.", reasoning: "", toolCalls: [], usage: { promptTokens: 1, completionTokens: 1, cachedTokens: 0 }, stopReason: "stop" };
    },
    async listModels() {
      return [];
    },
  };
  const r = await runTurn({ ...base, provider, tools: [read], contextWindow: 69632 });
  assert.equal(r.text, "All read.");
  assert.ok(largest / 4 <= 69632 * 0.9, `a request of ~${Math.round(largest / 4)} tokens was sent`);
});

test("when nothing is left to shorten, the context error stands", async () => {
  const provider: Provider = {
    id: "fake",
    baseUrl: "http://127.0.0.1:11434/v1",
    isLocal: true,
    async chat(): Promise<ChatResult> {
      throw new Error("HTTP 400 Bad Request: request (80000 tokens) exceeds the available context size (69632 tokens)");
    },
    async listModels() {
      return [];
    },
  };
  await assert.rejects(runTurn({ ...base, provider }), /exceeds the available context size/);
});

test("⚠️ the same call repeated is not run again, and a model that insists is stopped", async () => {
  // "it's been going round in circles for 12 hours on one request": the same file read, the same
  // search run, the same answer each time — and only the step cap ever ended it.
  const read = tool("read_file", { parallel: () => true });
  const provider = scriptedProvider([{ toolCalls: [{ id: "1", name: "read_file", args: '{"path":"a.ts"}' }] }]);
  const r = await runTurn({ ...base, provider, tools: [read] });
  assert.equal(read.calls.length, 2, "run twice, then refused");
  assert.equal(r.stoppedBecause, "repeating", "the turn ends instead of spending all its steps");
  assert.ok(provider.seen.length <= 6, `${provider.seen.length} requests — it should stop early, not at 30`);
  const told = provider.seen.at(-1)!.messages.filter((m) => m.role === "tool").at(-1)!;
  assert.match(String(told.content), /already made this exact call/);
});

test("⚠️ the test run repeated after each fix is never blocked", async () => {
  // The legitimate repetition: an agent fixes, re-runs the same command, fixes again. A command can
  // change things, so it is not counted — and it resets the count of the reads around it.
  const run = tool("run_command");
  const provider = scriptedProvider([
    { toolCalls: [{ id: "1", name: "run_command", args: '{"command":"npm test"}' }] },
    { toolCalls: [{ id: "2", name: "run_command", args: '{"command":"npm test"}' }] },
    { toolCalls: [{ id: "3", name: "run_command", args: '{"command":"npm test"}' }] },
    { toolCalls: [{ id: "4", name: "run_command", args: '{"command":"npm test"}' }] },
    { text: "Green." },
  ]);
  const r = await runTurn({ ...base, provider, tools: [run] });
  assert.equal(run.calls.length, 4, "every run happened");
  assert.equal(r.text, "Green.");
});

test("the same tool with different arguments is never mistaken for a loop", async () => {
  const read = tool("read_file", { parallel: () => true });
  const provider = scriptedProvider([
    { toolCalls: [{ id: "1", name: "read_file", args: '{"path":"a.ts"}' }] },
    { toolCalls: [{ id: "2", name: "read_file", args: '{"path":"b.ts"}' }] },
    { toolCalls: [{ id: "3", name: "read_file", args: '{"path":"c.ts"}' }] },
    { toolCalls: [{ id: "4", name: "read_file", args: '{"path":"d.ts"}' }] },
    { text: "Read all four." },
  ]);
  const r = await runTurn({ ...base, provider, tools: [read] });
  assert.equal(read.calls.length, 4);
  assert.equal(r.text, "Read all four.");
});

test("⚠️ an output shortened to fit is kept whole, and recall gives it back word for word", async () => {
  // The memory with recall end to end: the window cannot hold both outputs, the first is shortened,
  // the model is told its id, asks for it, and gets the exact text back.
  const store = new RecallStore();
  const logA = Array.from({ length: 4000 }, (_, i) => `build step ${i} ok`).join("\n");
  const logB = Array.from({ length: 4000 }, (_, i) => `test ${i} passed`).join("\n");
  const run = tool("run_command", { run: async (args) => ({ content: String(args["command"]) === "build" ? logA : logB }) });
  let recalled = "";
  const tools = [run, ...recallTools(store, () => [])];
  let step = 0;
  const provider: Provider = {
    id: "fake",
    baseUrl: "http://127.0.0.1:11434/v1",
    isLocal: true,
    async chat(req): Promise<ChatResult> {
      step++;
      const usage = { promptTokens: 1, completionTokens: 1, cachedTokens: 0 };
      if (step === 1) return { text: "", reasoning: "", toolCalls: [{ id: "c1", name: "run_command", args: '{"command":"build"}' }], usage, stopReason: "tool_calls" };
      if (step === 2) return { text: "", reasoning: "", toolCalls: [{ id: "c2", name: "run_command", args: '{"command":"test"}' }], usage, stopReason: "tool_calls" };
      if (step === 3) {
        const cut = req.messages.find((m) => m.role === "tool" && m.toolCallId === "c1")!.content;
        const id = /recall \{"id":"(m\d+)"/.exec(cut)?.[1];
        assert.ok(id, `the shortened output does not say how to recall it:\n${cut.slice(-300)}`);
        return { text: "", reasoning: "", toolCalls: [{ id: "c3", name: "recall", args: JSON.stringify({ id, offset: 0, length: 20000 }) }], usage, stopReason: "tool_calls" };
      }
      recalled = req.messages.at(-1)!.content;
      return { text: "Done.", reasoning: "", toolCalls: [], usage, stopReason: "stop" };
    },
    async listModels() {
      return [];
    },
  };
  // A window that holds one log, not two: the first one has to be shortened.
  const r = await runTurn({ ...base, provider, tools, recall: store, contextWindow: 30_000 });
  assert.equal(r.text, "Done.");
  assert.ok(recalled.includes(logA.slice(0, 20000)), "recall returned the first 20 000 characters exactly");
});
