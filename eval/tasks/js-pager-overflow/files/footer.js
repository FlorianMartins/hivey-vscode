import { GAP, pageItems } from "./pager.js";

/** The footer under the results list, as the view model the template renders. */
export function footerModel({ totalItems, pageSize, page }) {
  const totalPages = Math.ceil(totalItems / pageSize);
  return {
    label: totalItems === 0 ? "No results" : `${totalItems} results`,
    slots: pageItems(totalPages, page).map((item) =>
      item === GAP ? { kind: "gap" } : { kind: "page", page: item, current: item === page },
    ),
  };
}
