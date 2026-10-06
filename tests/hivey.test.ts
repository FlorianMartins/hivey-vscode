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
  hiveyRoles,
  HIVEY_ROLES,
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

test("a preset is recognized, and a stale one is not sent as it stands", () => {
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

// ── What a preset costs, and why two of them can cost the same ────────────────────────────────────

test("a preset answers for all four of its roles, not just the ordinary one", () => {
  // The defect, as an assertion. The panel priced a preset by its `everyday` role and presented that
  // as the preset's price — so Hivey Smart and Hivey Pro came out identical, because their two
  // everyday models happen to charge the same to read. « comment ça se fait que les modeles Hivey pro
  // et Hivey smart sortent le meme prix ? le smart est censé utiliser les meilleurs modeles ».
  for (const variant of ["hivey/free", "hivey", "hivey/smart"]) {
    const roles = hiveyRoles(variant);
    assert.equal(roles.length, HIVEY_ROLES.length, `${variant} does not answer for every role`);
    assert.deepEqual(
      roles.map((r) => r.role),
      HIVEY_ROLES,
      "the roles are reported in the catalogue's own order, so two presets can be read side by side",
    );
    for (const r of roles) {
      assert.ok(!r.model.startsWith("hivey"), `${variant}/${r.role} resolves to a preset id, which no provider knows`);
    }
  }
});

test("a dearer preset says when it reaches the model a cheaper one already uses", () => {
  // ⚠️ This is the fact that ANSWERS the question, and it was computed and never shown. A dearer
  // preset landing on the cheaper one's model is not a defect: the strongest current model was already
  // inside the cheaper budget, so the dearer one had nothing better to buy. Unsaid, the presets read
  // as decorative — which is exactly how they were read.
  const free = hiveyRoles("hivey/free");
  assert.ok(
    free.every((r) => !r.sameAsCheaper),
    "the cheapest preset cannot share with a cheaper one; there is none",
  );

  // On today's generated table the two paid presets share three roles out of four. That is a fact
  // about one afternoon's catalogue and may change, so what is asserted is the RELATION, not the
  // count: wherever two presets resolve to the same model for a role, the dearer one says so.
  for (const variant of ["hivey", "hivey/smart"]) {
    for (const r of hiveyRoles(variant)) {
      const cheaperIds = ["hivey/free", "hivey"].slice(0, ["hivey/free", "hivey", "hivey/smart"].indexOf(variant));
      const twin = cheaperIds.find((other) => hiveyModel(other, r.role) === r.model);
      assert.equal(
        r.sameAsCheaper,
        twin,
        `${variant}/${r.role} shares with ${twin ?? "nobody"} and the row does not say the same`,
      );
    }
  }
});

test("the panel prices a preset by its dearest role and sizes it by its smallest", () => {
  // Two different rules for two different promises, and reading the source because this is a claim
  // about a call site. A price must never quote the cheap tier and bill the expensive one, so it is
  // the DEAREST role; a context window is something you rely on while working, so it is the SMALLEST.
  // The smallest is also what separates these two presets honestly — Smart drops to 500 k on an
  // everyday turn and Pro does not, which no price was ever going to show.
  const { readFileSync } = require("node:fs") as typeof import("node:fs");
  const models = readFileSync("src/extension/models.ts", "utf8");
  assert.match(models, /inUsd: Math\.max\(\.\.\.roles\.map\(\(r\) => r\.inUsd\)\)/);
  assert.match(models, /outUsd: Math\.max\(\.\.\.roles\.map\(\(r\) => r\.outUsd\)\)/);
  assert.match(models, /context: windows\.length \? Math\.min\(\.\.\.windows\) : 0/);
  // ⚠️ And an unknown window may not swallow the minimum: a role the catalogue has never heard of
  // reports 0, and a minimum over a 0 is 0 — which reads as "unknown" on a preset where three roles
  // are perfectly well known.
  assert.match(models, /\.filter\(\(c\) => c > 0\)/);
  assert.ok(
    !/context: everyday\?\.context/.test(models),
    "the preset is sized by one of its four roles again",
  );
});
