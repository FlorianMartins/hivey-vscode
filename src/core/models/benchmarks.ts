// A curated quality index, because nobody publishes one.
//
// The picker wants to answer "which of these 400 models should I use for this?", and the model
// catalogues cannot help: OpenRouter, OpenAI and everyone else expose price, context window and
// modality, and no field whatsoever for how good a model is. So the number below is hand-tuned,
// per model family and per kind of work, and the interface says so — it is labelled as an estimate
// and it sits next to the price, which is a fact.
//
// Two design points worth defending:
//
//   • MATCHED BY FAMILY, not by exact id. There is no version of this table that stays complete:
//     a dozen models appear every week and half of them are a fine-tune of something already
//     listed. A regex on the id, most specific first, keeps `qwen2.5-coder:7b` and
//     `hf.co/user/qwen2.5-coder-7b-GGUF` on the same row, which an exact-id map never does.
//   • THE CATEGORY FOLLOWS THE MODE. A model that is excellent at answering questions can be poor
//     at driving a tool loop, and the difference is exactly what the user is choosing between when
//     they switch from chat to agent. So chat ranks by `global`, plan by `reasoning`, and agent by
//     `agent` — the score moves when the mode moves.
//
// Scores are relative estimates on a 0-100 scale, not measurements. Treat a five-point difference
// as noise and a twenty-point difference as real.

export type BenchCategory = "global" | "agent" | "code" | "reasoning";

type Scores = Partial<Record<BenchCategory, number>>;

