// One thing the agent has learned, on disk, as Markdown with a header.
//
// The same argument as skills and sub-agents, applied to knowledge rather than to instructions: a
// note is a file, in a directory, in the repository. Not a row in a database and not an opaque
// vector store, because of what a knowledge base is FOR — it accumulates for years, it will be
// wrong about things, and somebody has to be able to read it, correct it and review a change to it.
// A store nobody can read is a store nobody can trust, and the first time it says something false
// about the business the only available remedy would be to wipe it.
//
//   .hiveycode/knowledge/finance/invoice-settlement.md   the team's, versioned, arrives with a clone
//   ~/.hiveycode/knowledge/rpg/free-form-conversion.md   yours, across every project
//
// The id is the path without its extension, so directories group a domain and the id stays
// meaningful in a prompt: `finance/invoice-settlement` says more than `note_4187`.

/** A single entry. One subject per note — a note about two things is found by neither search. */
export interface KnowledgeNote {
  /** Path-shaped, no extension: `finance/invoice-settlement`. */
  id: string;
  /** One line naming the subject. What search matches on hardest, and what the index lists. */
  title: string;
  /** Free words for grouping: a domain, a system, a language. */
  tags: string[];
  /** ISO date of the last change, written by whoever last wrote the note. */
  updated?: string;
  /** Where this came from: a file, a conversation, a person, a document. */
  sources: string[];
  /** The knowledge itself, verbatim Markdown. */
  body: string;
}

export interface NoteParse {
  note?: KnowledgeNote;
  /** Everything wrong with the file, in the words its author needs to fix it. */
  problems: string[];
}

/**
 * What an id may look like.
 *
 * Lowercase, hyphens, and `/` to group — deliberately the shape of the path it is stored at, so the
 * two can never disagree. No leading or trailing slash, no dots at all: an id is turned into a file
 * path, and `..` in a name the model chose would write outside the knowledge folder.
 */
const ID = /^[a-z0-9][a-z0-9-]*(?:\/[a-z0-9][a-z0-9-]*){0,3}$/;

export function validId(id: string): boolean {
  return ID.test(id) && !id.includes("..");
}

/** The file a note lives in, relative to a knowledge root. */
export function notePath(id: string): string {
  return `${id}.md`;
}

/** The id a file holds, or undefined when the path is not a note. */
export function noteId(relativePath: string): string | undefined {
  const clean = relativePath.replace(/\\/g, "/").replace(/^\.\//, "");
  if (!clean.endsWith(".md")) return undefined;
  const id = clean.slice(0, -3);
  return validId(id) ? id : undefined;
}

export function parseNote(id: string, text: string): NoteParse {
  const problems: string[] = [];
  if (!validId(id)) problems.push(`${id}: not a usable id. Lowercase letters, digits, hyphens, and / to group.`);

  const normalised = text.replace(/\r\n/g, "\n");
  const match = /^\s*---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(normalised);
  if (!match) {
    return {
      problems: [
        ...problems,
        `${id}: no header. A note starts with a line containing only --- , then title: , then another --- .`,
      ],
    };
  }

  const fields = parseHeader(match[1]!);
  const body = match[2]!.trim();
  const title = (fields["title"] ?? "").trim();
  // Not cosmetic. The title is the only part of a note that is ambient: the index the model reads on
  // every turn is a list of titles, and a note without one can never be chosen, only stumbled upon.
  if (!title) problems.push(`${id}: missing "title". One line naming the subject.`);
  if (!body) problems.push(`${id}: empty. A note with a header and nothing under it says nothing.`);
  if (problems.length) return { problems };

  return {
    problems: [],
    note: {
      id,
      title,
      tags: splitList(fields["tags"]),
      sources: splitList(fields["sources"]),
      ...(fields["updated"]?.trim() ? { updated: fields["updated"]!.trim() } : {}),
      body,
    },
  };
}

/**
 * A note, written back.
 *
 * Round-trip exact for everything the format carries, which is what lets the agent modify a note by
 * reading it, changing one paragraph and writing it back — the operation this whole feature exists
 * for. A serialiser that reordered or dropped fields would quietly erase the sources of every note
 * it touched.
 */
export function serialiseNote(note: KnowledgeNote): string {
  const header = [`title: ${note.title}`];
  if (note.tags.length) header.push(`tags: ${note.tags.join(", ")}`);
  if (note.sources.length) header.push(`sources: ${note.sources.join(", ")}`);
  header.push(`updated: ${note.updated ?? today()}`);
  return `---\n${header.join("\n")}\n---\n\n${note.body.trim()}\n`;
}

export function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function splitList(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .replace(/^\[|\]$/g, "")
    .split(",")
    .map((part) => part.trim().replace(/^["']|["']$/g, ""))
    .filter(Boolean);
}

/** The same one-key-per-line header the skill files use, including indented continuations. */
function parseHeader(header: string): Record<string, string> {
  const out: Record<string, string> = {};
  let key: string | undefined;
  for (const raw of header.split("\n")) {
    if (/^\s*#/.test(raw)) continue;
    const line = raw.trimEnd();
    if (!line.trim()) continue;
    const start = /^([A-Za-z][\w-]*)\s*:\s*(.*)$/.exec(line);
    if (start) {
      key = start[1]!.toLowerCase();
      out[key] = unquote(start[2]!.trim());
    } else if (key && /^\s+\S/.test(line)) {
      out[key] = `${out[key]} ${line.trim()}`.trim();
    }
  }
  return out;
}

function unquote(value: string): string {
  if (value.length >= 2 && ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))) {
    return value.slice(1, -1);
  }
  return value;
}
