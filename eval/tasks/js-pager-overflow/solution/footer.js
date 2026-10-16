import { GAP, clampPage, pageItems } from "./pager.js";

/** The footer under the results list, as the view model the template renders. */
export function footerModel({ totalItems, pageSize, page }) {
  const totalPages = Math.ceil(totalItems / pageSize);
  // The page the bar actually shows: after a filter shrinks the list, page 9 of 3 is page 3, and
  // that is the one to highlight.
  const shown = clampPage(totalPages, page);
  return {
    label: totalItems === 0 ? "No results" : `${totalItems} results`,
    slots: pageItems(totalPages, page).map((item) =>
      item === GAP ? { kind: "gap" } : { kind: "page", page: item, current: item === shown },
    ),
  };
}
