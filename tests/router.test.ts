// The rules that decide whether a keystroke costs money.

import { test } from "node:test";
import assert from "node:assert/strict";
import { route, classifyComplexity } from "../src/core/router/route.js";
import { Budget, MemorySpendStore } from "../src/core/router/budget.js";
import { costOf, estimateCost, makeLookup } from "../src/core/router/pricing.js";
import { GENERATED_PRICES } from "../src/core/router/catalog.generated.js";
import { readFileSync } from "node:fs";
import { HIVEY_VARIANTS, hiveyModels } from "../src/core/router/hivey.js";
import { HIVEY_ROUTING } from "../src/core/router/hivey.generated.js";
import { estimateTokens } from "../src/core/util/tokens.js";

const cfg = {
  chat: { provider: "local" as const, model: "qwen2.5-coder:7b" },
  completion: { provider: "local" as const, model: "qwen2.5-coder:7b" },
  escalateTo: { provider: "openrouter" as const, model: "anthropic/claude-sonnet-4.5" },
  escalation: "ask" as const,
  localContextTokens: 32000,
};

test("completion never escalates, whatever the policy", () => {
  for (const escalation of ["never", "ask", "auto"] as const) {
    const r = route({ ...cfg, escalation }, { kind: "completion", promptTokens: 60000, prompt: "refactor the architecture" });
    assert.equal(r.provider, "local");
    assert.equal(r.suggestEscalation, undefined);
  }
});

test("chores and embeddings stay local too", () => {
  for (const kind of ["aux", "embed"] as const) {
    assert.equal(route(cfg, { kind, promptTokens: 500 }).provider, "local");
  }
});

test("an ordinary chat turn stays on the local model", () => {
  const r = route(cfg, { kind: "chat", prompt: "add a null check to this function", promptTokens: 800 });
  assert.equal(r.provider, "local");
  assert.equal(r.suggestEscalation, undefined);
});

test("a hard question is offered to the cloud, not sent to it", () => {
  const r = route(cfg, { kind: "chat", prompt: "why does this deadlock under load?", promptTokens: 900 });
  assert.equal(r.provider, "local", "the router does not spend on its own");
  assert.ok(r.suggestEscalation);
  assert.equal(r.suggestEscalation!.provider, "openrouter");
});

test("policy auto escalates, policy never refuses to", () => {
  const hard = { kind: "chat" as const, prompt: "root cause of this race condition?", promptTokens: 900 };
  assert.equal(route({ ...cfg, escalation: "auto" }, hard).provider, "openrouter");
  const never = route({ ...cfg, escalation: "never" }, hard);
  assert.equal(never.provider, "local");
  assert.equal(never.suggestEscalation, undefined);
});

test("context that does not fit the local window is itself a hard signal", () => {
  const c = classifyComplexity("tidy this up", 30000, 32000);
  assert.equal(c.level, "hard");
  assert.match(c.why, /window/);
});

test("the per-request cap stops one runaway prompt", () => {
  const b = new Budget(new MemorySpendStore(), { perRequestUsd: 0.25, dailyUsd: 2 });
  assert.equal(b.check(0.1).ok, true);
  const v = b.check(3);
  assert.equal(v.ok, false);
  assert.equal(v.ok === false && v.reason, "per-request");
});

test("the daily cap stops the sum of reasonable ones", () => {
  const b = new Budget(new MemorySpendStore(), { perRequestUsd: 1, dailyUsd: 1 }, () => "2026-08-21");
  for (let i = 0; i < 10; i++) b.record(0.09);
  assert.equal(b.spentToday().toFixed(2), "0.90");
  const v = b.check(0.2);
  assert.equal(v.ok === false && v.reason, "daily");
});

test("spending resets with the day", () => {
  let day = "2026-08-21";
  const b = new Budget(new MemorySpendStore(), { perRequestUsd: 1, dailyUsd: 1 }, () => day);
  b.record(0.9);
  day = "2026-08-22";
  assert.equal(b.spentToday(), 0);
  assert.equal(b.check(0.5).ok, true);
});

test("a provider's own cost figure always wins over the estimate", () => {
  const price = { in: 3, out: 15 };
  const c = costOf({ promptTokens: 1000, completionTokens: 1000, cachedTokens: 0, costUsd: 0.0042 }, price);
  assert.equal(c.usd, 0.0042);
  assert.equal(c.known, true);
});

test("an unknown model is reported as unknown, never guessed", () => {
  const c = costOf({ promptTokens: 1000, completionTokens: 100, cachedTokens: 0 }, undefined);
  assert.equal(c.known, false);
  assert.equal(c.usd, 0);
});

test("the prompt cache is where a coding conversation gets cheap", () => {
  const price = { in: 3, out: 15, cachedIn: 0.3 };
  const c = costOf({ promptTokens: 100000, completionTokens: 500, cachedTokens: 95000 }, price);
  assert.ok(c.usd < c.usdWithoutCache * 0.35, `cached call should be far cheaper (${c.usd} vs ${c.usdWithoutCache})`);
});

test("price lookup falls back from exact id to vendor wildcard", () => {
  const look = makeLookup({ "anthropic/claude-sonnet-4.5": { in: 3, out: 15 }, "openai/*": { in: 1, out: 4 } });
  assert.equal(look("anthropic/claude-sonnet-4.5")!.in, 3);
  assert.equal(look("openai/gpt-5-mini")!.in, 1);
  assert.equal(look("mistralai/whatever"), undefined);
});

