// Every panel level, on every provider and model family: what the request really carries.
//
// « je veux vraiment que quand on bascule le mode de réflexion qu'il change vraiment le niveau de
// réflexion sur tous les modèles cloud et locaux ou gateway ». Each row below is a rule the vendor
// documents — see the citations in src/core/providers/reasoningMap.ts.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { anthropicFamily, anthropicThinking, effortFor, profileFor, reasoningMenu } from "../src/core/providers/reasoningMap.js";
import { AnthropicProvider } from "../src/core/providers/anthropic.js";
import { adaptRequest, OpenAICompatibleProvider } from "../src/core/providers/openai.js";
import { GENERATED_REASONING_EFFORTS } from "../src/core/router/reasoningEfforts.generated.js";
import type { ChatRequest, ReasoningEffort } from "../src/core/providers/types.js";

const LEVELS: ReasoningEffort[] = ["none", "low", "medium", "high"];

/** One request to a throwaway server; returns the body it received. */
async function bodyOf(kind: "anthropic" | string, req: Partial<ChatRequest> & { model: string }, baseUrlPath = "/v1"): Promise<any> {
  let got: any;
  const server: Server = createServer((r, res) => {
    let raw = "";
    r.on("data", (c) => (raw += c));
    r.on("end", () => {
      if (r.url?.endsWith("/api/version")) {
        res.writeHead(404).end();
        return;
      }
      got ??= JSON.parse(raw || "{}");
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      if (kind === "anthropic") {
        res.write(`data: ${JSON.stringify({ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } })}\n\n`);
        res.write(`data: ${JSON.stringify({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "ok" } })}\n\n`);
        res.write(`data: ${JSON.stringify({ type: "message_delta", delta: { stop_reason: "end_turn" } })}\n\n`);
      } else {
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: "ok" }, finish_reason: "stop" }] })}\n\n`);
        res.write("data: [DONE]\n\n");
      }
      res.end();
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}${baseUrlPath}`;
  const provider =
    kind === "anthropic"
      ? new AnthropicProvider({ baseUrl: url, apiKey: "k" })
      : new OpenAICompatibleProvider({ id: kind, baseUrl: url, isLocal: kind === "local", apiKey: "k" });
  try {
    await provider.chat({ messages: [{ role: "user", content: "hi" }], ...req });
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
  return got;
}

// ── Anthropic ───────────────────────────────────────────────────────────────────────────────────

test("Anthropic: model ids are read into families, whatever the spelling", () => {
  const f = (id: string) => {
    const x = anthropicFamily(id);
    return `${x.tier} ${x.version.join(".")} ${x.style}`;
  };
  assert.equal(f("claude-opus-5-5"), "opus 5.5 adaptive");
  assert.equal(f("claude-fable-5-1"), "fable 5.1 adaptive");
  assert.equal(f("claude-fable-5"), "fable 5.0 adaptive");
  assert.equal(f("anthropic.claude-opus-4-8"), "opus 4.8 adaptive", "Bedrock");
  assert.equal(f("us.anthropic.claude-haiku-4-5-20251001-v1:0"), "haiku 4.5 budget", "Bedrock, dated");
  assert.equal(f("claude-opus-4-5@20251101"), "opus 4.5 budget", "Vertex");
  assert.equal(f("anthropic/claude-sonnet-4.6"), "sonnet 4.6 adaptive", "OpenRouter spelling");
  assert.equal(f("claude-sonnet-4-5-20250929"), "sonnet 4.5 budget", "a date is not a minor version");
  assert.equal(f("claude-opus-4-20250514"), "opus 4.0 budget");
  assert.equal(f("claude-3-7-sonnet-latest"), "sonnet 3.7 budget");
  assert.equal(f("claude-3-5-haiku-latest"), "haiku 3.5 none", "no extended thinking before 3.7");
  assert.equal(f("claude-opus-6"), "opus 6.0 adaptive", "a newer model gets the newest rules");
});

