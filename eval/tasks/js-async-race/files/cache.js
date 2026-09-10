const cache = new Map();

async function fetchUser(id) {
  await new Promise((r) => setTimeout(r, 10));
  return { id, name: `user-${id}` };
}

export async function getUser(id) {
  if (cache.has(id)) return cache.get(id);
  const promise = fetchUser(id);
  promise.then((user) => cache.set(id, user));
  return cache.get(id);
}
