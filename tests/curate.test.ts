// Which model a preset runs, and the two rules that were missing.
//
// These rules lived in a script for months, untestable, and the generated file's own header claimed
// "recency" the whole time while recency was a rounding error: the term was `created / newest` over
// two Unix timestamps, so it varied by 0.0885 across the entire catalogue. `hivey/smart` — the
// preset that exists to be the best — ran a model from October 2025 at $120/M while its September
// 2026 successor sat in the same budget at $10/M.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CODEY,
  curateHivey,
  eligible,
  HIVEY_VARIANT_IDS,
  lineKey,
  outPrice,
  presetOverlaps,
  recencyRank,
  supersedes,
  undominated,
  type CatalogueModel,
} from "../src/core/router/curate.js";

const DAY = 86_400;
const T2026 = 1_790_000_000;

function model(id: string, over: Partial<CatalogueModel> = {}): CatalogueModel {
  return {
    id,
    created: T2026,
    context_length: 200_000,
    pricing: { completion: "0.00001", prompt: "0.000002" },
    architecture: { output_modalities: ["text"] },
    supported_parameters: ["tools"],
    ...over,
  };
}

const price = (usdPerMillion: number) => ({ pricing: { completion: String(usdPerMillion / 1_000_000) } });

test("recency discriminates, which is the whole defect", () => {
  // The old term was `1.5 * created / newest` over epoch seconds. Both ends of a three-year
  // catalogue scored within 0.09 of each other, so recency could never outweigh anything. A rank
  // spreads over [0, 1] whatever the units — which is why the price ladder never had this bug.
  const universe = [
    model("a/old", { created: T2026 - 1000 * DAY }),
    model("a/mid", { created: T2026 - 500 * DAY }),
    model("a/new", { created: T2026 }),
  ];
  const rank = recencyRank(universe);
  assert.equal(rank(universe[0]!), 0);
  assert.equal(rank(universe[2]!), 1);
  assert.ok(rank(universe[1]!) > 0 && rank(universe[1]!) < 1);
  // And the spread is the point: it has to be able to decide something.
  assert.ok(rank(universe[2]!) - rank(universe[0]!) === 1);
});

test("a newer, no dearer model from the same vendor supersedes the other", () => {
  const older = model("anthropic/claude-opus-5", { created: T2026 - 60 * DAY, ...price(25) });
  const newer = model("anthropic/claude-opus-5.5", { created: T2026, ...price(20) });
  assert.ok(supersedes(newer, older), "newer and cheaper, and it was losing");
  assert.ok(!supersedes(older, newer));
  assert.deepEqual(undominated([older, newer]).map((m) => m.id), ["anthropic/claude-opus-5.5"]);
});

test("a newer mid-range model does not supersede an older flagship", () => {
  // What the rule got wrong on its first run. Anthropic ships Opus and Sonnet together, at different
  // sizes and different prices: Sonnet 5.5 is newer than Opus 5.5 AND half the price, so a
  // vendor-wide rule declared the flagship superseded by the mid-range. Only the same LINE counts.
  const opus = model("anthropic/claude-opus-5.5", { created: T2026 - 6 * DAY, ...price(20) });
  const sonnet = model("anthropic/claude-sonnet-5.5", { created: T2026, ...price(10) });
  assert.equal(lineKey(opus), "claude-opus");
  assert.equal(lineKey(sonnet), "claude-sonnet");
  assert.ok(!supersedes(sonnet, opus), "Sonnet is not Opus's successor");
  assert.equal(undominated([opus, sonnet]).length, 2, "both must stay and let the score decide");
  // While within the line it still holds.
  const opusOld = model("anthropic/claude-opus-5", { created: T2026 - 70 * DAY, ...price(25) });
  assert.ok(supersedes(opus, opusOld));
});

test("a version or a size in the id is not part of the line's name", () => {
  const key = (id: string) => lineKey({ id });
  assert.equal(key("openai/gpt-6.1-sol-pro"), "gpt-sol-pro");
  assert.equal(key("deepseek/deepseek-v4.1-flash"), "deepseek-flash");
  assert.equal(key("nvidia/nemotron-3-ultra-550b-a55b:free"), "nemotron-ultra");
  assert.equal(key("nvidia/nemotron-3.5-lightning:free"), "nemotron-lightning");
  assert.equal(key("x-ai/grok-4.7"), "grok");
});