/** First match wins, so the specific families are listed before the general ones. */
const FAMILIES: Array<[RegExp, Scores]> = [
  // ── Anthropic Claude ────────────────────────────────────────────────────────────────────────
  [/claude.*opus|opus.*[45]/, { global: 90, agent: 93, code: 91, reasoning: 91 }],
  [/claude.*sonnet|sonnet.*[45]|3\.7-sonnet|3\.5-sonnet/, { global: 87, agent: 89, code: 88, reasoning: 86 }],
  [/claude.*haiku|haiku/, { global: 79, agent: 78, code: 78, reasoning: 75 }],
  [/claude/, { global: 84, agent: 85, code: 85, reasoning: 83 }],
  // ── OpenAI ──────────────────────────────────────────────────────────────────────────────────
  [/gpt-5|o3(?!-mini)|o4(?!-mini)/, { global: 89, agent: 89, code: 89, reasoning: 92 }],
  [/o1|o3-mini|o4-mini/, { global: 84, agent: 82, code: 86, reasoning: 90 }],
  [/gpt-4\.1|gpt-4o|gpt-4-turbo|chatgpt-4o/, { global: 85, agent: 85, code: 84, reasoning: 81 }],
  [/gpt-oss-120b/, { global: 79, agent: 73, code: 77, reasoning: 77 }],
  [/gpt-oss-20b|gpt-oss/, { global: 71, agent: 63, code: 69, reasoning: 67 }],
  [/gpt-4o-mini|gpt-4\.1-mini|gpt-3\.5/, { global: 74, agent: 68, code: 72, reasoning: 68 }],
  // ── Google ──────────────────────────────────────────────────────────────────────────────────
  [/gemini.*(3.*pro|2\.5-pro|2-pro|pro)/, { global: 88, agent: 86, code: 85, reasoning: 88 }],
  [/gemini.*flash|gemini-2\.0|gemini-1\.5/, { global: 81, agent: 77, code: 77, reasoning: 77 }],
  [/gemini/, { global: 83, agent: 80, code: 80, reasoning: 82 }],
  [/gemma-4|gemma4/, { global: 72, agent: 60, code: 66, reasoning: 66 }],
  [/gemma/, { global: 66, agent: 52, code: 60, reasoning: 60 }],
  // ── xAI ─────────────────────────────────────────────────────────────────────────────────────
  [/grok/, { global: 85, agent: 81, code: 81, reasoning: 83 }],
  // ── DeepSeek ────────────────────────────────────────────────────────────────────────────────
  [/deepseek-r1|deepseek.*r1|r1-/, { global: 84, agent: 78, code: 85, reasoning: 91 }],
  [/deepseek.*v3|deepseek-chat|deepseek-v3/, { global: 83, agent: 77, code: 85, reasoning: 81 }],
  [/deepseek/, { global: 81, agent: 75, code: 83, reasoning: 84 }],
  // ── Qwen — the family most likely to be the LOCAL model here ────────────────────────────────
  [/qwen3-coder|qwen.*coder|qwen2\.5-coder/, { global: 79, agent: 81, code: 87, reasoning: 77 }],
  [/qwen3-next|qwen3-235b|qwen3-max|qwen-max/, { global: 81, agent: 75, code: 79, reasoning: 79 }],
  [/qwen3|qwen-3|qwen2\.5/, { global: 77, agent: 70, code: 77, reasoning: 76 }],
  [/qwen/, { global: 73, agent: 64, code: 73, reasoning: 70 }],
  // ── Meta ────────────────────────────────────────────────────────────────────────────────────
  [/llama-4-maverick|llama4-maverick|maverick/, { global: 80, agent: 74, code: 76, reasoning: 76 }],
  [/llama-4-scout|llama4-scout|scout/, { global: 76, agent: 70, code: 72, reasoning: 71 }],
  [/llama-3\.3|llama3\.3|llama-3-70|70b-instruct/, { global: 76, agent: 68, code: 70, reasoning: 70 }],
  [/llama-3\.2-3b|llama-3\.2-1b|3b-instruct|1b-instruct/, { global: 55, agent: 40, code: 48, reasoning: 47 }],
  [/llama/, { global: 70, agent: 60, code: 65, reasoning: 64 }],
  // ── NVIDIA ──────────────────────────────────────────────────────────────────────────────────
  [/nemotron.*(ultra|super|340|253|120)/, { global: 80, agent: 70, code: 74, reasoning: 82 }],
  [/nemotron/, { global: 67, agent: 56, code: 62, reasoning: 66 }],
  // ── Mistral ─────────────────────────────────────────────────────────────────────────────────
  [/codestral/, { global: 74, agent: 68, code: 82, reasoning: 68 }],
  [/mistral-large|mistral-medium|pixtral-large/, { global: 80, agent: 72, code: 78, reasoning: 76 }],
  [/mixtral|mistral-small|ministral|mistral/, { global: 72, agent: 60, code: 70, reasoning: 66 }],
  // ── Cohere ──────────────────────────────────────────────────────────────────────────────────
  [/command-a|command-r-plus|command/, { global: 75, agent: 66, code: 70, reasoning: 68 }],
  [/north-mini-code|north/, { global: 70, agent: 66, code: 78, reasoning: 64 }],
  // ── Small and local-first families ──────────────────────────────────────────────────────────
  [/starcoder|codellama|code-llama/, { global: 60, agent: 48, code: 72, reasoning: 55 }],
  [/granite/, { global: 66, agent: 55, code: 70, reasoning: 62 }],
  [/phi-/, { global: 68, agent: 52, code: 66, reasoning: 66 }],
  [/lfm|liquid/, { global: 52, agent: 38, code: 46, reasoning: 46 }],
  [/glm|chatglm|yi-|zhipu/, { global: 76, agent: 66, code: 76, reasoning: 74 }],
  [/kimi|moonshot/, { global: 78, agent: 70, code: 76, reasoning: 76 }],
  [/dolphin|venice|uncensored/, { global: 64, agent: 48, code: 60, reasoning: 58 }],
];

/**
 * A maker's typical strength, when the exact family is not listed.
 *
 * This is what keeps the picker from showing a dash on most rows. A dash is not neutral
 * information: faced with a column of them the user stops reading the column.
 */
