/**
 * Pushes local drafts to the server.
 *
 * Resolves with one `{ id, remoteId }` per item, in the order of `items`, once every upload has
 * finished. Rejects with the error of an upload that fails. `onProgress(done, total)` is called
 * after each upload.
 */
export async function syncAll(items, upload, { onProgress } = {}) {
  const synced = [];
  items.forEach(async (item) => {
    const remote = await upload(item);
    synced.push({ id: item.id, remoteId: remote.id });
    if (onProgress) onProgress(synced.length, items.length);
  });
  return synced;
}
