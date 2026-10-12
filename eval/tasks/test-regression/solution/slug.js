export function slugify(text) {
  return text
    .toLowerCase()
    // Decomposed first, so an accented letter becomes its base letter plus a combining mark, and
    // the mark can be dropped. Replacing `[^a-z0-9]` without this deleted the letter itself.
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}
