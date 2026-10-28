// How many places in one request may be marked for the prompt cache, and which ones win.
//
// Anthropic accepts at most FOUR `cache_control` breakpoints per request and rejects the whole
// request beyond that — and the count is easy to exceed without noticing: a system prompt, a skill
// definition loaded from the repository, a second skill, the repository map, and the rolling
// breakpoint at the end of an agent step are already five.
//
// Which four to keep is not arbitrary. A breakpoint caches everything BEFORE it, so a later one
// subsumes an earlier one for the purpose of a hit; what several of them buy is a partial hit when
// the tail of the request changes. So the last ones are the valuable ones, and the ones to drop
// when there are too many are the earliest.

export const MAX_CACHE_MARKS = 4;

/**
 * Of the positions that asked to be cached, the ones that may be.
 *
 * Takes and returns positions rather than messages so that both providers can use it over their own
 * shapes — Anthropic's system blocks and message blocks live in two different arrays of the request
 * body, and they share one budget.
 */
export function keepCacheMarks(candidates: number[], max = MAX_CACHE_MARKS): Set<number> {
  return new Set(candidates.slice(-max));
}

/**
 * Whether a request to this provider and model needs cache marks to be cached at all — so the agent
 * loop places its rolling mark (see `withRollingCacheMark`) whatever `hiveyCode.chat.promptCache` says.
 *
 * Anthropic's cache applies only to the prefixes a request marks; OpenAI, DeepSeek, Gemini, Grok and
 * Kimi cache a repeated prefix on their own and need nothing. ⚠️ Without the mark, every step of an
 * agent turn paid the whole conversation again: measured through OpenRouter, a request read back from
 * the cache costs a tenth (0.00024 $ against 0.0029 $ for 23 k tokens). Both doors to Claude: the
 * native API, and OpenRouter (see `claudeThroughOpenRouter`).
 */
export function needsCacheMarks(provider: string, model: string): boolean {
  return provider === "anthropic" || (provider === "openrouter" && /^~?anthropic\//.test(model));
}
