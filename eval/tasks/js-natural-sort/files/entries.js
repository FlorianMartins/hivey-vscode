/** The entries of the file explorer, folders first, then files, by name. */
export function sortEntries(entries) {
  return entries.sort((a, b) => {
    if (a.type !== b.type) return a.type === "folder" ? -1 : 1;
    return a.name > b.name ? 1 : -1;
  });
}
