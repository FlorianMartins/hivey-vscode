/**
 * Calls `fn(item, index)` for every item, with at most `limit` calls in flight at once.
 *
 * Resolves with the results in the order of `items`. If a call rejects, the returned promise
 * rejects with that error and no further call is started.
 */
export async function mapLimit(items, limit, fn) {
  const results = [];
  for (let start = 0; start < items.length; start += limit) {
    const batch = items.slice(start, start + limit);
    results.push(...(await Promise.all(batch.map((item, i) => fn(item, start + i)))));
  }
  return results;
}
