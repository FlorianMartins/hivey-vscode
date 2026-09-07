#!/usr/bin/env node
// Regenerates the price catalogue from OpenRouter's public model list.
//
// Why a generated file rather than a fetch at runtime: prices must be known BEFORE a request, to
// refuse one that would blow the budget, and an extension that phones a catalogue endpoint on
// startup is an extension that talks to the network before the user asked it to. So the list is
// baked in, refreshed by a scheduled job, and reviewable as a diff.
//
// Why never by hand: the sidebar project learned this the expensive way. A hard-coded model id or
// price is correct on the day it is written and wrong within weeks, silently.
//
//   node scripts/update-models.mjs          rewrite the catalogue
//   node scripts/update-models.mjs --check  exit 1 if it is out of date (CI)

import { readFile, writeFile } from "node:fs/promises";

const OUT = "src/core/router/catalog.generated.ts";
const check = process.argv.includes("--check");

const res = await fetch("https://openrouter.ai/api/v1/models", { headers: { Accept: "application/json" } });
if (!res.ok) {
  console.error(`OpenRouter answered ${res.status}. Leaving the catalogue as it is.`);
  process.exit(check ? 0 : 1);
}
const { data } = await res.json();

// Compact tuples rather than objects: 400 models, one line each, and a daily diff a human can read.
// [id, display name, vendor, context window, $/M in, $/M out, $/M cached-in]
const rows = [];
let kept = 0;
for (const m of data ?? []) {
  const p = m.pricing ?? {};
  // OpenRouter quotes USD per token as a string; the catalogue stores USD per million, which is
  // how everyone reads prices and avoids a float with nine leading zeros.
  const perMillion = (v) => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? Number((n * 1_000_000).toFixed(4)) : 0;
  };
  const inUsd = perMillion(p.prompt);
  const outUsd = perMillion(p.completion);
  const cachedUsd = perMillion(p.input_cache_read);
  // A free endpoint is worth recording as free: it is what makes `:free` variants usable.
  if (!inUsd && !outUsd && !/:free$/.test(m.id)) continue;

  const vendor = m.id.includes("/") ? m.id.slice(0, m.id.indexOf("/")) : "";
  const name = String(m.name ?? m.id).replace(/^[^:]+:\s*/, "");
  rows.push([m.id, name, vendor, Number(m.context_length ?? 0), inUsd, outUsd, cachedUsd]);
  kept++;
}
rows.sort((a, b) => a[0].localeCompare(b[0]));

const body = `// GENERATED FILE — do not edit by hand.
// Written by \`npm run models\` (scripts/update-models.mjs); a scheduled workflow commits the diff.
// ${kept} priced models. Tuples: [id, name, vendor, context, $/M in, $/M out, $/M cached-in].
//
// A model that is absent from this table is reported as "unknown cost" rather than guessed: a
// wrong price silently spends someone's budget.

import type { Price } from "./pricing.js";

export const GENERATED_AT = ${JSON.stringify(new Date().toISOString().slice(0, 10))};

export type ModelRow = [string, string, string, number, number, number, number];

export const GENERATED_MODELS: ModelRow[] = [
${rows.map((r) => `  ${JSON.stringify(r)},`).join("\n")}
];

/**
 * Prices, keyed by id. Bare ids are aliased too: a native API calls it \`claude-sonnet-4-5\` where
 * OpenRouter calls it \`anthropic/claude-sonnet-4.5\`, and both should be priced.
 */
export const GENERATED_PRICES: Record<string, Price> = (() => {
  const table: Record<string, Price> = { "local/*": { in: 0, out: 0 } };
  for (const [id, , , , inUsd, outUsd, cachedUsd] of GENERATED_MODELS) {
    const price: Price = cachedUsd ? { in: inUsd, out: outUsd, cachedIn: cachedUsd } : { in: inUsd, out: outUsd };
    table[id] = price;
    const bare = id.includes("/") ? id.slice(id.indexOf("/") + 1) : undefined;
    if (bare && !table[bare]) table[bare] = price;
  }
  return table;
})();
`;

