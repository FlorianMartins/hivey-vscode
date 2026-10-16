/**
 * Remembers what a slow function returned, so the second call with the same arguments is free.
 * Used by the pricing and the shipping lookups, which both hit remote services.
 *
 * The key is EVERY argument, serialised as a JSON array: keying on the first one alone made
 * priceFor("A1", "USD") answer with the cached priceFor("A1", "EUR"). An array rather than a joined
 * string, so ("a,b", "c") and ("a", "b,c") stay two different calls.
 */
export function memoize(fn) {
  const cache = new Map();
  return function memoized(...args) {
    const key = JSON.stringify(args);
    if (cache.has(key)) return cache.get(key);
    const value = fn.apply(this, args);
    cache.set(key, value);
    return value;
  };
}
