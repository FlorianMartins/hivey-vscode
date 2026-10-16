/**
 * Pushes local drafts to the server.
 *
 * Resolves with one `{ id, remoteId }` per item, in the order of `items`, once every upload has
 * finished. Rejects with the error of an upload that fails. `onProgress(done, total)` is called
 * after each upload.
 *
 * The test was flaky because this was not true: `forEach` does not wait for an async callback, so
 * the function returned an array that the uploads filled in LATER, and the test only passed when its
 * sleep happened to outlast them. The uploads are awaited now, still in parallel, and each result is
 * placed at its item's index rather than pushed in the order the uploads finish.
 */
export async function syncAll(items, upload, { onProgress } = {}) {
  let done = 0;
  return Promise.all(
    items.map(async (item) => {
      const remote = await upload(item);
      done += 1;
      if (onProgress) onProgress(done, items.length);
      return { id: item.id, remoteId: remote.id };
    }),
  );
}