/** The thinking part of the body for a model and level, as the provider sends it. */
async function anthropicBody(model: string, level: ReasoningEffort | undefined, extra: Partial<ChatRequest> = {}) {
  const b = await bodyOf("anthropic", { model, ...(level ? { reasoning: level } : {}), temperature: 0.3, ...extra });
  return { thinking: b.thinking, effort: b.output_config?.effort, temperature: b.temperature, max_tokens: b.max_tokens };
}

test("Anthropic: the matrix — each family, each level, exactly the documented fields", async () => {
  const A = { type: "adaptive", display: "summarized" };
  const A46 = { type: "adaptive" };
  // model → [Direct, Bref, Standard, Approfondi] as [thinking, effort, temperature]
  const matrix: Record<string, Array<[unknown, string | undefined, number | undefined]>> = {
    // Thinking cannot be off: Direct is the lowest effort. No sampling parameters at all.
    "claude-fable-5-1": [[A, "low", undefined], [A, "low", undefined], [A, "medium", undefined], [A, "xhigh", undefined]],
    "claude-fable-5": [[A, "low", undefined], [A, "low", undefined], [A, "medium", undefined], [A, "xhigh", undefined]],
    "claude-opus-5-5": [[A, "low", undefined], [A, "low", undefined], [A, "medium", undefined], [A, "xhigh", undefined]],
    // disabled accepted at effort ≤ high: no effort is sent with it (default high).
    "claude-opus-5": [[{ type: "disabled" }, undefined, undefined], [A, "low", undefined], [A, "medium", undefined], [A, "xhigh", undefined]],
    "claude-opus-4-8": [[{ type: "disabled" }, undefined, undefined], [A, "low", undefined], [A, "medium", undefined], [A, "xhigh", undefined]],
    "claude-opus-4-7": [[{ type: "disabled" }, undefined, undefined], [A, "low", undefined], [A, "medium", undefined], [A, "xhigh", undefined]],
    // Sonnet 5.5: disabled is a 400, between_tools takes no other field.
    "claude-sonnet-5-5": [[{ type: "between_tools" }, undefined, undefined], [A, "low", undefined], [A, "medium", undefined], [A, "xhigh", undefined]],
    "claude-sonnet-5": [[{ type: "disabled" }, undefined, undefined], [A, "low", undefined], [A, "medium", undefined], [A, "xhigh", undefined]],
    "claude-haiku-5-5": [[{ type: "disabled" }, undefined, undefined], [A, "low", undefined], [A, "medium", undefined], [A, "xhigh", undefined]],
    // 4.6: adaptive, summarized by default, no xhigh; temperature allowed with thinking off.
    "claude-opus-4-6": [[{ type: "disabled" }, undefined, 0.3], [A46, "low", undefined], [A46, "medium", undefined], [A46, "high", undefined]],
    "claude-sonnet-4-6": [[{ type: "disabled" }, undefined, 0.3], [A46, "low", undefined], [A46, "medium", undefined], [A46, "high", undefined]],
  };
  for (const [model, rows] of Object.entries(matrix)) {
    for (const [i, level] of LEVELS.entries()) {
      const got = await anthropicBody(model, level);
      const [thinking, effort, temperature] = rows[i]!;
      assert.deepEqual(got.thinking, thinking, `${model} ${level}: thinking`);
      assert.equal(got.effort, effort, `${model} ${level}: effort`);
      assert.equal(got.temperature, temperature, `${model} ${level}: temperature`);
      assert.equal((got.thinking as { budget_tokens?: number } | undefined)?.budget_tokens, undefined, `${model} ${level}: never budget_tokens`);
    }
  }
});

