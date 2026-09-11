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
 * Where the reader was looking, expressed as something that survives the change.
 *
 * A scroll position is a number of pixels from the top of the content — which means it only keeps
 * pointing at the same thing while nothing above it changes size. In this panel things above the
 * reader change size constantly: an agent turn writes its step lines and its plan ABOVE the answer
 * text, so every tool that runs inserts a couple of rows over the reader's head and pushes
 * everything they were reading further down. Their pixel offset is unchanged and the content under
 * it is not, so the transcript appears to drift upward into older messages on its own.
 *
 * The fix is to stop measuring in pixels from the top and start measuring against a thing: pick the
 * element at the top of the viewport, note where it sits in the content before and after, and move
 * the scroll position by the same amount it moved.
 */
export interface Anchor {
  /** Offset of the anchor element within the scrolled content, before the change. */
  before: number;
  /** The same offset, after it. */
  after: number;
}

/**
 * The scroll position to apply after a change, or `undefined` to leave the reader alone.
 *
 * Three outcomes, and the middle one is the one that was missing.
 *
 *   • AT THE END → follow. The transcript sticks to the bottom while that is where the reader is.
 *   • NOT AT THE END, AND SOMETHING ABOVE THEM MOVED → move with it, so that what they are reading
 *     stays exactly where it is on the glass. This is not "following"; it is the opposite — it is
 *     the work required to leave somebody alone while the document grows over their head.
 *   • NOT AT THE END, NOTHING ABOVE THEM MOVED → `undefined`. Leave the scroll position untouched.
 *
 * `undefined` remains the important half of the contract: someone who scrolled up to re-read the
 * question, or to copy a line out of an earlier answer, must not be pulled back down by the next
 * token. That is the single most irritating thing a streaming transcript can do, and it is why this
 * is not a setting — the reader's own scroll position says which of the three they want, every time.
 */
export function placeAfterChange(before: Viewport, after: Viewport, anchor?: Anchor): number | undefined {
  if (atEnd(before)) return after.scrollHeight;
  if (!anchor) return undefined;
  const shift = anchor.after - anchor.before;
  if (shift === 0) return undefined;
  // Never past the end: a compensation that overshoots would snap the reader to the bottom, which
  // is precisely what they did not ask for.
  const max = Math.max(0, after.scrollHeight - after.clientHeight);
  return Math.min(max, Math.max(0, before.scrollTop + shift));
}
