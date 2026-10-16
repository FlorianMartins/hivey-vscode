export const GAP = "…";

/** The page actually shown for a requested one: out of range means the nearest valid page. */
export function clampPage(totalPages, current) {
  if (totalPages < 1) return 0;
  return Math.min(Math.max(Math.trunc(current) || 1, 1), totalPages);
}

const range = (from, to) => (to < from ? [] : Array.from({ length: to - from + 1 }, (_, i) => from + i));

/**
 * The slots of the pagination bar under the results list: page numbers, and GAP for pages left out.
 *
 * The bar has room for exactly `2 * siblings + 5` slots, and its contract is:
 *
 * - never more slots than that, and exactly that many once there are more pages than slots, so the
 *   bar does not change width while the user pages through;
 * - the first and the last page are always there; no pages at all gives an empty bar;
 * - the current page and `siblings` pages on each side of it are always there. A current page out
 *   of range (the list was filtered down while the user was on page 9) is treated as the nearest
 *   valid page;
 * - a GAP stands for at least two pages: hiding a single page behind "…" costs the same slot as
 *   showing it.
 */
export function pageItems(totalPages, current, siblings = 1) {
  const slots = 2 * siblings + 5;
  if (totalPages <= slots) return range(1, totalPages);
  const page = clampPage(totalPages, current);

  // The window of siblings, slid inward near either end so the bar keeps its width: on page 1 the
  // window is 3..(2s+3) rather than a shorter bar.
  const windowStart = Math.max(Math.min(page - siblings, totalPages - 2 * siblings - 2), 3);
  const windowEnd = Math.min(Math.max(page + siblings, 2 * siblings + 3), totalPages - 2);

  return [
    1,
    // Page 2 alone is shown, never a gap standing for it.
    ...(windowStart > 3 ? [GAP] : [2]),
    ...range(windowStart, windowEnd),
    ...(windowEnd < totalPages - 2 ? [GAP] : [totalPages - 1]),
    totalPages,
  ];
}
