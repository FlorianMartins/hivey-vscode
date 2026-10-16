/**
 * Remembers what a slow function returned, so the second call with the same arguments is free.
 * Used by the pricing and the shipping lookups, which both hit remote services.
 */
export function memoize(fn) {
  const cache = new Map();
  return function memoized(...args) {
    const first = args[0];
    const key = typeof first === "object" && first !== null ? JSON.stringify(first) : first;
    if (cache.has(key)) return cache.get(key);
    const value = fn.apply(this, args);
    cache.set(key, value);
    return value;
  };
}
