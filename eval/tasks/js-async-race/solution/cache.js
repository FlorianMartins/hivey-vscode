// The PROMISE is cached, not the resolved value.
//
// Caching the value meant the first caller read the cache before the fetch had resolved and got
// `undefined` — and two callers at once started two fetches. Storing the in-flight promise makes
// the second caller await the first one's request, which is also the only way to fetch once.
const cache = new Map();

async function fetchUser(id) {
  await new Promise((r) => setTimeout(r, 10));
  return { id, name: `user-${id}` };
}

export async function getUser(id) {
  if (!cache.has(id)) {
    const promise = fetchUser(id);
    // Removed on failure, so one network error does not poison the key for the life of the process.
    promise.catch(() => cache.delete(id));
    cache.set(id, promise);
  }
  return cache.get(id);
}
