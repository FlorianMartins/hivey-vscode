// Token estimation without a tokenizer.
//
// Shipping a real BPE tokenizer would mean a multi-megabyte vocabulary per model family and a
// runtime dependency. What the budget actually needs is an estimate that never UNDER-counts by
// much, because its job is to refuse a request that would be too expensive, and an estimate that
// is 10 % high refuses slightly too early while one that is 30 % low refuses too late.
//
import { IMAGE_TOKENS } from "../models/vision.js";

// Ratios below come from the usual measurements: ~4 characters per token on English prose, ~3.2
// on source code (punctuation and identifiers split more), ~2 on dense JSON/base64.

export function estimateTokens(text: string): number {
  if (!text) return 0;
  const n = text.length;
  const nonWord = (text.match(/[^\w\s]/g) ?? []).length / n;
  const charsPerToken = nonWord > 0.28 ? 2.4 : nonWord > 0.12 ? 3.2 : 4;
  return Math.ceil(n / charsPerToken);
}

/**
 * A whole request, images included — and the images are why this comment exists.
 *
 * They were not counted here, and this function is one half of the pair the token calibration is
 * learned from: what we estimated against what the provider counted. A request carrying a
 * screenshot therefore reported an estimate that was short by about 1 300 tokens per image against
 * an actual that included them, the ratio came out above 1 for a reason that had nothing to do with
 * tokenization, and the learned factor drifted upwards — inflating every later estimate, the figure
 * shown on the consent card, and the number the spending cap is checked against. A measurement that
 * compares two different things teaches something, and what it teaches is wrong.
 */
export function estimateMessageTokens(messages: Array<{ content: string; images?: unknown[] }>): number {
  // ~4 tokens of framing per message on every chat API.
  return messages.reduce(
    (sum, m) => sum + estimateTokens(m.content) + 4 + (m.images?.length ?? 0) * IMAGE_TOKENS,
    0,
  );
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
 * How much of ONE attached file is kept, knowing how many there are.
 *
 * The count is the whole point, and leaving it out was a real defect. The rule was two fifths of
 * the context budget per file, with no idea how many files there were: two attachments therefore
 * asked for four fifths of the budget, three for more than all of it, and nothing downstream put
 * that right. It lay dormant while the budget was a flat 8 000 tokens — two fifths of that is below
 * the old 4 000 floor, so the floor always won — and it woke the moment the budget began following
 * the model's window. A user with a large budget and two files open saw one question estimated at
 * 468 726 tokens.
 *
 * So there is one rule and it is about the SET: everything attached together may take three fifths
 * of the budget, shared equally. What is left is for the question, the transcript, the repository
 * map and the answer, which all have to fit beside the attachments.
 *
 * The floor is per file and deliberately small. Attaching eight files at once is a legitimate thing
 * to do, and a thousand tokens of each of them is worth more than four thousand tokens of two. It
 * is the one case where the three fifths can be exceeded, and the trimming in `Session.build` is
 * the backstop — the floor exists so that a file attached on purpose says SOMETHING, not so that it
 * says everything.
 */
/**
 * The most one attachment may take, however large the context budget is.
 *
 * About two thousand lines of code — past which sending more of a file stops being the best use
 * of the tokens. `fileExcerpt` replaces the overflow with the file's outline: every symbol it
 * declares and the line it is on, which is a better projection of a large module than its first
 * three thousand lines, and a twentieth of the price.
 *
 * It exists because the budget is a ceiling on the CONVERSATION and was being read as a target for
 * each file in it. Somebody who raises the budget to work on a long conversation has not asked for
 * a hundred thousand tokens of one file, and would not recognise the request if they saw it —
 * "a prompt plus two files, 234 000 tokens".
 */
export const ATTACHMENT_CEILING_TOKENS = 16_000;

export function perFileBudget(
  contextBudget: number,
  attachments = 1,
  ceiling = ATTACHMENT_CEILING_TOKENS,
): number {
  const together = Math.floor(contextBudget * 0.6);
  const share = Math.floor(together / Math.max(1, attachments));
  // 0 means no ceiling, for somebody who has decided a whole large file is what they want.
  return Math.max(1000, ceiling > 0 ? Math.min(ceiling, share) : share);
}
