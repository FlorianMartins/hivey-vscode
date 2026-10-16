// What each thinking level of the panel puts in the request, per provider and per model family.
//
// ⚠️ « je veux vraiment que quand on bascule le mode de réflexion qu'il change vraiment le niveau
// de réflexion sur tous les modèles cloud et locaux ou gateway ». The panel has four levels —
// Direct, Bref, Standard, Approfondi (`ReasoningEffort` "none" | "low" | "medium" | "high") — and
// before this file each provider translated them on its own, by guesswork:
//
//   • Anthropic got `thinking: {type: "enabled", budget_tokens}` on every model — a 400 on every
//     current Claude since Opus 4.7, where adaptive thinking and `output_config.effort` replaced it.
//   • OpenRouter got `reasoning: {exclude: true}` for Direct — which only HIDES the reasoning: the
//     model went on thinking, and billing for it.
//   • Clouds got nothing at all for Direct, so a model that thinks by default thought at its default.
//
// So the levels are translated HERE, in one place, with the vendor's documentation cited beside
// each rule. The providers ask this file what to send; the panel asks it which levels a model really
// has, so the menu never offers a level that would be the same request as another one, or a 400.
//
// The refused-field safety net in `openai.ts` (`adaptRequest`) stays — a gateway can always be
// stricter than its upstream — but nothing here relies on it: every mapping below is one the
// vendor documents as accepted for that model family.

import type { ReasoningEffort } from "./types.js";
import { THINKING_BUDGET } from "./types.js";
import type { ReasoningChoice } from "../router/reasoningLevels.js";
import { GENERATED_REASONING_EFFORTS } from "../router/reasoningEfforts.generated.js";
import { reasoningSupport } from "../router/reasoning.js";

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// Anthropic (native Messages API, also Bedrock "anthropic."-prefixed ids and Vertex "@date" ids)
// ─────────────────────────────────────────────────────────────────────────────────────────────────
//
// Sources (current API reference, 2026):
//   https://platform.claude.com/docs/en/build-with-claude/adaptive-thinking
//   https://platform.claude.com/docs/en/build-with-claude/effort
//   https://platform.claude.com/docs/en/build-with-claude/extended-thinking
//   https://platform.claude.com/docs/en/about-claude/models/migration-guide
//
// The rules that decide the request, per family:
//
//   family                         thinking on          thinking off (Direct)             sampling
//   ─────────────────────────────  ───────────────────  ────────────────────────────────  ─────────
//   Fable 5 / 5.1 (Mythos)         adaptive + effort    impossible: adaptive, effort low  400
//   Opus ≥ 5.5                     adaptive + effort    impossible: adaptive, effort low  400
//   Opus 5                         adaptive + effort    {type:"disabled"} (effort ≤ high) 400
//   Opus 4.7 / 4.8                 adaptive (explicit)  {type:"disabled"}                 400
//   Opus 4.6 / Sonnet 4.6          adaptive + effort    {type:"disabled"}                 allowed*
//   Sonnet ≥ 5.5                   adaptive + effort    {type:"between_tools"} (≤ high)   non-default 400
//   Sonnet 5                       adaptive + effort    {type:"disabled"}                 400
//   Haiku ≥ 5.5                    adaptive + effort    {type:"disabled"} (effort ≤ high) non-default 400
//   Opus 4.5 and older, Sonnet 4.5
//   and older (3.7+), Haiku 4.5    enabled+budget_tokens omitted                          allowed*
//   Claude 3.5 and older           — (no thinking)      omitted                           allowed
//
//   * a temperature and thinking cannot both be set, so it is sent only with thinking off.
//
// Efforts: Bref → "low", Standard → "medium", Approfondi → "xhigh" where the family has it (Opus
// 4.7+, Sonnet 5+, Haiku 5.5, Fable), "high" on Opus 4.6 / Sonnet 4.6 which stop there. Approfondi
// is NOT "high" on the newer models because "high" is their DEFAULT (except Opus 5.5 and Haiku 5.5,
// medium): the deepest level would then have been the same request as sending nothing.
//
// `display: "summarized"` is asked wherever adaptive thinking is sent to a family whose default is
// "omitted" (everything from Opus 4.7 on): the panel shows the thinking, and the default streams
// thinking blocks with empty text. Never with `between_tools`, which takes no other field.

