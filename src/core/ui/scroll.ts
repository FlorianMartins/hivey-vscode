// Where the reader should be after the transcript changes under them.
//
// Extracted from the panel because the rule is a decision, not a DOM operation, and the decision is
// where every version of this has gone wrong. It has three states, and only two of them are
// obvious: follow the end, stay exactly where you are, and — the one that caused the defect — the
// case where the answer to "are you at the end?" depends on WHEN it is asked.
//
// The typing animation releases the answer character by character, so the transcript grows on every
// frame. Asked after the growth, "is the reader at the end?" answers no, because the end just moved
// a line and a half further down. Fifty frames of that and the reader is halfway up an answer whose
// end they never asked to leave. So the measurement is taken BEFORE the change and applied after,
// which is what the two arguments below are for.

export interface Viewport {
  scrollHeight: number;
  scrollTop: number;
  clientHeight: number;
}

/**
 * How far from the bottom still counts as "at the bottom".
 *
 * A couple of lines, because a scroll position is rarely exactly zero from the end — a fractional
 * device pixel, a margin that collapses, an image that settles. Nothing here should depend on an
 * equality between two floats a browser computed.
 */
export const STICK_TOLERANCE_PX = 48;

export function atEnd(view: Viewport, tolerance = STICK_TOLERANCE_PX): boolean {
  return view.scrollHeight - view.scrollTop - view.clientHeight <= tolerance;
}

/**
 * The scroll position to apply after a change, or `undefined` to leave the reader alone.
 *
 * `undefined` is the important half of this contract: someone who scrolled up to re-read the
 * question, or to copy a line out of an earlier answer, must not be pulled back down by the next
 * token. That is the single most irritating thing a streaming transcript can do, and it is why this
 * is not a setting — the reader's own scroll position says which of the two they want, every time.
 */
export function placeAfterChange(before: Viewport, after: Viewport): number | undefined {
  return atEnd(before) ? after.scrollHeight : undefined;
}
