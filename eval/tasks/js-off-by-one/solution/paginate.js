export function pageOf(items, page, perPage) {
  // Pages are numbered from one, as every interface that shows them does: page 1 starts at 0.
  const start = (page - 1) * perPage;
  return items.slice(start, start + perPage);
}