test("Anthropic: older models keep the token budget, and the budget always fits under max_tokens", async () => {
  for (const model of ["claude-haiku-4-5", "claude-sonnet-4-5", "claude-opus-4-5", "claude-opus-4-1", "claude-3-7-sonnet-latest"]) {
    const off = await anthropicBody(model, "none");
    assert.equal(off.thinking, undefined, `${model}: Direct sends no thinking`);
    assert.equal(off.effort, undefined);
    assert.equal(off.temperature, 0.3, `${model}: a temperature only without thinking`);
    const budgets = [];
    for (const level of ["low", "medium", "high"] as const) {
      const b = await anthropicBody(model, level, { maxTokens: 1000 });
      assert.equal(b.thinking.type, "enabled");
      assert.ok(b.thinking.budget_tokens >= 1024, "the API's minimum");
      assert.ok(b.max_tokens > b.thinking.budget_tokens, "budget < max_tokens");
      assert.ok(b.max_tokens >= 1000 + b.thinking.budget_tokens, "the answer's cap is kept after the thinking");
      assert.equal(b.effort, undefined);
      assert.equal(b.temperature, undefined);
      budgets.push(b.thinking.budget_tokens);
    }
    assert.ok(budgets[0]! < budgets[1]! && budgets[1]! < budgets[2]!, `${model}: each level thinks more`);
  }
  const old = await anthropicBody("claude-3-5-haiku-latest", "high");
  assert.equal(old.thinking, undefined, "a model without extended thinking is never sent it");
});

test("Anthropic: a caller's answer cap is kept after the thinking, on adaptive models too", async () => {
  const b = await anthropicBody("claude-opus-5-5", "none", { maxTokens: 80 });
  assert.ok(b.max_tokens > 80, "a chore on a model that always thinks still has room to answer");
  const off = await anthropicBody("claude-opus-4-8", "none", { maxTokens: 80 });
  assert.equal(off.max_tokens, 80, "with thinking off the cap is the cap");
});

test("Anthropic: no level chosen leaves the model's default, and never a refused temperature", async () => {
  const fable = await anthropicBody("claude-fable-5-1", undefined);
  assert.equal(fable.thinking, undefined);
  assert.equal(fable.effort, undefined);
  assert.equal(fable.temperature, undefined, "sampling is a 400 on Fable");
  assert.equal((await anthropicBody("claude-sonnet-4-6", undefined)).temperature, 0.3);
});

test("Anthropic: each level is a different request on every adaptive family", () => {
  for (const model of ["claude-fable-5-1", "claude-opus-5-5", "claude-opus-5", "claude-opus-4-8", "claude-sonnet-5-5", "claude-sonnet-5", "claude-haiku-5-5", "claude-opus-4-6"]) {
    const offered = reasoningMenu("anthropic", model)!;
    const requests = offered.map((c) => JSON.stringify(anthropicThinking(model, c.id)));
    assert.equal(new Set(requests).size, requests.length, `${model}: two menu levels send the same request`);
  }
});

test("Anthropic: the menu offers Direct only where thinking can really be turned off", () => {
  const ids = (model: string) => reasoningMenu("anthropic", model)!.map((c) => c.id).join(",");
  assert.equal(ids("claude-opus-5-5"), "low,medium,high");
  assert.equal(ids("claude-fable-5-1"), "low,medium,high");
  assert.equal(ids("claude-fable-5"), "low,medium,high");
  for (const m of ["claude-opus-5", "claude-opus-4-8", "claude-sonnet-5-5", "claude-sonnet-5", "claude-haiku-5-5", "claude-opus-4-6", "claude-haiku-4-5"]) {
    assert.equal(ids(m), "none,low,medium,high", m);
  }
  // The model's own default is marked: medium on Opus 5.5, high on Opus 4.6 (Approfondi there).
  assert.equal(reasoningMenu("anthropic", "claude-opus-5-5")!.find((c) => c.isDefault)?.id, "medium");
  assert.equal(reasoningMenu("anthropic", "claude-opus-4-6")!.find((c) => c.isDefault)?.id, "high");
  assert.equal(reasoningMenu("anthropic", "claude-opus-4-8")!.find((c) => c.id === "high")?.native, "xhigh");
  assert.equal(reasoningMenu("anthropic", "claude-3-5-haiku-latest"), undefined);
});

