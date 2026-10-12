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
const vision = [];
// Models that accept a thinking budget. ⚠️ This used to be a regular expression naming versions —
// `gpt-5|grok-[34]|gemini-[23]|o[134]` — and it rotted exactly as a version in source always does:
// the market moved to `gpt-6`, so `openai/gpt-6.1-sol-pro`, the model BOTH paid presets route their
// deep work to, was reported as unable to reason and the thinking control was hidden on it.
const reasoning = [];
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
  // Which models will actually look at a pasted screenshot. Read from the provider rather than
  // guessed from the name, for the same reason no model version is written by hand here: "gpt" and
  // "gemini" accept images and "gpt-oss" does not, and a heuristic over names is wrong the week
  // after it is written.
  if ((m.architecture?.input_modalities ?? []).includes("image")) vision.push(m.id);
  if ((m.supported_parameters ?? []).includes("reasoning")) reasoning.push(m.id);
  kept++;
}
rows.sort((a, b) => a[0].localeCompare(b[0]));
vision.sort();
reasoning.sort();

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
/**
 * The models that accept an image alongside the question.
 *
 * Bare ids are aliased for the same reason the prices are: a native API calls it \`gpt-5\` where
 * OpenRouter calls it \`openai/gpt-5\`, and somebody pasting a screenshot should not be told their
 * model cannot see it because of a prefix.
 */
export const GENERATED_VISION: ReadonlySet<string> = (() => {
  const ids = ${JSON.stringify(vision)};
  const set = new Set(ids);
  for (const id of ids) {
    const bare = id.includes("/") ? id.slice(id.indexOf("/") + 1) : undefined;
    if (bare) set.add(bare);
  }
  return set;
})();

/**
 * The models that accept a thinking budget.
 *
 * ⚠️ This was a regular expression naming versions, and it rotted the way a version in source always
 * does: it matched \`gpt-5\` and the market moved to \`gpt-6\`, so the model both paid presets route
 * their deep work to was reported as unable to reason — and the control that turns thinking on was
 * hidden on the strongest model in the product. From the catalogue, regenerated daily, like the
 * prices and the windows.
 */
export const GENERATED_REASONING: ReadonlySet<string> = (() => {
  const ids = ${JSON.stringify(reasoning)};
  const set = new Set(ids);
  for (const id of ids) {
    const bare = id.includes("/") ? id.slice(id.indexOf("/") + 1) : undefined;
    if (bare) set.add(bare);
  }
  return set;
})();

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

// The selection rules are NOT here any more.
//
// They lived in this file for months and could not be unit tested, and the defect that moved them
// out is exactly the kind a test catches and a reading does not: the recency term was
// `created / newest` over two Unix timestamps, so it varied by 0.0885 across the whole catalogue
// while a vendor bonus was worth 1.2. The generated file's header claimed "recency" throughout.
// `hivey/smart` ran a model from October 2025 at $120/M with its September 2026 successor available
// at $10/M.
//
// They are in `src/core/router/curate.ts`, with eleven tests, and this script imports the built
// bundle. That is why this workflow now needs `npm ci && npm run build` before it runs.
const { curateHivey, HIVEY_VARIANT_IDS, presetOverlaps } = await import(new URL("../dist/eval-report.mjs", import.meta.url));
const hivey = curateHivey(data ?? []);
// Where a dearer preset bought nothing. Written into the file rather than hidden, because it is a
// fact about the market that the product should state — see `presetOverlaps`.
const overlaps = presetOverlaps(hivey);
const hiveyBody = `// GENERATED FILE — do not edit by hand.
// Written by \`npm run models\` (scripts/update-models.mjs); the daily workflow commits the diff.
//
// Which model each Hivey preset uses for each kind of work. Chosen by rule from OpenRouter's own
// catalogue — budget, capability, vendor family, recency — so that no version is ever named in this
// repository's source. When a vendor ships a successor, this file moves; nothing else does.
//
// The rules live in src/core/router/curate.ts, with their tests. Read them there before doubting a row.

export const HIVEY_GENERATED_AT = ${JSON.stringify(new Date().toISOString().slice(0, 10))};

/**
 * Roles where a dearer preset resolved to the same model as a cheaper one, on the day this ran.
 *
 * Not a defect. It means the strongest current model was already inside the cheaper preset's budget,
 * so the dearer one had nothing better to buy. Stated rather than engineered away: the margin that
 * decided it was 0.007 of a point, and tuning weights until the presets differed would be fitting
 * the rules to one afternoon's catalogue.
 */
export const HIVEY_OVERLAPS: string[] = ${JSON.stringify(overlaps, null, 2)};

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