// ── The Hivey presets ─────────────────────────────────────────────────────────────────────────
//
// Three pseudo-models — Free, Smart, Pro — each of which is not a model but a ROUTING: one model
// per kind of work, so an ordinary question is not answered by the model reserved for the hard one
// and a commit message is not written by the model that costs twenty dollars a million tokens.
// This is the idea the sidebar and the web HiveyCode both settled on, brought here.
//
// What is different here, and deliberately so: the sibling projects ask a small model to CLASSIFY
// the request before answering it — a whole extra call, on every turn, before a word is written.
// This extension already knows the kind of work from the task itself (a completion is not a chat
// turn, a commit message is not an agent run) and already grades the hard ones with the router's
// own classifier, which costs nothing and adds no latency. So the routing is read from what is
// happening rather than bought from a model.
//
// The table is GENERATED for the same reason the price catalogue is: a model id written by hand is
// correct the day it is written and silently 404s within weeks. Nothing below names a version —
// the rules name a budget, a capability and a family, and the newest model that satisfies them
// wins, every day, in a diff a human can read.
const HIVEY_OUT = "src/core/router/hivey.generated.ts";

// Vendors whose models are worth reaching for first. Names, never versions: a vendor is stable for
// years, a version for weeks. The bonus is small enough that a genuinely better outsider still wins.
const STRONG_VENDORS = new Set([
  "anthropic", "openai", "google", "x-ai", "deepseek", "qwen", "mistralai", "meta-llama",
  "moonshotai", "z-ai", "nvidia", "cohere",
]);

// A model that advertises code and nothing else is a poor writer of commit messages, and a general
// model is a poor completion engine. The preference goes both ways, which is why it is signed.
const CODEY = /cod(?:e|er|ing)|devstral|laguna|starcoder|seed-.*code|qwen.*coder/i;

/**
 * What each role needs, and what each preset will pay for it.
 *
 * `ceiling` is dollars per million OUTPUT tokens — the number that dominates the bill on an agent
 * turn. `want` is the only other decision: a role either wants the cheapest model that clears the
 * bar, or the most capable one the budget can reach. Nothing else varies, which is what makes the
 * three presets comparable to each other and explainable in one line.
 */
const HIVEY_ROLES = {
  // Titles, commit messages, summaries, classification. High frequency, low value per call — and
  // the traffic that decides whether this costs cents or tens of dollars a day.
  chore: { tools: false, want: "cheap", minContext: 16000, ceiling: { "hivey/free": 0, hivey: 1.5, "hivey/smart": 5 } },
  // An ordinary chat turn.
  everyday: { tools: true, want: "capable", minContext: 64000, ceiling: { "hivey/free": 0, hivey: 8, "hivey/smart": 30 } },
  // An agent turn, or a question the router graded hard. The role the presets exist to separate.
  deep: { tools: true, want: "capable", minContext: 128000, ceiling: { "hivey/free": 0, hivey: 25, "hivey/smart": 150 } },
  // Inline completion: one request per keystroke pause. Fast, cheap, and code-shaped, or not at all.
  completion: { tools: false, want: "cheap", codey: true, minContext: 8000, ceiling: { "hivey/free": 0, hivey: 1.5, "hivey/smart": 1.5 } },
};

const HIVEY_VARIANT_IDS = ["hivey/free", "hivey", "hivey/smart"];