test("Anthropic: signed thinking blocks go back with the tool calls they led to", async () => {
  let second: any;
  let n = 0;
  const server: Server = createServer((r, res) => {
    let raw = "";
    r.on("data", (c) => (raw += c));
    r.on("end", () => {
      n += 1;
      if (n === 2) second = JSON.parse(raw);
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      const ev = (e: unknown) => res.write(`data: ${JSON.stringify(e)}\n\n`);
      if (n === 1) {
        ev({ type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "", signature: "" } });
        ev({ type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "read it first" } });
        ev({ type: "content_block_delta", index: 0, delta: { type: "signature_delta", signature: "SIG" } });
        ev({ type: "content_block_start", index: 1, content_block: { type: "tool_use", id: "t1", name: "read_file" } });
        ev({ type: "content_block_delta", index: 1, delta: { type: "input_json_delta", partial_json: "{}" } });
        ev({ type: "message_delta", delta: { stop_reason: "tool_use" } });
      } else {
        ev({ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } });
        ev({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "done" } });
      }
      res.end();
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const p = new AnthropicProvider({ baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`, apiKey: "k" });
  const tools = [{ name: "read_file", description: "read", parameters: { type: "object" } }];
  const first = await p.chat({ model: "claude-opus-5-5", messages: [{ role: "user", content: "go" }], reasoning: "medium", tools });
  assert.deepEqual(first.thinkingBlocks, [{ type: "thinking", thinking: "read it first", signature: "SIG" }]);
  await p.chat({
    model: "claude-opus-5-5",
    reasoning: "medium",
    tools,
    messages: [
      { role: "user", content: "go" },
      { role: "assistant", content: "", toolCalls: first.toolCalls, thinkingBlocks: first.thinkingBlocks! },
      { role: "tool", toolCallId: "t1", content: "file" },
    ],
  });
  await new Promise<void>((r) => server.close(() => r()));
  assert.deepEqual(second.messages[1].content[0], { type: "thinking", thinking: "read it first", signature: "SIG" });
  assert.equal(second.messages[1].content[1].type, "tool_use");
});

// ── Nothing picked: exactly what was sent before ────────────────────────────────────────────────
//
// ⚠️ « aucune régression de qualité pour personne ». On a cloud, a turn with no level picked, and a
// chore, carry no thinking field: the model thinks at its vendor's own default. The expected bodies
// below are origin/main's, byte for byte — checked against main's own provider code when this was
// written — so only a level chosen in the menu changes what a model receives.

const ALL_ANTHROPIC = [
  "claude-fable-5-1", "claude-fable-5", "claude-opus-5-5", "claude-opus-5", "claude-opus-4-8", "claude-opus-4-7", "claude-opus-4-6",
  "claude-sonnet-5-5", "claude-sonnet-5", "claude-sonnet-4-6", "claude-haiku-5-5", "claude-haiku-4-5", "claude-sonnet-4-5", "claude-opus-4-1",
];

test("unpicked, Anthropic: every family is sent main's body — no thinking, no effort", async () => {
  for (const model of ALL_ANTHROPIC) {
    for (const tools of [undefined, TOOLS]) {
      const b = await bodyOf("anthropic", { model, ...(tools ? { tools } : {}) });
      assert.deepEqual(
        b,
        {
          model,
          max_tokens: 64000,
          stream: true,
          messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
          ...(tools ? { tools: [{ name: "read_file", description: "read", input_schema: { type: "object" } }] } : {}),
        },
        model,
      );
    }
    // A chore is not a picked level either: main sent nothing for its "none", and neither does this.
    const chore = await bodyOf("anthropic", { model, chore: true, reasoning: "none", maxTokens: 80 });
    assert.deepEqual([chore.thinking, chore.output_config, chore.max_tokens], [undefined, undefined, 80], `${model} chore`);
  }
});

test("unpicked, OpenAI / OpenRouter / Gemini and the other clouds: main's body, no reasoning field", async () => {
  const cases: Array<[string, string]> = [
    ["openai", "gpt-5.5"], ["openai", "gpt-5"], ["openai", "o3"], ["openai", "gpt-4o"],
    ["openrouter", "openai/gpt-5.5"], ["openrouter", "anthropic/claude-opus-5.5"], ["openrouter", "google/gemini-3.8-flash"],
    ["google", "gemini-2.5-flash"], ["google", "gemini-2.5-pro"], ["google", "gemini-3.8-flash"],
    ["deepseek", "deepseek-flash"], ["mistral", "mistral-medium-latest"], ["xai", "grok-4.7"], ["groq", "qwen/qwen3.8-27b"], ["qwen", "qwen3.8-flash"],
  ];
  for (const [provider, model] of cases) {
    for (const tools of [undefined, TOOLS]) {
      const b = await bodyOf(provider, { model, ...(tools ? { tools } : {}) });
      assert.deepEqual(
        b,
        {
          model,
          stream: true,
          messages: [{ role: "user", content: "hi" }],
          ...(tools ? { tools: [{ type: "function", function: { name: "read_file", description: "read", parameters: { type: "object" } } }] } : {}),
          stream_options: { include_usage: true },
          ...(provider === "openrouter" ? { usage: { include: true } } : {}),
        },
        `${provider} ${model}`,
      );
    }
    // A chore: main's body too — nothing, and OpenRouter's `exclude` (which hides, and changes nothing).
    const chore = await wireBody(provider, model, "none", { chore: true });
    assert.deepEqual(chore, provider === "openrouter" ? { reasoning: { exclude: true } } : {}, `${provider} ${model} chore`);
  }
});

// ── The OpenAI wire format ──────────────────────────────────────────────────────────────────────

/** The reasoning-related fields of an OpenAI-shaped request. */
async function wireBody(provider: string, model: string, level: ReasoningEffort | undefined, extra: Partial<ChatRequest> = {}) {
  const b = await bodyOf(provider, { model, ...(level ? { reasoning: level } : {}), ...extra });
  const pick: Record<string, unknown> = {};
  for (const k of ["reasoning", "reasoning_effort", "thinking", "enable_thinking", "thinking_budget", "temperature"]) if (k in b) pick[k] = b[k];
  return pick;
}

const TOOLS = [{ name: "read_file", description: "read", parameters: { type: "object" } }];

test("OpenRouter: Direct DISABLES thinking (effort none), never just hides it; each level is its own effort", async () => {
  // A model OpenRouter lists with every effort and "none" (OpenAI gpt-5.5).
  const rows = [];
  for (const level of LEVELS) rows.push(await wireBody("openrouter", "openai/gpt-5.5", level));
  assert.deepEqual(rows, [
    { reasoning: { effort: "none" } },
    { reasoning: { effort: "low" } },
    { reasoning: { effort: "medium" } },
    { reasoning: { effort: "xhigh" } },
  ]);
  for (const r of rows) assert.notDeepEqual(r.reasoning, { exclude: true });
});

test("OpenRouter: a model that cannot stop thinking is never sent none — Direct is its weakest effort, and not on the menu", async () => {
  // anthropic/claude-opus-5.5 and openai/gpt-6.1-sol are `mandatory` in OpenRouter's catalogue.
  assert.deepEqual(await wireBody("openrouter", "anthropic/claude-opus-5.5", "none"), { reasoning: { effort: "low" } });
  assert.deepEqual(await wireBody("openrouter", "anthropic/claude-opus-5.5", "high"), { reasoning: { effort: "xhigh" } });
  assert.deepEqual(await wireBody("openrouter", "openai/gpt-6.1-sol", "none"), { reasoning: { effort: "low" } });
  assert.equal(reasoningMenu("openrouter", "anthropic/claude-opus-5.5")!.some((c) => c.id === "none"), false);
  assert.equal(reasoningMenu("openrouter", "anthropic/claude-opus-4.8")!.some((c) => c.id === "none"), true);
  // Mistral there has only "high" and "none": Direct and Approfondi, nothing pretending in between.
  assert.deepEqual(reasoningMenu("openrouter", "mistralai/mistral-medium-3-5")!.map((c) => c.id), ["none", "high"]);
  assert.deepEqual(await wireBody("openrouter", "mistralai/mistral-medium-3-5", "medium"), { reasoning: { effort: "high" } });
});

test("OpenAI: reasoning_effort per family; non-reasoning models are never sent the field", async () => {
  assert.deepEqual(await wireBody("openai", "gpt-4.1", "high"), {}, "gpt-4.1 rejects reasoning_effort");
  assert.deepEqual(await wireBody("openai", "gpt-4o", "none"), {});
  assert.deepEqual(reasoningMenu("openai", "gpt-4o"), [], "no thinking control on a model without thinking");
  // gpt-5 (5.0) has no "none": Direct is "minimal", the least it does.
  const g5 = [];
  for (const level of LEVELS) g5.push((await wireBody("openai", "gpt-5", level)).reasoning_effort);
  assert.deepEqual(g5, ["minimal", "low", "medium", "high"]);
  // o-series: low–high, cannot be off.
  assert.equal((await wireBody("openai", "o3", "none")).reasoning_effort, "low");
  // A temperature does not go with an effort on a reasoning model.
  assert.deepEqual(await wireBody("openai", "gpt-5", "medium", { temperature: 0.2 }), { reasoning_effort: "medium" });
});

test("OpenAI: from GPT-5.4, a request with tools is sent effort none — the only one Chat Completions takes with tools", async () => {
  assert.deepEqual(await wireBody("openai", "gpt-5.5", "high"), { reasoning_effort: "xhigh" }, "without tools the level stands");
  assert.deepEqual(await wireBody("openai", "gpt-5.5", "high", { tools: TOOLS }), { reasoning_effort: "none" });
  assert.deepEqual(reasoningMenu("openai", "gpt-5.5"), [{ id: "none", native: "none" }], "the menu does not pretend");
  assert.notEqual((await wireBody("openai", "gpt-5.2", "high", { tools: TOOLS })).reasoning_effort, "none", "before 5.4, tools and thinking go together");
});

test("Gemini: none where thinking can be off (2.5 Flash), the weakest effort where it cannot", async () => {
  assert.equal((await wireBody("google", "gemini-2.5-flash", "none")).reasoning_effort, "none");
  assert.equal((await wireBody("google", "gemini-2.5-pro", "none")).reasoning_effort, "low");
  assert.equal((await wireBody("google", "gemini-3.8-flash", "none")).reasoning_effort, "low", "catalogue: mandatory");
  const levels = [];
  for (const level of ["low", "medium", "high"] as const) levels.push((await wireBody("google", "gemini-2.5-pro", level)).reasoning_effort);
  assert.deepEqual(levels, ["low", "medium", "high"]);
  assert.deepEqual(await wireBody("google", "gemini-2.0-flash", "high"), {}, "no thinking before 2.5");
});

test("DeepSeek: thinking switched by its own field, depth by reasoning_effort low/high", async () => {
  assert.deepEqual(await wireBody("deepseek", "deepseek-v4-pro", "none"), { thinking: { type: "disabled" } });
  assert.deepEqual(await wireBody("deepseek", "deepseek-flash", "low"), { thinking: { type: "enabled" }, reasoning_effort: "low" });
  assert.deepEqual(await wireBody("deepseek", "deepseek-flash", "high"), { thinking: { type: "enabled" }, reasoning_effort: "high" });
  assert.deepEqual(reasoningMenu("deepseek", "deepseek-flash")!.map((c) => c.id), ["none", "low", "high"]);
  assert.deepEqual(await wireBody("deepseek", "deepseek-chat", "high"), {}, "the deprecated aliases take nothing");
});

test("Mistral, xAI, Groq, Perplexity: only the efforts each model takes", async () => {
  assert.equal((await wireBody("mistral", "mistral-medium-latest", "none")).reasoning_effort, "none");
  assert.equal((await wireBody("mistral", "mistral-medium-latest", "low")).reasoning_effort, "high", "Mistral has high or none");
  assert.deepEqual(await wireBody("mistral", "codestral-latest", "high"), {});
  // grok-4.7: low–xhigh, never off.
  assert.equal((await wireBody("xai", "grok-4.7", "none")).reasoning_effort, "low");
  assert.equal((await wireBody("xai", "grok-4.7", "high")).reasoning_effort, "xhigh");
  assert.deepEqual(await wireBody("xai", "grok-code-fast-1", "high"), {}, "unknown grok: nothing a 400 could come from");
  assert.equal((await wireBody("groq", "qwen/qwen3.8-27b", "none")).reasoning_effort, "none");
  assert.equal((await wireBody("groq", "openai/gpt-oss-120b", "none")).reasoning_effort, "low");
  assert.deepEqual(await wireBody("groq", "llama-3.3-70b-versatile", "high"), {});
  assert.equal((await wireBody("perplexity", "sonar-deep-research", "medium")).reasoning_effort, "medium");
  assert.deepEqual(await wireBody("perplexity", "sonar-pro", "high"), {});
});

test("Qwen on DashScope: enable_thinking and a thinking budget that grows with the level", async () => {
  assert.deepEqual(await wireBody("qwen", "qwen3.8-flash", "none"), { enable_thinking: false });
  const budgets = [];
  for (const level of ["low", "medium", "high"] as const) {
    const b = await wireBody("qwen", "qwen3.8-flash", level);
    assert.equal(b.enable_thinking, true);
    budgets.push(b.thinking_budget as number);
  }
  assert.ok(budgets[0]! < budgets[1]! && budgets[1]! < budgets[2]!);
  assert.equal((await wireBody("qwen", "qwen3.8-2.4t-a95b", "none")).enable_thinking, true, "a thinking-only model is never switched off");
  assert.deepEqual(await wireBody("qwen", "qwen-turbo", "high"), {});
});

test("self-hosted and gateway: the panel's word, none for Direct, none for a chore — unchanged", async () => {
  for (const provider of ["local", "openai-compatible"]) {
    const sent = [];
    for (const level of LEVELS) sent.push((await wireBody(provider, "qwen3.8", level)).reasoning_effort);
    assert.deepEqual(sent, ["none", "low", "medium", "high"], provider);
    assert.deepEqual(await wireBody(provider, "qwen3.8", undefined), {}, "nothing chosen: nothing sent");
    assert.equal((await wireBody(provider, "qwen3.8", "high", { chore: true })).reasoning_effort, "none");
    assert.equal(reasoningMenu(provider, "qwen3.8"), undefined, "the template's own refusal decides the menu");
  }
});

test("no level is ever sent as a value its profile lacks, on any catalogued model", () => {
  for (const id of Object.keys(GENERATED_REASONING_EFFORTS)) {
    const p = profileFor("openrouter", id)!;
    for (const level of LEVELS) {
      const e = effortFor(p, level)!;
      assert.ok(p.efforts.includes(e), `${id} ${level} → ${e} not in ${p.efforts.join(",")}`);
      if (GENERATED_REASONING_EFFORTS[id]!.m) assert.notEqual(e, "none", `${id}: mandatory, never none`);
    }
    const menu = reasoningMenu("openrouter", id)!;
    const sent = menu.map((c) => effortFor(p, c.id));
    assert.equal(new Set(sent).size, sent.length, `${id}: two menu levels send the same effort`);
  }
});

test("a server that says the model cannot think gets the question again without the effort", () => {
  const body = { model: "m", reasoning_effort: "low", messages: [] };
  assert.deepEqual(adaptRequest(body, '{"error":"\\"llama3\\" does not support thinking"}'), { model: "m", messages: [] });
  // DeepSeek, thinking with tools, missing an earlier reasoning_content: thinking off is accepted.
  const ds = { model: "deepseek-flash", thinking: { type: "enabled" }, reasoning_effort: "high", messages: [] };
  assert.deepEqual(adaptRequest(ds, "The reasoning_content in the thinking mode must be passed back to the API."), {
    model: "deepseek-flash",
    thinking: { type: "disabled" },
    messages: [],
  });
});
