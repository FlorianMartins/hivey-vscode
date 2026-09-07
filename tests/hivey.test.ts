// The Hivey presets.
//
// A preset is a promise about money as much as about quality, so what is tested here is the shape
// of that promise: a preset id never reaches a provider, a dearer preset is never served a worse
// model than a cheaper one, and every id in the generated table is one the catalogue still prices —
// which is the failure the sibling project shipped, where three of the four free ids had been
// retired and every request to them answered 404.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  hiveyLabel,
  hiveyModel,
  hiveyModels,
  hiveyRole,
  hiveyVariant,
  HIVEY_VARIANTS,
  isHivey,
} from "../src/core/router/hivey.js";
import { HIVEY_ROUTING } from "../src/core/router/hivey.generated.js";
import { GENERATED_PRICES } from "../src/core/router/catalog.generated.js";
import { route, type RouterConfig } from "../src/core/router/route.js";

const CFG = (model: string): RouterConfig => ({
  chat: { provider: "local", model },
  completion: { provider: "local", model: "qwen2.5-coder:7b" },
  escalation: "ask",
  localContextTokens: 32000,
});

test("a preset is recognised, and a stale one is not sent as it stands", () => {
  assert.ok(isHivey("hivey"));
  assert.ok(isHivey("hivey/smart"));
  assert.ok(!isHivey("anthropic/claude-opus-5"));
  // The sibling project's own bug: `hivey/balanced` was retired, stayed in people's settings, and
  // went to the API verbatim — "hivey/balanced is not a valid model ID", on every request.
  assert.equal(hiveyVariant("hivey/balanced"), "hivey/free");
  assert.ok(!isHivey(hiveyModel("hivey/balanced", "everyday")));
});

test("no preset ever resolves to a string beginning with hivey/", () => {
  for (const variant of [...HIVEY_VARIANTS.map((v) => v.id), "hivey/balanced", "hivey/auto"]) {
    for (const role of ["chore", "everyday", "deep", "completion"] as const) {
      const model = hiveyModel(variant, role);
      assert.ok(!isHivey(model), `${variant}/${role} resolved to ${model}`);
      assert.ok(model.length > 0);
    }
  }
});

test("the kind of work decides the role, without asking a model", () => {
  assert.equal(hiveyRole("completion"), "completion");
  assert.equal(hiveyRole("aux"), "chore");
  assert.equal(hiveyRole("embed"), "chore");
  assert.equal(hiveyRole("agent"), "deep");
  assert.equal(hiveyRole("chat", "standard"), "everyday");
  assert.equal(hiveyRole("chat", "trivial"), "everyday");
  assert.equal(hiveyRole("chat", "hard"), "deep");
});

test("the router resolves a preset and says which preset and which role", () => {
  const chat = route(CFG("hivey/smart"), { kind: "chat", prompt: "rename this variable", promptTokens: 40 });
  assert.equal(chat.provider, "openrouter", "a preset is served from the catalogue, never from Ollama");
  assert.ok(!isHivey(chat.model));
  assert.match(chat.why, /Hivey Pro: everyday/);

  const agent = route(CFG("hivey/smart"), { kind: "agent", prompt: "add a test", promptTokens: 40 });
  assert.match(agent.why, /Hivey Pro: deep/);
  assert.equal(agent.model, HIVEY_ROUTING["hivey/smart"]!.deep);

  // The same grade the escalation path uses, so "hard" means one thing in that file rather than two.
  const hard = route(CFG("hivey"), {
    kind: "chat",
    prompt: "why does this deadlock under load?",
    promptTokens: 40,
  });
  assert.match(hard.why, /Hivey Smart: deep/);
});

test("a preset never asks to escalate: there is nothing local to be beyond", () => {
  const decision = route(CFG("hivey"), { kind: "chat", prompt: "threat model this", promptTokens: 40 });
  assert.equal(decision.suggestEscalation, undefined);
});

test("every model the table names is one the catalogue still prices", () => {
  for (const [variant, roles] of Object.entries(HIVEY_ROUTING)) {
    for (const [role, id] of Object.entries(roles)) {
      assert.ok(GENERATED_PRICES[id], `${variant}/${role} → ${id} is not in the price catalogue`);
    }
  }
});

test("a dearer preset is never served a worse model than a cheaper one", () => {
  const outPrice = (id: string) => GENERATED_PRICES[id]?.out ?? 0;
  for (const role of ["everyday", "deep"] as const) {
    const free = outPrice(HIVEY_ROUTING["hivey/free"]![role]!);
    const smart = outPrice(HIVEY_ROUTING["hivey"]![role]!);
    const pro = outPrice(HIVEY_ROUTING["hivey/smart"]![role]!);
    assert.ok(free <= smart, `${role}: Free (${free}) costs more than Smart (${smart})`);
    assert.ok(smart <= pro, `${role}: Smart (${smart}) costs more than Pro (${pro})`);
  }
});

test("the deep role costs more than the everyday one — otherwise the split buys nothing", () => {
  for (const variant of ["hivey", "hivey/smart"] as const) {
    const everyday = GENERATED_PRICES[HIVEY_ROUTING[variant]!.everyday!]?.out ?? 0;
    const deep = GENERATED_PRICES[HIVEY_ROUTING[variant]!.deep!]?.out ?? 0;
    assert.ok(deep >= everyday, `${variant}: the deep model is not dearer than the everyday one`);
  }
});

test("a preset is named by its name, and knows every model it can reach", () => {
  assert.equal(hiveyLabel("hivey"), "Hivey Smart");
  assert.equal(hiveyLabel("hivey/smart"), "Hivey Pro");
  assert.equal(hiveyLabel("hivey/free"), "Hivey Free");
  const reachable = hiveyModels("hivey");
  assert.ok(reachable.length >= 2, "a preset that reaches one model is not a routing");
  assert.ok(reachable.every((id) => GENERATED_PRICES[id]));
});