const VENDORS: Record<string, Scores> = {
  anthropic: { global: 85, agent: 87, code: 86, reasoning: 84 },
  openai: { global: 84, agent: 83, code: 83, reasoning: 84 },
  google: { global: 82, agent: 78, code: 79, reasoning: 81 },
  "x-ai": { global: 84, agent: 80, code: 80, reasoning: 82 },
  xai: { global: 84, agent: 80, code: 80, reasoning: 82 },
  "meta-llama": { global: 73, agent: 64, code: 68, reasoning: 67 },
  meta: { global: 73, agent: 64, code: 68, reasoning: 67 },
  qwen: { global: 77, agent: 70, code: 78, reasoning: 76 },
  deepseek: { global: 82, agent: 76, code: 84, reasoning: 84 },
  mistralai: { global: 75, agent: 64, code: 73, reasoning: 70 },
  mistral: { global: 75, agent: 64, code: 73, reasoning: 70 },
  nvidia: { global: 72, agent: 60, code: 66, reasoning: 72 },
  cohere: { global: 74, agent: 64, code: 70, reasoning: 68 },
  microsoft: { global: 70, agent: 56, code: 68, reasoning: 67 },
  ibm: { global: 66, agent: 55, code: 70, reasoning: 62 },
  "01-ai": { global: 74, agent: 62, code: 72, reasoning: 72 },
  moonshotai: { global: 78, agent: 70, code: 76, reasoning: 76 },
  "z-ai": { global: 76, agent: 66, code: 76, reasoning: 74 },
  zhipu: { global: 76, agent: 66, code: 76, reasoning: 74 },
  perplexity: { global: 78, agent: 66, code: 70, reasoning: 74 },
  _default: { global: 64, agent: 52, code: 60, reasoning: 60 },
};

function pick(scores: Scores, category: BenchCategory): number | undefined {
  return scores[category] ?? scores.global;
}

/** The curated index for a model id in a category, or undefined when nothing matches. */
export function modelScore(modelId: string, category: BenchCategory): number | undefined {
  const id = (modelId || "").toLowerCase();
  for (const [re, scores] of FAMILIES) {
    if (re.test(id)) return pick(scores, category);
  }
  // An Ollama tag has no vendor prefix (`qwen2.5-coder:7b`); an OpenRouter id does
  // (`qwen/qwen2.5-coder`). Only the second shape has a vendor to fall back to.
  const vendor = id.includes("/") ? id.split("/")[0]! : "";
  const fromVendor = vendor ? VENDORS[vendor] : undefined;
  if (fromVendor) {
    const value = pick(fromVendor, category);
    if (value !== undefined) return value;
  }
  return pick(VENDORS["_default"]!, category);
}

/** Which kind of work the picker should rank by, given the mode the user is in. */
export function categoryForMode(mode: "chat" | "plan" | "agent"): BenchCategory {
  switch (mode) {
    case "agent":
      return "agent";
    case "plan":
      return "reasoning";
    case "chat":
    default:
      return "global";
  }
}

/**
 * The price bucket a model falls in, by its input price per million tokens.
 *
 * Buckets rather than a continuous scale because the question the user is asking is not "how much
 * exactly" — the price is written next to it — but "is this the cheap kind or the expensive kind",
 * and five buckets answer that at a glance across four hundred rows.
 */
export type PriceTier = "free" | "cheap" | "affordable" | "moderate" | "expensive";

export function priceTier(inUsdPerMillion: number, outUsdPerMillion = 0): PriceTier {
  if (!inUsdPerMillion && !outUsdPerMillion) return "free";
  if (inUsdPerMillion <= 1) return "cheap";
  if (inUsdPerMillion <= 5) return "affordable";
  if (inUsdPerMillion <= 15) return "moderate";
  return "expensive";
}

export const PRICE_TIER_ORDER: Record<PriceTier, number> = {
  free: 0,
  cheap: 1,
  affordable: 2,
  moderate: 3,
  expensive: 4,
};

/**
 * Which band a score belongs to.
 *
 * The bands are named rather than returned as a colour, because a colour belongs to a theme and
 * this file has no business knowing what the user's theme looks like. The panel maps a band to one
 * of the editor's own chart colours, so the same score reads correctly on a light theme, a dark
 * theme and a high-contrast one.
 */
export type ScoreBand = "strong" | "good" | "fair" | "weak" | "poor" | "unknown";

export function scoreBand(score: number | undefined): ScoreBand {
  if (score === undefined) return "unknown";
  if (score >= 85) return "strong";
  if (score >= 75) return "good";
  if (score >= 62) return "fair";
  if (score >= 48) return "weak";
  return "poor";
}