export type AnthropicTier = "opus" | "sonnet" | "haiku" | "fable";

export interface AnthropicFamily {
  tier: AnthropicTier | "unknown";
  /** Major and minor version, e.g. 4.8 → [4, 8]. Unknown ids get the newest rules. */
  version: [number, number];
  /** How thinking is asked for at all. */
  style: "adaptive" | "budget" | "none";
  /** How it is turned off. "never" when the model always thinks. */
  off: "disabled" | "between_tools" | "omit" | "never";
  /** Whether `xhigh` exists on this family. */
  xhigh: boolean;
  /** temperature / top_p / top_k: "allowed", or refused ("rejected" = any value, "nondefault"). */
  sampling: "allowed" | "rejected" | "nondefault";
  /** Whether thinking text is empty unless `display: "summarized"` is asked for. */
  displayOmitted: boolean;
  /** The effort used when none is sent. */
  defaultEffort?: "medium" | "high";
}

/** Anthropic version ordering, so "newer than" is a comparison rather than a list of names. */
function atLeast(v: [number, number], major: number, minor: number): boolean {
  return v[0] > major || (v[0] === major && v[1] >= minor);
}

/**
 * The family a Claude model id belongs to — any spelling: `claude-opus-4-8`, `claude-sonnet-4-5-20250929`,
 * `anthropic.claude-opus-5-5` (Bedrock), `us.anthropic.claude-haiku-4-5-20251001-v1:0`,
 * `claude-opus-4-5@20251101` (Vertex), `anthropic/claude-opus-4.8` (OpenRouter), `claude-3-7-sonnet-latest`.
 */
export function anthropicFamily(model: string): AnthropicFamily {
  const id = model.toLowerCase().replace(/@.*$/, "");
  // New naming: tier then version — `opus-4-8`, `opus-4.8`, `fable-5`, `opus-4` (4.0). A date suffix
  // (`-20250929`) is not a minor version: only one or two digits count.
  const modern = /(opus|sonnet|haiku|fable|mythos)[-.]?(\d+)(?:[-.](\d{1,2}))?(?!\d)/.exec(id);
  // Old naming: version then tier — `claude-3-7-sonnet`, `claude-3-opus`, `claude-3-5-haiku`.
  const legacy = /claude-(\d+)(?:[-.](\d{1,2}))?-(opus|sonnet|haiku)/.exec(id);
  let tier: AnthropicFamily["tier"] = "unknown";
  let version: [number, number] = [99, 0];
  if (legacy) {
    tier = legacy[3] as AnthropicTier;
    version = [Number(legacy[1]), Number(legacy[2] ?? 0)];
  } else if (modern) {
    tier = modern[1] === "mythos" ? "fable" : (modern[1] as AnthropicTier);
    version = [Number(modern[2]), Number(modern[3] ?? 0)];
  }
  return familyRules(tier, version);
}

