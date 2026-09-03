// Finding a note, and noticing that one already exists.
//
// Lexical, not vector. That is a real decision and it has three reasons, in order of weight:
//
//   • THE BASE IS SMALL AND THE QUERIES ARE NAMED. A knowledge base about one business and one
//     system reaches hundreds of notes, not millions, and what gets looked up is a NAME — a
//     programme, a table, a rule, a procedure. Exact and near-exact matching is what wins on names;
//     an embedding is what wins on paraphrase at scale, which is the opposite problem.
//   • IT WOULD COST A MODEL CALL PER NOTE. Embedding a base means embedding every note, again
//     whenever it changes, and re-embedding every query. That is tokens spent to save tokens, and
//     for a base this size the arithmetic does not come out.
//   • NOTHING TO INSTALL, NOTHING TO CORRUPT. No index file to fall out of date with the notes, no
//     native dependency, no store to rebuild. The notes ARE the index.
//
// The duplicate check is the same machinery pointed at a different question, and it is what makes
// the base stay a base rather than becoming a pile: before writing, the agent is shown what is
// already there on this subject and has to say what it is doing about it.

import type { KnowledgeNote } from "./note.js";

export interface Hit {
  note: KnowledgeNote;
  score: number;
  /** The lines of the body that matched, for a preview that does not cost the whole note. */
  lines: string[];
}

/** Words worth matching on. Short ones and the commonest joins in both languages are noise. */
const STOP = new Set([
  "the", "a", "an", "of", "to", "in", "on", "for", "and", "or", "is", "are", "be", "it", "this", "that", "with", "how",
  "what", "which", "when", "does", "do", "le", "la", "les", "un", "une", "des", "de", "du", "et", "ou", "est", "sont",
  "dans", "pour", "sur", "que", "qui", "quoi", "comment", "avec", "au", "aux",
]);

export function terms(query: string): string[] {
  return [
    ...new Set(
      query
        .toLowerCase()
        // Keeps digits attached to letters: `531`, `db2`, `qsys2` are exactly what gets looked up.
        .split(/[^\p{L}\p{N}_]+/u)
        .map((w) => w.trim())
        .filter((w) => w.length > 1 && !STOP.has(w)),
    ),
  ];
}

/**
 * How well one note answers one query.
 *
 * Weighted by WHERE the word is, because the three places mean different things: the title is what
 * the note is about, a tag is the domain it belongs to, and the body is what it happens to mention.
 * A note titled "Invoice settlement" beats one that mentions invoices in passing, which is the
 * ranking anybody reading the list would expect.
 */
export function scoreNote(note: KnowledgeNote, want: string[]): number {
  if (!want.length) return 0;
  const title = note.title.toLowerCase();
  const id = note.id.toLowerCase();
  const tags = note.tags.join(" ").toLowerCase();
  const body = note.body.toLowerCase();

  let score = 0;
  let matched = 0;
  for (const term of want) {
    let here = 0;
    if (title.includes(term)) here += 8;
    if (id.includes(term)) here += 5;
    if (tags.includes(term)) here += 4;
    if (body.includes(term)) here += 1;
    if (here) matched += 1;
    score += here;
  }
  // Every word present is worth more than one word present four times: a query is a conjunction in
  // the asker's head, and a note matching all of it loosely is the one they meant.
  if (matched === want.length && want.length > 1) score *= 1.5;
  return matched ? score : 0;
}

export function searchNotes(notes: KnowledgeNote[], query: string, limit = 8): Hit[] {
  const want = terms(query);
  const hits: Hit[] = [];
  for (const note of notes) {
    const score = scoreNote(note, want);
    if (score <= 0) continue;
    hits.push({ note, score, lines: matchingLines(note.body, want) });
  }
  return hits.sort((a, b) => b.score - a.score || a.note.id.localeCompare(b.note.id)).slice(0, limit);
}

/** Up to three lines carrying a wanted word, so a hit can be judged without reading the note. */
export function matchingLines(body: string, want: string[], limit = 3): string[] {
  const out: string[] = [];
  for (const line of body.split("\n")) {
    const lower = line.toLowerCase();
    if (want.some((term) => lower.includes(term)) && line.trim()) {
      out.push(line.trim().slice(0, 200));
      if (out.length >= limit) break;
    }
  }
  return out;
}

/**
 * Notes that may already say this.
 *
 * Compared on the SUBJECT rather than on the prose: the significant words of the title and the id,
 * as a set. Two notes written months apart about the same rule share their nouns and share almost
 * none of their sentences, so comparing bodies would report no overlap on the exact case this is
 * meant to catch.
 *
 * The threshold is a proportion of the shorter title, which is what makes "Invoice settlement" and
 * "How an invoice is settled" collide while "Invoice settlement" and "Invoice numbering" do not.
 */
export function nearDuplicates(notes: KnowledgeNote[], title: string, id: string, threshold = 0.6): KnowledgeNote[] {
  const want = new Set([...terms(title), ...terms(id.replace(/[/-]/g, " "))]);
  if (!want.size) return [];
  const out: Array<{ note: KnowledgeNote; overlap: number }> = [];
  for (const note of notes) {
    if (note.id === id) continue;
    const theirs = new Set([...terms(note.title), ...terms(note.id.replace(/[/-]/g, " "))]);
    if (!theirs.size) continue;
    let shared = 0;
    for (const term of want) if (theirs.has(term)) shared += 1;
    const overlap = shared / Math.min(want.size, theirs.size);
    if (overlap >= threshold) out.push({ note, overlap });
  }
  return out.sort((a, b) => b.overlap - a.overlap).map((x) => x.note);
}
