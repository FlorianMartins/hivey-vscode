// GENERATED FILE — do not edit by hand.
// Written by `npm run models` (scripts/update-models.mjs); the daily workflow commits the diff.
//
// Which model each Hivey preset uses for each kind of work. Chosen by rule from OpenRouter's own
// catalogue — budget, capability, vendor family, recency — so that no version is ever named in this
// repository's source. When a vendor ships a successor, this file moves; nothing else does.
//
// The rules live in src/core/router/curate.ts, with their tests. Read them there before doubting a row.

export const HIVEY_GENERATED_AT = "2026-10-08";

/**
 * Roles where a dearer preset resolved to the same model as a cheaper one, on the day this ran.
 *
 * Not a defect. It means the strongest current model was already inside the cheaper preset's budget,
 * so the dearer one had nothing better to buy. Stated rather than engineered away: the margin that
 * decided it was 0.007 of a point, and tuning weights until the presets differed would be fitting
 * the rules to one afternoon's catalogue.
 */
export const HIVEY_OVERLAPS: string[] = [];

/** variant → role → model id. */
export const HIVEY_ROUTING: Record<string, Record<string, string>> = {
  "hivey/free": {
    "chore": "nvidia/nemotron-3.5-lightning:free",
    "everyday": "nvidia/nemotron-3.5-lightning:free",
    "deep": "nvidia/nemotron-3.5-lightning:free",
    "completion": "cohere/north-mini-code:free"
  },
  "hivey/smart": {
    "chore": "qwen/qwen3.7-flash",
    "everyday": "x-ai/grok-4.7",
    "deep": "openai/gpt-6.1-sol-pro",
    "completion": "poolside/laguna-s-2.1"
  },
  "hivey": {
    "chore": "anthropic/claude-haiku-5.5",
    "everyday": "anthropic/claude-sonnet-5.5",
    "deep": "anthropic/claude-opus-5.5",
    "completion": "anthropic/claude-haiku-5.5"
  }
};
