// GENERATED FILE — do not edit by hand.
// Written by `npm run models` (scripts/update-models.mjs); the daily workflow commits the diff.
//
// Which model each Hivey preset uses for each kind of work. Chosen by rule from OpenRouter's own
// catalogue — budget, capability, vendor family, recency — so that no version is ever named in this
// repository's source. When a vendor ships a successor, this file moves; nothing else does.
//
// The rules live in scripts/update-models.mjs. Read them there before doubting a row.

export const HIVEY_GENERATED_AT = "2026-09-07";

/** variant → role → model id. */
export const HIVEY_ROUTING: Record<string, Record<string, string>> = {
  "hivey/free": {
    "chore": "nvidia/nemotron-3.5-lightning:free",
    "everyday": "nvidia/nemotron-3-ultra-550b-a55b:free",
    "deep": "nvidia/nemotron-3-ultra-550b-a55b:free",
    "completion": "cohere/north-mini-code:free"
  },
  "hivey": {
    "chore": "qwen/qwen3.7-flash",
    "everyday": "qwen/qwen3.8-max-0902",
    "deep": "anthropic/claude-opus-5",
    "completion": "qwen/qwen3-coder-30b-a3b-instruct"
  },
  "hivey/smart": {
    "chore": "qwen/qwen3.7-flash",
    "everyday": "openai/gpt-chat-latest",
    "deep": "openai/gpt-5-pro",
    "completion": "qwen/qwen3-coder-30b-a3b-instruct"
  }
};