test("token estimation stays above the truth for code", () => {
  // 4 chars/token is the prose ratio; code must estimate higher, never lower.
  const code = "const x = arr.filter((v) => v.id !== y.id).map((v) => ({ ...v, n: v.n + 1 }));";
  assert.ok(estimateTokens(code) > code.length / 4);
});

// ── The cap has to clear an ordinary turn ───────────────────────────────────────────────────────
//
// This is the test that was missing, and its absence made the product look dead.
//
// The spending cap is checked before sending, on an estimate that charges the whole prompt at the
// input price plus a quarter of it at the output price. Nobody ever multiplied that out against the
// catalogue: on a premium model it comes to about $34 per million tokens, so the shipped cap of
// $0.25 was reached at around seven thousand prompt tokens. Agent mode passes that before the
// question is added — the repository map alone is 40% of the context budget. Every turn was refused
// before anything was sent, and the refusal was posted as a message the next render threw away.
//
// So the assertion is not about the number in the manifest. It is about the only thing that
// matters: with what we ship, on the most expensive model we list, an ordinary agent prompt has to
// go through.

/** What agent mode assembles for a normal question: map, house rules, open file, transcript. */
const ORDINARY_AGENT_PROMPT_TOKENS = 20_000;

function shippedDefault(key: string): number {
  const manifest = JSON.parse(readFileSync("package.json", "utf8"));
  const sections = manifest.contributes.configuration as Array<{ properties: Record<string, { default: unknown }> }>;
  for (const section of sections) {
    const found = section.properties[key];
    if (found) return Number(found.default);
  }
  throw new Error(`${key} is not in the manifest`);
}

test("the shipped per-request cap clears an ordinary agent turn on every model the product picks", () => {
  // Not "the dearest model in the catalogue": o1-pro really does cost $300 per million, and a guard
  // that lets 20k tokens of it through unquestioned would not be a guard. What must never be
  // refused in silence is what the product ROUTES TO on its own — a user who never chose a model is
  // owed an answer.
  const budget = new Budget(new MemorySpendStore(), {
    perRequestUsd: shippedDefault("hiveyCode.budget.perRequestUsd"),
    dailyUsd: shippedDefault("hiveyCode.budget.dailyUsd"),
  });
  const price = makeLookup(GENERATED_PRICES);

  for (const variant of HIVEY_VARIANTS) {
    for (const model of hiveyModels(variant.id)) {
      const verdict = budget.check(estimateCost(ORDINARY_AGENT_PROMPT_TOKENS, price(model)));
      assert.ok(
        verdict.ok,
        `${variant.id} routes to ${model}, and the default cap refuses an ordinary ` +
          `${ORDINARY_AGENT_PROMPT_TOKENS}-token turn on it: ${verdict.ok ? "" : verdict.message}. ` +
          `Every question would end before being sent.`,
      );
    }
  }
});

test("the cap still catches the accident it exists for", () => {
  // A pasted build log, a tool that read a minified bundle: the guard is worth having, and the fix
  // for the cap firing too early must not be "stop guarding".
  const budget = new Budget(new MemorySpendStore(), {
    perRequestUsd: shippedDefault("hiveyCode.budget.perRequestUsd"),
    dailyUsd: shippedDefault("hiveyCode.budget.dailyUsd"),
  });
  const price = makeLookup(GENERATED_PRICES);
  // A free endpoint costs nothing however much is sent to it, so there is nothing for a spending cap
  // to say about one. The accident this guard exists for is the same prompt on a model that bills.
  const dearestRouted = HIVEY_VARIANTS.flatMap((v) => hiveyModels(v.id))
    .map((m) => price(m))
    .filter((p): p is NonNullable<typeof p> => !!p && p.in > 0)
    .sort((a, b) => b.in + 0.25 * b.out - (a.in + 0.25 * a.out))[0]!;
  // 400k tokens is a pasted build log or a tool that read a minified bundle.
  assert.equal(
    budget.check(estimateCost(400_000, dearestRouted)).ok,
    false,
    "a runaway prompt goes through unquestioned",
  );
});

test("the shipped daily cap allows a day's work, not a handful of questions", () => {
  // The symptom that was reported as "it worked before and now it does nothing at all": the daily
  // cap was $2, an ordinary turn on the model the middle preset routes to is estimated at about
  // twenty cents, and so the eighth question of the day was refused — and every one after it until
  // midnight. The refusal was silent, so what the user saw was an extension that had stopped
  // working for no reason, on a schedule nobody could connect to anything.
  //
  // A day of use is not eight questions. Forty is a modest afternoon.
  const MINIMUM_QUESTIONS_A_DAY = 40;
  const price = makeLookup(GENERATED_PRICES);
  const deep = HIVEY_ROUTING["hivey"]?.deep;
  assert.ok(deep, "the middle preset has no deep model");
  const perTurn = estimateCost(ORDINARY_AGENT_PROMPT_TOKENS, price(deep));

  const budget = new Budget(new MemorySpendStore(), {
    perRequestUsd: shippedDefault("hiveyCode.budget.perRequestUsd"),
    dailyUsd: shippedDefault("hiveyCode.budget.dailyUsd"),
  });
  let answered = 0;
  while (budget.check(perTurn).ok && answered < MINIMUM_QUESTIONS_A_DAY) {
    budget.record(perTurn);
    answered += 1;
  }
  assert.equal(
    answered,
    MINIMUM_QUESTIONS_A_DAY,
    `the daily cap starts questioning after ${answered} ordinary turns on ${deep} ` +
      `($${perTurn.toFixed(3)} each). A day of work has to fit.`,
  );
});
