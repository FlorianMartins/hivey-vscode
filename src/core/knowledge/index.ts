// The table of contents, and it is the only part of the base that is ambient.
//
// This is where the token argument is won or lost. A knowledge base exists to make the first answer
// right, and the naive way to do that — put the knowledge in the prompt — is the way that makes
// every question cost the whole encyclopedia. So what travels on every turn is a LIST: one line per
// note, its id and title, tags when they add something. Twelve tokens a note, so a base of two
// hundred notes costs what a short file costs, and the model reads it the way a person reads an
// index — to decide what to open.
//
// Everything else is pulled on demand, by a tool, in the turn that needs it. That inverts the usual
// failure: instead of paying for knowledge you did not need, you pay one round trip for the
// knowledge you did.

import { estimateTokens } from "../util/tokens.js";
import type { KnowledgeNote } from "./note.js";

export interface KnowledgeIndex {
  /** Ready to drop into the system prompt. Empty when there is nothing to list. */
  text: string;
  listed: number;
  omitted: number;
}

/** One line for one note. Kept short: this cost is paid on every turn, per note. */
export function indexLine(note: KnowledgeNote): string {
  const tags = note.tags.length ? ` [${note.tags.join(", ")}]` : "";
  return `- ${note.id} — ${note.title}${tags}`;
}

/**
 * The list, bounded.
 *
 * Bounded and SAID to be bounded: a truncated index that claims to be the whole base teaches the
 * model that anything unlisted does not exist, which is the one wrong conclusion available here —
 * it would stop searching and start inventing. The note that says how many were left out is what
 * keeps `knowledge_search` in play.
 *
 * Newest first, on the reasoning that a base grows towards what is currently being worked on. When
 * nothing carries a date, id order, so the list is at least stable between turns.
 */
export function knowledgeIndex(notes: KnowledgeNote[], maxTokens = 1200): KnowledgeIndex {
  const sorted = [...notes].sort((a, b) => (b.updated ?? "").localeCompare(a.updated ?? "") || a.id.localeCompare(b.id));
  const lines: string[] = [];
  let budget = maxTokens;
  let omitted = 0;
  for (let i = 0; i < sorted.length; i++) {
    const line = indexLine(sorted[i]!);
    const cost = estimateTokens(line) + 1;
    if (cost > budget) {
      omitted = sorted.length - i;
      break;
    }
    budget -= cost;
    lines.push(line);
  }

  if (!lines.length) return { text: "", listed: 0, omitted: notes.length };

  const head = [
    "KNOWLEDGE BASE — what you have already learned about this system, this business and these tools.",
    "Each line is one note. Read one with `knowledge_read`, or find notes by words with `knowledge_search`.",
    "Consult it BEFORE answering from general knowledge: it is what makes the first answer right here.",
    "When you establish something durable that is not in the list, record it with `knowledge_write` —",
    "search first, and update the existing note rather than adding a second one on the same subject.",
  ];
  if (omitted > 0) {
    head.push(
      `Only the ${lines.length} most recently updated notes are listed; ${omitted} more exist and are reachable with \`knowledge_search\`.`,
    );
  }
  return { text: `${head.join("\n")}\n\n${lines.join("\n")}`, listed: lines.length, omitted };
}