function familyRules(tier: AnthropicFamily["tier"], v: [number, number]): AnthropicFamily {
  const base = { tier, version: v };
  // Claude 3.5 and older have no extended thinking at all; 3.7 introduced the budget.
  if (tier !== "unknown" && tier !== "fable" && !atLeast(v, 3, 7)) {
    return { ...base, style: "none", off: "omit", xhigh: false, sampling: "allowed", displayOmitted: false };
  }
  const budget = { ...base, style: "budget" as const, off: "omit" as const, xhigh: false, sampling: "allowed" as const, displayOmitted: false };
  switch (tier) {
    case "fable":
      return { ...base, style: "adaptive", off: "never", xhigh: true, sampling: "rejected", displayOmitted: true, defaultEffort: "high" };
    case "opus":
      if (atLeast(v, 5, 5)) return { ...base, style: "adaptive", off: "never", xhigh: true, sampling: "rejected", displayOmitted: true, defaultEffort: "medium" };
      if (atLeast(v, 5, 0)) return { ...base, style: "adaptive", off: "disabled", xhigh: true, sampling: "rejected", displayOmitted: true, defaultEffort: "high" };
      if (atLeast(v, 4, 7)) return { ...base, style: "adaptive", off: "disabled", xhigh: true, sampling: "rejected", displayOmitted: true, defaultEffort: "high" };
      if (atLeast(v, 4, 6)) return { ...base, style: "adaptive", off: "disabled", xhigh: false, sampling: "allowed", displayOmitted: false, defaultEffort: "high" };
      return budget;
    case "sonnet":
      if (atLeast(v, 5, 5)) return { ...base, style: "adaptive", off: "between_tools", xhigh: true, sampling: "nondefault", displayOmitted: true, defaultEffort: "high" };
      if (atLeast(v, 5, 0)) return { ...base, style: "adaptive", off: "disabled", xhigh: true, sampling: "rejected", displayOmitted: true, defaultEffort: "high" };
      if (atLeast(v, 4, 6)) return { ...base, style: "adaptive", off: "disabled", xhigh: false, sampling: "allowed", displayOmitted: false, defaultEffort: "high" };
      return budget;
    case "haiku":
      if (atLeast(v, 5, 0)) return { ...base, style: "adaptive", off: "disabled", xhigh: true, sampling: "nondefault", displayOmitted: true, defaultEffort: "medium" };
      return budget;
    default:
      // A Claude id nothing here can read — an alias, a private deployment name. The newest rules are
      // the safe ones: adaptive is accepted by every current model, and thinking is never "turned off"
      // by a field a model might refuse — Direct becomes the lowest effort instead.
      return { ...base, style: "adaptive", off: "never", xhigh: false, sampling: "rejected", displayOmitted: true };
  }
}

export interface AnthropicThinking {
  /** The `thinking` field, when one is sent. */
  thinking?: Record<string, unknown>;
  /** The `output_config.effort`, when one is sent. */
  effort?: "low" | "medium" | "high" | "xhigh";
  /** Tokens the thinking may take before the answer starts — added to a caller's `max_tokens`. */
  headroom: number;
  /** Whether a temperature may go in the same request. */
  temperature: boolean;
}

/** The effort a panel level is on this family. */
function anthropicEffort(f: AnthropicFamily, level: Exclude<ReasoningEffort, "none">): "low" | "medium" | "high" | "xhigh" {
  if (level === "high") return f.xhigh ? "xhigh" : "high";
  return level;
}

/**
 * The thinking part of an Anthropic request for this model and level. `undefined` level = nothing
 * was chosen: the model's own default, untouched (only the sampling rule still applies).
 */
