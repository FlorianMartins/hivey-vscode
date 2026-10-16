/**
 * Calls `fn(item, index)` for every item, with at most `limit` calls in flight at once.
 *
 * Resolves with the results in the order of `items`. If a call rejects, the returned promise
 * rejects with that error and no further call is started.
 *
 * A pool of `limit` workers, each taking the next item as soon as its previous call settles. The
 * batches this replaced waited for the SLOWEST call of each batch before starting the next one, so
 * one slow thumbnail left three slots idle.
 */
export function mapLimit(items, limit, fn) {
  return new Promise((resolve, reject) => {
    const results = new Array(items.length);
    let next = 0;
    let running = 0;
    let failed = false;

    const launch = () => {
      if (failed) return;
      if (next >= items.length) {
        if (running === 0) resolve(results);
        return;
      }
      const index = next++;
      running++;
      Promise.resolve()
        .then(() => fn(items[index], index))
        .then(
          (value) => {
            results[index] = value;
            running--;
            launch();
          },
          (error) => {
            failed = true;
            reject(error);
          },
        );
    };

    if (items.length === 0) {
      resolve(results);
      return;
    }
    for (let i = 0; i < Math.min(limit, items.length); i++) launch();
  });
}
