export const GAP = "…";

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
  if (totalPages <= 10) {
    return Array.from({ length: totalPages }, (_, i) => i + 1);
  }
  const items = [1];
  const start = current - siblings;
  const end = current + siblings;
  if (start > 2) items.push(GAP);
  for (let page = start; page <= end; page++) {
    if (page > 1 && page < totalPages) items.push(page);
  }
  if (end < totalPages - 1) items.push(GAP);
  items.push(totalPages);
  return items;
}