export function anthropicThinking(model: string, level: ReasoningEffort | undefined): AnthropicThinking {
  const f = anthropicFamily(model);
  const sampling = f.sampling === "allowed";
  if (!level || f.style === "none") return { headroom: 0, temperature: sampling };

  if (f.style === "budget") {
    if (level === "none") return { headroom: 0, temperature: sampling };
    const budget = THINKING_BUDGET[level];
    return { thinking: { type: "enabled", budget_tokens: budget }, headroom: budget, temperature: false };
  }

  const adaptive = (): Record<string, unknown> => (f.displayOmitted ? { type: "adaptive", display: "summarized" } : { type: "adaptive" });
  if (level === "none") {
    switch (f.off) {
      // No effort with it: Direct turns the THINKING off, not the care of the answer — and on Opus 5
      // and Haiku 5.5 `disabled` is refused above `high`, which no default exceeds.
      case "disabled":
        return { thinking: { type: "disabled" }, headroom: 0, temperature: sampling };
      // Sonnet 5.5: `disabled` is a 400; `between_tools` takes no other field and is accepted at
      // `high` or below — the default.
      case "between_tools":
        return { thinking: { type: "between_tools" }, headroom: 0, temperature: false };
      case "omit":
        return { headroom: 0, temperature: sampling };
      // Opus 5.5, Fable: thinking cannot be off. The least it does is adaptive at `low` — and the
      // panel does not offer Direct on these models (see `reasoningMenu`), so this is only reached by
      // a chore or a level carried over from another model.
      case "never":
        return { thinking: adaptive(), effort: "low", headroom: THINKING_BUDGET.low, temperature: false };
    }
  }
  return { thinking: adaptive(), effort: anthropicEffort(f, level), headroom: THINKING_BUDGET[level], temperature: false };
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// The level menu, per model
// ─────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * The levels the panel offers for a model, when this file knows that model's rules; `undefined`
 * keeps the usual four. Only levels that are a DIFFERENT request from one another, and none that
 * would be a 400 — so "Direct" is absent where thinking cannot be turned off.
 */
export function reasoningMenu(provider: string, model: string): ReasoningChoice[] | undefined {
  const all: ReasoningChoice[] = [
    { id: "none", native: "none" },
    { id: "low", native: "low" },
    { id: "medium", native: "medium" },
    { id: "high", native: "high" },
  ];
  if (provider === "anthropic") {
    const f = anthropicFamily(model);
    if (f.style === "none") return undefined;
    if (f.style === "budget") return all.map((c) => (c.id === "none" ? c : { ...c, native: `${THINKING_BUDGET[c.id]} tokens` }));
    const menu = all
      .filter((c) => c.id !== "none" || f.off !== "never")
      .map((c) => {
        const t = anthropicThinking(model, c.id);
        const native = c.id === "none" ? (f.off === "between_tools" ? "between_tools" : "none") : (t.effort ?? c.id);
        return { ...c, native, ...(f.defaultEffort && t.effort === f.defaultEffort ? { isDefault: true } : {}) };
      });
    return menu;
  }
  if (isSelfHosted(provider)) return undefined; // the server's own template says — see reasoningLevels.ts
  const profile = profileFor(provider, model);
  if (!profile) return [];
  const a = assign(profile);
  // OpenAI's Chat Completions refuses tool calls with any effort but "none" from GPT-5.4 on, and an
  // agent turn always carries tools: on those models through this API, only Direct is real.
  if (provider === "openai" && toolsForbidThinking(model) && a.none) return [{ id: "none", native: "none" }];
  return LEVEL_ORDER.flatMap((id) => {
    const native = a[id];
    if (!native) return [];
    return [{ id, native, ...(profile.defaultEffort && native === profile.defaultEffort ? { isDefault: true } : {}) }];
  });
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// The OpenAI wire format: OpenRouter, the direct vendors, the self-hosted servers
// ─────────────────────────────────────────────────────────────────────────────────────────────────
//
// One model, many spellings: every vendor below takes an effort WORD (or, for Qwen on DashScope, an
// on/off switch and a token budget), and each model accepts its own subset of the words. So a model
// is described by a PROFILE — the efforts it accepts, weakest first, with "none" only when thinking
// can really be turned off — and the four panel levels are laid onto that profile:
//
//   Approfondi → "xhigh" if the model has it, else "high" (never "max": it is the one level that can
//                 cost an order of magnitude more, and nothing in the panel asks for that)
//   Bref       → "low" if it has it, else its weakest effort below Approfondi
//   Standard   → "medium" if it has it (and it is not Bref), else the next effort above Bref
//   Direct     → "none" — only where the model accepts it; elsewhere Direct is not offered, and a
//                 level carried over from another model is sent as the weakest effort it has
//
// A level the model has no distinct effort for is left OFF the menu rather than sent as the same
// request as its neighbour. Where the profiles come from, per provider:
//
//   openrouter  OpenRouter's own catalogue (`reasoning.supported_efforts` / `mandatory`), regenerated
//               daily into reasoningEfforts.generated.ts. Body: `reasoning: {effort}`; Direct is
//               `reasoning: {effort: "none"}`, which "disables reasoning entirely" — NOT
//               `{exclude: true}`, which only hides it while the model thinks and bills as before.
//               https://openrouter.ai/docs/use-cases/reasoning-tokens
//   openai      The same catalogue under `openai/…`, else the family: o-series low–high (cannot be
//               off), gpt-5 minimal–high, gpt-5.1+ none–high, gpt-4.x / chat models: no thinking,
//               field never sent. Body: `reasoning_effort`; a temperature is dropped with any effort
//               but none. From GPT-5.4 Chat Completions refuses tool calls with any effort but
//               "none", so a request carrying tools is sent "none".
//               https://developers.openai.com/api/docs/guides/reasoning
//               https://developers.openai.com/api/docs/guides/migrate-to-responses
//   google      The catalogue under `google/…`, else: 2.5 Flash/Flash-Lite none–high, 2.5 Pro and
//               3.x+ low–high (thinking cannot be turned off), older: none. Body: `reasoning_effort`.
//               https://ai.google.dev/gemini-api/docs/openai  https://ai.google.dev/gemini-api/docs/thinking
//   deepseek    deepseek-flash / deepseek-v4-*: `thinking: {type: "enabled"|"disabled"}` plus
//               `reasoning_effort` low | high | max (medium is high there). deepseek-chat /
//               deepseek-reasoner (deprecated aliases): nothing can be set.
//               https://api-docs.deepseek.com/guides/thinking_mode
//   mistral     mistral-small / medium / large: `reasoning_effort` "high" or "none", nothing else;
//               Magistral (deprecated) and the rest: no control. https://docs.mistral.ai/capabilities/reasoning/
//   xai         The catalogue under `x-ai/…` (grok-4.5+: low–high, xhigh from 4.6, never off; grok-4.3
//               none–high). Unknown grok: no control. https://docs.x.ai/docs/guides/reasoning
//   groq        qwen3*: none / low / medium / high; gpt-oss: low–high; others: no control.
//               https://console.groq.com/docs/reasoning
//   perplexity  sonar-deep-research: low–high; the other Sonar models: no control.
//               https://docs.perplexity.ai/docs/sonar/models/sonar-deep-research
//   qwen        DashScope compatible mode: `enable_thinking` true/false and `thinking_budget` (tokens),
//               on the hybrid models; thinking-only models (catalogue `mandatory`) keep it on.
//               https://www.alibabacloud.com/help/en/model-studio/deep-thinking
//   local, openai-compatible (the user's own server or gateway)
//               `reasoning_effort` as the panel says it, "none" for Direct — read by llama.cpp as
//               enable_thinking=false, by vLLM likewise, by Ollama as think=false. The levels a
//               template really has come from its own refusal (core/router/reasoningLevels.ts), and
//               which word is sent for each panel level goes through `selfHostedEffort` below.
//               https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md
//               https://docs.vllm.ai/en/latest/features/reasoning_outputs.html
//               https://docs.ollama.com/api/openai-compatibility

type Effort = "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
const RANK: Effort[] = ["none", "minimal", "low", "medium", "high", "xhigh", "max"];
const rank = (e: Effort): number => RANK.indexOf(e);
const LEVEL_ORDER: ReasoningEffort[] = ["none", "low", "medium", "high"];

export interface ReasoningProfile {
  /** Efforts the model accepts, weakest first. "none" only when thinking can be turned off. */
  efforts: Effort[];
  defaultEffort?: Effort;
}

function isSelfHosted(provider: string): boolean {
  return provider === "local" || provider === "openai-compatible";
}

function profile(efforts: Effort[], defaultEffort?: string): ReasoningProfile {
  const sorted = [...new Set(efforts)].filter((e) => rank(e) >= 0).sort((a, b) => rank(a) - rank(b));
  return { efforts: sorted, ...(defaultEffort && rank(defaultEffort as Effort) >= 0 ? { defaultEffort: defaultEffort as Effort } : {}) };
}

/** OpenRouter's catalogue entry for this id, as a profile. */
function fromCatalogue(id: string): ReasoningProfile | undefined {
  const row = GENERATED_REASONING_EFFORTS[id] ?? GENERATED_REASONING_EFFORTS[id.replace(/:[a-z]+$/, "")];
  if (!row) return undefined;
  const listed = (row.e ?? ["low", "medium", "high"]) as Effort[];
  // Not mandatory means it can be off, whether or not "none" is in the list (OpenRouter's own
  // documented switch); mandatory means "none" is refused, even when listed.
  const efforts = row.m ? listed.filter((e) => e !== "none") : [...listed, "none" as const];
  return profile(efforts, row.d);
}

const VENDOR_PREFIX: Record<string, string> = {
  openai: "openai",
  google: "google",
  deepseek: "deepseek",
  mistral: "mistralai",
  xai: "x-ai",
  qwen: "qwen",
  perplexity: "perplexity",
};

/** `gpt-5.4` → [5, 4]; undefined for anything that is not a numbered GPT. */
function gptVersion(model: string): [number, number] | undefined {
  const m = /(?:^|\/)gpt-(\d+)(?:\.(\d+))?/.exec(model.toLowerCase());
  return m ? [Number(m[1]), Number(m[2] ?? 0)] : undefined;
}

/** From GPT-5.4, Chat Completions takes tool calls only with `reasoning_effort: "none"`. */
export function toolsForbidThinking(model: string): boolean {
  const v = gptVersion(model);
  return Boolean(v && (v[0] > 5 || (v[0] === 5 && v[1] >= 4)));
}

/** The efforts this model accepts through this provider; undefined when it cannot be steered at all. */
export function profileFor(provider: string, model: string): ReasoningProfile | undefined {
  const id = model.replace(/^models\//, "");
  const lower = id.toLowerCase();
  const ALL: Effort[] = ["none", "low", "medium", "high"];
  const ALWAYS: Effort[] = ["low", "medium", "high"];
  switch (provider) {
    case "openrouter": {
      const known = fromCatalogue(id);
      if (known) return known;
      if (lower.startsWith("anthropic/")) {
        const f = anthropicFamily(lower);
        if (f.style === "none") return undefined;
        const on: Effort[] = f.xhigh ? ["low", "medium", "high", "xhigh"] : ["low", "medium", "high"];
        return profile(f.off === "never" ? on : ["none", ...on], f.defaultEffort);
      }
      return reasoningSupport(id) === "no" ? undefined : profile(ALL);
    }
    case "anthropic":
      return undefined; // its own native mapping, above
    case "deepseek":
      // The deprecated aliases are fixed: deepseek-chat never thinks, deepseek-reasoner always does.
      if (/deepseek-(chat|reasoner)$/.test(lower)) return undefined;
      return profile(["none", "low", "high", "max"], "high");
    case "mistral":
      return fromCatalogue(`mistralai/${id}`) ?? (/mistral-(small|medium|large)/.test(lower) ? profile(["none", "high"], "high") : undefined);
    case "groq":
      if (/qwen3/.test(lower)) return profile(ALL);
      if (/gpt-oss/.test(lower)) return profile(ALWAYS);
      return undefined;
    case "perplexity":
      return /sonar-deep-research/.test(lower) ? profile(ALWAYS, "medium") : undefined;
    case "qwen": {
      const known = fromCatalogue(`qwen/${id}`);
      if (known) return profile(known.efforts.includes("none") ? ALL : ALWAYS);
      return /qwen3|qwq|deepseek|glm|kimi|minimax/.test(lower) ? profile(ALL) : undefined;
    }
    case "openai": {
      const known = fromCatalogue(`openai/${id}`);
      if (known) return known;
      if (/^o\d/.test(lower)) return profile(ALWAYS, "medium");
      if (/gpt-oss/.test(lower)) return profile(ALWAYS, "medium");
      const v = gptVersion(lower);
      if (!v || v[0] < 5 || /chat/.test(lower)) return undefined;
      return v[0] === 5 && v[1] === 0 ? profile(["minimal", "low", "medium", "high"], "medium") : profile(ALL, "medium");
    }
    case "google": {
      const known = fromCatalogue(`google/${id}`);
      if (known) return known;
      if (/gemini-2\.5-flash/.test(lower)) return profile(ALL);
      if (/gemini-(2\.5|[3-9]|\d{2})/.test(lower)) return profile(ALWAYS);
      return undefined;
    }
    case "xai":
      return fromCatalogue(`x-ai/${id}`);
    default: {
      const prefix = VENDOR_PREFIX[provider];
      return prefix ? fromCatalogue(`${prefix}/${id}`) : undefined;
    }
  }
}

/** The four panel levels laid onto a profile — see the table above. */
export function assign(p: ReasoningProfile): Partial<Record<ReasoningEffort, Effort>> {
  const on = p.efforts.filter((e) => e !== "none");
  const out: Partial<Record<ReasoningEffort, Effort>> = {};
  if (p.efforts.includes("none")) out.none = "none";
  if (!on.length) return out;
  const deep: Effort = on.includes("xhigh") ? "xhigh" : on.includes("high") ? "high" : on[on.length - 1]!;
  out.high = deep;
  const below = on.filter((e) => rank(e) < rank(deep));
  const brief = below.includes("low") ? "low" : below[0];
  if (brief) {
    out.low = brief;
    const standard = below.includes("medium") && brief !== "medium" ? "medium" : below.find((e) => rank(e) > rank(brief));
    if (standard) out.medium = standard;
  }
  return out;
}

/** The effort a level is SENT as on this profile — including a level the menu does not offer. */
export function effortFor(p: ReasoningProfile, level: ReasoningEffort): Effort | undefined {
  const a = assign(p);
  if (a[level]) return a[level];
  const on = p.efforts.filter((e) => e !== "none");
  if (!on.length) return a.none;
  // Direct where thinking cannot be off: the least the model does.
  if (level === "none") return on[0];
  // Otherwise the nearest level the profile has, the cheaper one on a tie.
  const wanted = LEVEL_ORDER.indexOf(level);
  const near = LEVEL_ORDER.filter((l) => l !== "none" && a[l]).sort((x, y) => Math.abs(LEVEL_ORDER.indexOf(x) - wanted) - Math.abs(LEVEL_ORDER.indexOf(y) - wanted) || LEVEL_ORDER.indexOf(x) - LEVEL_ORDER.indexOf(y));
  return near.length ? a[near[0]!] : on[0];
}

/**
 * ⚙️ THE SELF-HOSTED MAPPING HOOK — the word sent to the user's own server (llama.cpp, vLLM,
 * Ollama, a llama-swap gateway) for each panel level.
 *
 * Today it is the panel's own word: "low", "medium", "high" (which Qwen3.8's template runs as its
 * "xhigh"), and "none" for thinking off. ⚠️ Measured on Qwen3.8: its "low" thinks LONGER than its
 * "medium" (3.7–7.4k against 1.3–3.9k characters on the same step), so on that template Bref is not
 * the lighter of the two. Which word each label should send there is for the owner's benchmark to
 * decide; change it here, and only here.
 */
export function selfHostedEffort(level: ReasoningEffort): string {
  return level;
}

export interface WireReasoning {
  /** Fields to put in the request body. */
  fields: Record<string, unknown>;
  /** A temperature cannot go with this request (OpenAI reasoning models with an effort). */
  dropTemperature: boolean;
}

/**
 * The reasoning fields of an OpenAI-shaped request for this provider, model and level.
 * `level` undefined: nothing chosen, the model's own default — nothing is sent.
 */
export function wireReasoning(
  provider: string,
  model: string,
  level: ReasoningEffort | undefined,
  opts: { tools?: boolean; chore?: boolean } = {},
): WireReasoning {
  const none: WireReasoning = { fields: {}, dropTemperature: false };
  if (isSelfHosted(provider)) {
    // A side task on the user's own server: thinking OFF, whatever the panel says — a commit
    // message does not need the template's default effort.
    if (opts.chore) return { fields: { reasoning_effort: "none" }, dropTemperature: false };
    return level ? { fields: { reasoning_effort: selfHostedEffort(level) }, dropTemperature: false } : none;
  }
  // A chore on a cloud (a commit message, a suggestion, a translation) is not a level anybody picked:
  // it is sent exactly as before levels were translated per model — the vendor's own thinking, and on
  // OpenRouter the reasoning text left out of the reply (`exclude`, which hides it without changing it).
  if (opts.chore) return provider === "openrouter" ? { fields: { reasoning: { exclude: true } }, dropTemperature: false } : none;
  if (!level || provider === "anthropic") return none;
  const p = profileFor(provider, model);
  if (!p) return none;
  let effort = effortFor(p, level);
  if (!effort) return none;
  switch (provider) {
    case "openrouter":
      return { fields: { reasoning: { effort } }, dropTemperature: false };
    case "openai":
      if (opts.tools && toolsForbidThinking(model) && p.efforts.includes("none")) effort = "none";
      return { fields: { reasoning_effort: effort }, dropTemperature: effort !== "none" };
    case "deepseek":
      return effort === "none"
        ? { fields: { thinking: { type: "disabled" } }, dropTemperature: false }
        : { fields: { thinking: { type: "enabled" }, reasoning_effort: effort }, dropTemperature: false };
    case "qwen": {
      if (effort === "none") return { fields: { enable_thinking: false }, dropTemperature: false };
      const tokens = effort === "low" || effort === "minimal" ? THINKING_BUDGET.low : effort === "medium" ? THINKING_BUDGET.medium : THINKING_BUDGET.high;
      return { fields: { enable_thinking: true, thinking_budget: tokens }, dropTemperature: false };
    }
    default:
      return { fields: { reasoning_effort: effort }, dropTemperature: false };
  }
}