function curateHivey(all) {
  const out = {};
  const newest = Math.max(...all.map((m) => m.created || 0), 1);
  const outPrice = (m) => {
    const n = Number(m.pricing?.completion);
    return Number.isFinite(n) ? n * 1_000_000 : Infinity;
  };
  const textOut = (m) => (m.architecture?.output_modalities ?? ["text"]).includes("text");
  const hasTools = (m) => (m.supported_parameters ?? []).includes("tools");
  // A model that advertises code is what you want completing a line and not what you want writing
  // a commit message, so the preference is signed rather than absolute.
  const codey = (m) => CODEY.test(m.id);
  // Billions of parameters, when the id says so. On the free pool every price is zero, so this is
  // the only capability signal left there.
  const size = (m) => {
    const b = /[-/](\d{1,4})b\b/i.exec(m.id);
    return b ? Math.min(Number(b[1]), 200) / 200 : 0;
  };

  /** Everything that could serve any role of this preset, before the role's own budget applies. */
  const eligible = (m, wantFree) => {
    if (/^~/.test(m.id)) return false; // a moving alias is not a stable id to commit
    if (/preview|-exp\b|experimental|:extended|:thinking|:online/i.test(m.id)) return false;
    // A `:batch` endpoint costs half and answers in hours. Half price is no price at all for a
    // panel whose whole contract is that the answer starts arriving while you watch.
    if (/:batch$/.test(m.id)) return false;
    // OpenRouter's own `auto` and `pareto` products are routers, not models. Picking one would mean
    // this table routes to a router: an unpredictable model at an unpredictable price, chosen by
    // someone else's rules. A preset has to be able to say what it runs. (They also quote no price,
    // which a budget then reads as "free" — that is how `openrouter/auto-beta` once won the
    // cheapest role of all three presets at once.)
    if (m.id.startsWith("openrouter/")) return false;
    if (wantFree !== /:free$/.test(m.id)) return false;
    if (!textOut(m)) return false;
    // On a paid preset, a model quoting no price is a model whose bill cannot be predicted.
    return wantFree || outPrice(m) > 0;
  };

  for (const variant of HIVEY_VARIANT_IDS) {
    const wantFree = variant === "hivey/free";
    const universe = all.filter((m) => eligible(m, wantFree));
    // The price ladder is built over the WHOLE universe, not over each role's shortlist, and that
    // is what keeps the three presets in order. Ranked inside its own shortlist, a $25 flagship
    // looked cheap against a $150 budget and dear against a $25 one — so Pro chose a $2.50 model
    // for its deep role while Smart chose the flagship. Against a fixed ladder, raising a budget
    // can only add candidates, so a dearer preset is never served a worse model than a cheaper one.
    const prices = [...new Set(universe.map(outPrice))].sort((a, b) => a - b);
    const rank = (m) => (prices.length < 2 ? 0.5 : prices.indexOf(outPrice(m)) / (prices.length - 1));

    out[variant] = {};
    for (const [role, need] of Object.entries(HIVEY_ROLES)) {
      const ceiling = need.ceiling[variant];
      const cheap = need.want === "cheap";
      const score = (m) => {
        let s = 1.5 * ((m.created || 0) / newest);
        // Saturating, because a window is a threshold and not a quantity: past a few hundred
        // thousand tokens the extra million buys this extension nothing, and rewarding it linearly
        // let one enormous window outweigh every other property a model has.
        s += (cheap ? 0.4 : 1.2) * (Math.min(m.context_length || 0, 400_000) / 400_000);
        if (STRONG_VENDORS.has(m.id.split("/")[0])) s += cheap ? 0.4 : 1.2;
        if (codey(m)) s += need.codey ? 0.8 : -1;
        // Price is the only capability signal this catalogue carries, and it is a weak one — so it
        // is read in the direction the role wants and never on its own.
        s += cheap ? 1.5 * (1 - rank(m)) - 0.3 * size(m) : 1.6 * rank(m) + 0.5 * size(m);
        return s;
      };
      const pick = (withTools) => {
        const pool = universe.filter(
          (m) =>
            (!withTools || hasTools(m)) &&
            (m.context_length || 0) >= need.minContext &&
            outPrice(m) <= ceiling,
        );
        return pool.sort((a, b) => score(b) - score(a))[0];
      };
      // Tools are required where the role drives a tool loop — but a preset with no tool-capable
      // model in its budget must still answer, so the requirement is relaxed rather than the role
      // left empty. That case is real: the free pool is eighteen models on a good day.
      const chosen = (need.tools ? pick(true) : undefined) ?? pick(false);
      if (chosen) out[variant][role] = chosen.id;
    }
  }
  return out;
}

const hivey = curateHivey(data ?? []);
const hiveyBody = `// GENERATED FILE — do not edit by hand.
// Written by \`npm run models\` (scripts/update-models.mjs); the daily workflow commits the diff.
//
// Which model each Hivey preset uses for each kind of work. Chosen by rule from OpenRouter's own
// catalogue — budget, capability, vendor family, recency — so that no version is ever named in this
// repository's source. When a vendor ships a successor, this file moves; nothing else does.
//
// The rules live in scripts/update-models.mjs. Read them there before doubting a row.

export const HIVEY_GENERATED_AT = ${JSON.stringify(new Date().toISOString().slice(0, 10))};

/** variant → role → model id. */
export const HIVEY_ROUTING: Record<string, Record<string, string>> = ${JSON.stringify(hivey, null, 2)};
`;

const strip = (s) => s.replace(/export const (?:HIVEY_)?GENERATED_AT = "[^"]*";/, "");
const files = [
  { path: OUT, body, what: `${kept} models` },
  { path: HIVEY_OUT, body: hiveyBody, what: `${HIVEY_VARIANT_IDS.length} Hivey presets` },
];

let stale = false;
for (const file of files) {
  const previous = await readFile(file.path, "utf8").catch(() => "");
  if (strip(previous) === strip(file.body)) {
    console.log(`${file.path} already current (${file.what}).`);
    continue;
  }
  stale = true;
  if (check) {
    console.error(`${file.path} is out of date. Run \`npm run models\`.`);
    continue;
  }
  await writeFile(file.path, file.body, "utf8");
  console.log(`Wrote ${file.path} — ${file.what}.`);
}
process.exit(check && stale ? 1 : 0);
