export function pageOf(items, page, perPage) {
  const start = page * perPage;
  return items.slice(start, start + perPage);
}
