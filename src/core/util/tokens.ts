// Token estimation without a tokenizer.
//
// Shipping a real BPE tokenizer would mean a multi-megabyte vocabulary per model family and a
// runtime dependency. What the budget actually needs is an estimate that never UNDER-counts by
// much, because its job is to refuse a request that would be too expensive, and an estimate that
// is 10 % high refuses slightly too early while one that is 30 % low refuses too late.
//
// Ratios below come from the usual measurements: ~4 characters per token on English prose, ~3.2
// on source code (punctuation and identifiers split more), ~2 on dense JSON/base64.

export function estimateTokens(text: string): number {
  if (!text) return 0;
  const n = text.length;
  const nonWord = (text.match(/[^\w\s]/g) ?? []).length / n;
  const charsPerToken = nonWord > 0.28 ? 2.4 : nonWord > 0.12 ? 3.2 : 4;
  return Math.ceil(n / charsPerToken);
}

export function estimateMessageTokens(messages: Array<{ content: string }>): number {
  // ~4 tokens of framing per message on every chat API.
  return messages.reduce((sum, m) => sum + estimateTokens(m.content) + 4, 0);
}

/** Cut text to a token budget, keeping the END (the part nearest the cursor is the useful one). */
export function tailToTokens(text: string, maxTokens: number): string {
  if (estimateTokens(text) <= maxTokens) return text;
  const approxChars = maxTokens * 3.2;
  return text.slice(Math.max(0, text.length - Math.floor(approxChars)));
}

/** Cut text to a token budget, keeping the START. */
export function headToTokens(text: string, maxTokens: number): string {
  if (estimateTokens(text) <= maxTokens) return text;
  return text.slice(0, Math.floor(maxTokens * 3.2));
}

/**
 * How much of one attached file is kept.
 *
 * It was four thousand tokens, flat, and that was the right number when the context budget itself
 * was eight: half the budget on one file is already generous. It stopped being right the moment the
 * budget followed the model — a two-hundred-thousand-token window with a four-thousand-token cap
 * per file throws away most of every source file and labels it "truncated", which reads as a fault
 * and is in fact a setting from another era.
 *
 * Two fifths of the budget, with the old number as the floor. One attachment may be most of the
 * conversation when the conversation is about one file; it may not be all of it, because the
 * question and the answer have to fit beside it.
 */
export function perFileBudget(contextBudget: number): number {
  return Math.max(4000, Math.floor(contextBudget * 0.4));
}
