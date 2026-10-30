// Caps that grow with the model in use.
//
// ⚠️ "remove every context or token limit, even for cloud models — adapt to the models' own limits,
// don't add manual limits that cripple what they can do". A file read stopped at 24 000 characters,
// a command's output at 8 000, the repository's own rules at 1 200 tokens, a diff at 5 000 — the same
// figures for a 32k model and a 1M one. On the large window they were not prudence, they were the
// agent working half-blind on a task it had the room to see whole.
//
// Each cap is now a share of the window of the model actually selected, and never less than the old
// figure, which stays the floor for a model whose window nobody knows. A share rather than the whole
// window because one tool output must leave room for the rest of the turn — and the turn itself
// shortens the oldest outputs when it fills, with every one of them kept word for word in the memory
// with recall (see core/agent/recall.ts), so a large read costs nothing that cannot be had back.

/** The selected model's context window in tokens, 0 when unknown. Set by whoever selects the model. */
let activeWindow = 0;

export function setActiveWindow(tokens: number): void {
  activeWindow = Number.isFinite(tokens) && tokens > 0 ? Math.floor(tokens) : 0;
}

/** A cap in TOKENS: `share` of the window, never below `floor`. */
export function scaledTokens(floor: number, share: number, window = activeWindow): number {
  return Math.max(floor, Math.floor(window * share));
}

/** A cap in CHARACTERS, at the usual ~4 characters a token: `share` of the window, never below `floor`. */
export function scaledChars(floor: number, share: number, window = activeWindow): number {
  return Math.max(floor, Math.floor(window * share * 4));
}