test("superseding stops at the vendor, because across vendors the claim is false", () => {
  // A newer, cheaper model from a house nobody has heard of is not thereby better than Claude, and a
  // filter that said otherwise would quietly replace the flagship with whatever was published last.
  const claude = model("anthropic/claude-opus-5.5", { created: T2026 - 10 * DAY, ...price(20) });
  const outsider = model("someone/brand-new", { created: T2026, ...price(1) });
  assert.ok(!supersedes(outsider, claude));
  assert.equal(undominated([claude, outsider]).length, 2);
});

test("superseding requires every dimension, not just the date", () => {
  const base = model("v/a", { created: T2026 - 30 * DAY, ...price(10), context_length: 200_000 });
  // Newer but dearer.
  assert.ok(!supersedes(model("v/b", { created: T2026, ...price(11) }), base));
  // Newer and cheaper but a smaller window.
  assert.ok(!supersedes(model("v/c", { created: T2026, ...price(5), context_length: 100_000 }), base));
  // Newer and cheaper but it cannot call tools, and the one it would replace can.
  assert.ok(!supersedes(model("v/d", { created: T2026, ...price(5), supported_parameters: [] }), base));
});

test("the preset no longer pays twelve times the price for a year-old model", () => {
  // Reduced from the real catalogue, and from the real result: `hivey/smart`'s deep budget is $150,
  // so both of these fit — and the old rule, reading price as capability, chose the older one.
  const all = [
    model("openai/gpt-5-pro", { created: T2026 - 360 * DAY, ...price(120) }),
    model("openai/gpt-6.1-sol-pro", { created: T2026, ...price(10) }),
    model("anthropic/claude-opus-5", { created: T2026 - 70 * DAY, ...price(25) }),
    model("anthropic/claude-opus-5.5", { created: T2026 - 10 * DAY, ...price(20) }),
    model("deepseek/deepseek-v4.1-flash", { created: T2026, ...price(1.2) }),
    model("qwen/qwen3-coder-30b-a3b-instruct", { created: T2026 - 20 * DAY, ...price(0.8) }),
  ];
  const routing = curateHivey(all);
  for (const variant of ["hivey", "hivey/smart"]) {
    for (const role of ["chore", "everyday", "deep", "completion"]) {
      const chosen = routing[variant]?.[role];
      assert.ok(chosen, `${variant}/${role} has no model`);
      assert.notEqual(chosen, "openai/gpt-5-pro", `${variant}/${role} still picks the year-old flagship`);
      assert.notEqual(chosen, "anthropic/claude-opus-5", `${variant}/${role} still picks the superseded Opus`);
    }
  }
});

test("a dearer preset is never served a worse model than a cheaper one", () => {
  // The invariant the price LADDER exists for, kept here so a change to the weights cannot break it
  // silently. "Worse" is read as "cheaper", which is the only ordering this catalogue carries.
  const all = [
    model("anthropic/claude-opus-5.5", { created: T2026, ...price(20) }),
    model("openai/gpt-6.1-sol-pro", { created: T2026, ...price(10) }),
    model("deepseek/deepseek-v4.1-flash", { created: T2026, ...price(1.2) }),
    model("qwen/qwen3-coder-30b-a3b-instruct", { created: T2026, ...price(0.8) }),
    model("google/gemini-3.8-flash", { created: T2026, ...price(3.75) }),
  ];
  const routing = curateHivey(all);
  const priceOf = (id?: string) => {
    const m = all.find((x) => x.id === id);
    return m ? outPrice(m) : 0;
  };
  for (const role of ["everyday", "deep"]) {
    assert.ok(
      priceOf(routing["hivey/smart"]?.[role]) >= priceOf(routing["hivey"]?.[role]),
      `Pro picked a cheaper model than Smart for ${role}`,
    );
  }
});

test("what is never eligible, and why", () => {
  assert.ok(!eligible(model("~anything/moving"), false), "a moving alias is not a stable id");
  assert.ok(!eligible(model("v/x:batch"), false), "half price, answers in hours");
  assert.ok(!eligible(model("v/x-preview"), false));
  assert.ok(!eligible(model("openrouter/auto-beta"), false), "a router is not a model");
  assert.ok(!eligible(model("v/x:free"), false), "a free id has no business in a paid pool");
  assert.ok(!eligible(model("v/x"), true), "and the reverse");
  assert.ok(!eligible(model("v/x", { pricing: {} }), false), "no price means no predictable bill");
  assert.ok(!eligible(model("v/x", { architecture: { output_modalities: ["image"] } }), false));
  assert.ok(eligible(model("anthropic/claude-opus-5.5"), false));
});

