// How a person expects names to sort: "img2" before "img10", "Écoles" with the e's, "readme" and
// "Zeta" without regard to case. A plain `>` compares UTF-16 code units, which gets all three wrong.
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

/**
 * The entries of the file explorer, folders first, then files, by name.
 *
 * Returns a NEW array. Sorting the caller's array in place reordered the Recent panel, which reads
 * the same array in most-recently-opened order. Entries whose names compare equal keep their input
 * order: the comparator returns 0 for them (the old one returned -1 both ways round, which is not an
 * order at all) and `sort` is stable.
 */
export function sortEntries(entries) {
  return [...entries].sort((a, b) => {
    if (a.type !== b.type) return a.type === "folder" ? -1 : 1;
    return collator.compare(a.name, b.name);
  });
}