test("the free preset stays free", () => {
  const all = [
    model("nvidia/nemotron-3-ultra-550b-a55b:free", { pricing: { completion: "0" } }),
    model("cohere/north-mini-code:free", { pricing: { completion: "0" } }),
    model("anthropic/claude-opus-5.5", { ...price(20) }),
  ];
  const free = curateHivey(all)["hivey/free"] ?? {};
  assert.ok(Object.keys(free).length > 0, "the free preset must still answer");
  for (const id of Object.values(free)) assert.match(id, /:free$/, `${id} is not free`);
});

test("a code model completes and does not write commit messages", () => {
  assert.ok(CODEY.test("qwen/qwen3-coder-30b-a3b-instruct"));
  assert.ok(CODEY.test("mistralai/devstral-small"));
  assert.ok(!CODEY.test("anthropic/claude-opus-5.5"));
  const all = [
    model("qwen/qwen3-coder-30b", { ...price(0.8) }),
    model("deepseek/deepseek-v4.1-flash", { ...price(1.2) }),
  ];
  const routing = curateHivey(all);
  assert.match(String(routing["hivey"]?.["completion"]), /coder/, "completion wants a code model");
});

test("every preset fills every role", () => {
  // A preset with an empty role is a preset that cannot answer, and the relaxation that prevents it
  // only works if something actually checks.
  const all = [
    model("anthropic/claude-opus-5.5", { ...price(20) }),
    model("deepseek/deepseek-v4.1-flash", { ...price(1.2) }),
    model("qwen/qwen3-coder-30b-a3b-instruct", { ...price(0.8) }),
    model("nvidia/nemotron-3-ultra-550b-a55b:free", { pricing: { completion: "0" } }),
  ];
  const routing = curateHivey(all);
  for (const variant of HIVEY_VARIANT_IDS) {
    for (const role of ["chore", "everyday", "deep", "completion"]) {
      assert.ok(routing[variant]?.[role], `${variant}/${role} is empty`);
    }
  }
});

test("the score alone is not enough: a dominated model can still outscore its successor", () => {
  // Why the filter exists rather than a bigger recency weight. Two models from one vendor published
  // a day apart: the newer one is far cheaper. Their recency ranks are adjacent — nearly equal — so
  // the price term, which a capable role reads upward, decides, and it picks the dearer OLDER one.
  // No weighting fixes this in general, because the gap in price is unbounded and the gap in
  // recency is one rung. "Never pay more for an older model from the same vendor" is a rule, and a
  // rule belongs in a filter.
  const spread = Array.from({ length: 10 }, (_, i) =>
    model(`filler${i}/m`, { created: T2026 - (i + 5) * DAY, ...price(1 + i * 12) }),
  );
  // Same line, so one really does supersede the other — `thing-2` after `thing-1`.
  const successor = model("v/thing-2", { created: T2026, ...price(1) });
  const superseded = model("v/thing-1", { created: T2026 - DAY, ...price(130) });
  const all = [...spread, successor, superseded];

  // The filter is what decides it: without it, the dearer older model wins its own shortlist.
  assert.ok(supersedes(successor, superseded), "newer, cheaper, same vendor");
  const shortlist = [successor, superseded];
  assert.deepEqual(undominated(shortlist).map((m) => m.id), ["v/thing-2"]);

  // And end to end, the preset must not name it.
  const routing = curateHivey(all);
  assert.notEqual(routing["hivey/smart"]?.["deep"], "v/thing-1", "a superseded model reached a preset");
});

test("a preset that buys nothing extra is reported, not hidden", () => {
  // The outcome the rules actually produced once recency worked: the newest strong model was inside
  // the cheaper preset's budget, so both presets resolved to it and the dearer one bought nothing.
  // The margin was 0.007 of a point. Reported, because it is a fact about the market and it will
  // stop being true the next time somebody ships an expensive flagship.
  const same = { "hivey/free": { deep: "f" }, hivey: { deep: "x" }, "hivey/smart": { deep: "x" } };
  assert.deepEqual(presetOverlaps(same), ["hivey/smart/deep = hivey/deep (x)"]);
  const different = { "hivey/free": { deep: "f" }, hivey: { deep: "x" }, "hivey/smart": { deep: "y" } };
  assert.deepEqual(presetOverlaps(different), []);
});
