// `#context` and `@participant`, parsed.
//
// Both notations are Copilot's, and they are worth copying rather than improving on: a developer
// who has typed `#changes` in one assistant should not have to learn `!diff` in another. What is
// different here is where they are resolved. Copilot's variables are resolved by the product's
// backend; these are resolved on the user's machine, by the extension, before anything is sent —
// which is the only arrangement in which `#changes` can attach a diff of unreleased code to a
// conversation with a local model and have that mean what it says.
//
// This file does the part that has no business touching the editor: reading the text the user
// typed and saying what they asked for. Resolution — opening the file, running the diff, reading
// the diagnostics — happens in the extension layer, against real APIs, and is not testable here.
// Parsing is, and it is where the mistakes are: a `#` inside a URL fragment, a Markdown heading at
// the start of a line, a path with spaces, an e-mail address that looks like a participant.

export type MentionKind =
  | "file"
  | "selection"
  | "editor"
  | "openFiles"
  | "codebase"
  | "changes"
  | "problems"
  | "terminal"
  | "symbol"
  | "member"
  | "sql";

export interface Mention {
  kind: MentionKind;
  /** The part after the colon, when the notation takes one: a path, a symbol, a statement. */
  argument?: string;
  /** Exactly as typed, so it can be removed from the text or highlighted in place. */
  raw: string;
}

export type Participant = "workspace" | "terminal" | "git" | "ibmi" | "arcad" | "editor";

export interface ParsedPrompt {
  /** The question, with the participant removed and the mentions left where they were. */
  text: string;
  participant?: Participant;
  mentions: Mention[];
}

/** The notations that take no argument. */
const BARE: Record<string, MentionKind> = {
  selection: "selection",
  editor: "editor",
  file: "editor",
  openfiles: "openFiles",
  tabs: "openFiles",
  codebase: "codebase",
  changes: "changes",
  diff: "changes",
  problems: "problems",
  errors: "problems",
  terminal: "terminal",
  terminalselection: "terminal",
};

/** The notations that take one. `#file:src/a.ts`, `#sym:parseInvoice`, `#db2:select …`. */
const WITH_ARGUMENT: Record<string, MentionKind> = {
  file: "file",
  path: "file",
  sym: "symbol",
  symbol: "symbol",
  member: "member",
  ibmi: "member",
  db2: "sql",
  sql: "sql",
};

const PARTICIPANTS: Record<string, Participant> = {
  workspace: "workspace",
  codebase: "workspace",
  terminal: "terminal",
  git: "git",
  ibmi: "ibmi",
  arcad: "arcad",
  editor: "editor",
  vscode: "editor",
};

/**
 * A `#` that starts a mention rather than something else.
 *
 * The three things this must not match are a Markdown heading (`# Title`, and the panel renders
 * Markdown), a colour (`#ff8800`) and a URL fragment (`…/page#section`). The rule that separates
 * them: a mention's `#` is preceded by the start of the string or by whitespace, and followed
 * immediately by a letter.
 */
const MENTION = /(^|\s)#([a-zA-Z][\w-]*)(?::((?:"[^"]*")|(?:\([^)]*\))|(?:[^\s]+)))?/g;

const PARTICIPANT = /(^|\s)@([a-zA-Z][\w-]*)/g;

export function parsePrompt(input: string): ParsedPrompt {
  const mentions: Mention[] = [];
  MENTION.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = MENTION.exec(input))) {
    const name = match[2]!.toLowerCase();
    const argument = match[3] ? unquote(match[3]) : undefined;
    const kind = argument ? WITH_ARGUMENT[name] : BARE[name];
    if (!kind) continue;
    mentions.push({ kind, argument, raw: match[0].slice(match[1]!.length) });
  }

  // A participant is only a participant at the front. `@workspace what calls this` is an
  // instruction; "ask @alice about it" is a sentence, and rewriting it would be rude.
  let participant: Participant | undefined;
  let text = input;
  const lead = /^\s*@([a-zA-Z][\w-]*)\s*/.exec(input);
  if (lead) {
    const found = PARTICIPANTS[lead[1]!.toLowerCase()];
    if (found) {
      participant = found;
      text = input.slice(lead[0].length);
    }
  }

  return { text, participant, mentions };
}

function unquote(value: string): string {
  if (value.startsWith('"') && value.endsWith('"')) return value.slice(1, -1);
  return value;
}

/** Every participant, for the menu and the completion list. */
export function participants(): Array<{ id: Participant; label: string; hint: string }> {
  return [
    { id: "workspace", label: "@workspace", hint: "the repository: search it, read it, answer from it" },
    { id: "editor", label: "@editor", hint: "the file on screen and the editor's own state" },
    { id: "terminal", label: "@terminal", hint: "the last command and what it printed" },
    { id: "git", label: "@git", hint: "the working tree, the history, the blame" },
    { id: "ibmi", label: "@ibmi", hint: "the partition: Db2 for i, source members, objects" },
    { id: "arcad", label: "@arcad", hint: "ARCAD Elias: components, versions, cross-references" },
  ];
}

/**
 * What a participant adds to the system prompt.
 *
 * Deliberately short. A participant is a hint about where to look first, not a personality: making
 * `@ibmi` answer differently from `@workspace` about the same question would be a way of hiding
 * which tools ran, and this extension's whole argument is that you can see what it did.
 */
export function participantDirective(participant: Participant): string {
  switch (participant) {
    case "workspace":
      return "The question is about this repository as a whole. Search it before answering, and cite the files you relied on.";
    case "editor":
      return "The question is about the file currently open. Start from it and from the selection, and say when you need to look elsewhere.";
    case "terminal":
      return "The question is about a command and its output. Explain what the output means before proposing anything.";
    case "git":
      return "The question is about version control. Look at the working tree, the history and the blame before answering, and never push.";
    case "ibmi":
      return "The question is about the IBM i partition. Prefer the platform's own sources — Db2 for i catalogue views in QSYS2, source members, object lists — over guessing from the file on screen.";
    case "arcad":
      return "The question is about ARCAD Elias: components, versions, cross-references, promotion. Use the ARCAD actions rather than editing members directly, so the change stays under change management.";
  }
}

/** The mentions the user typed, described for the interface's context strip. */
export function describeMention(mention: Mention): string {
  switch (mention.kind) {
    case "file":
      return mention.argument ?? "file";
    case "selection":
      return "selection";
    case "editor":
      return "active file";
    case "openFiles":
      return "open files";
    case "codebase":
      return "repository map";
    case "changes":
      return "uncommitted changes";
    case "problems":
      return "problems";
    case "terminal":
      return "terminal";
    case "symbol":
      return mention.argument ?? "symbol";
    case "member":
      return mention.argument ?? "member";
    case "sql":
      return "SQL result";
  }
}

/** Suggestions for the `#` completion list, in the order they are most often wanted. */
export function mentionSuggestions(): Array<{ token: string; hint: string }> {
  return [
    { token: "#file:", hint: "a file by path" },
    { token: "#selection", hint: "what is selected in the editor" },
    { token: "#editor", hint: "the whole active file" },
    { token: "#openFiles", hint: "every file open in a tab" },
    { token: "#codebase", hint: "the repository map" },
    { token: "#changes", hint: "the uncommitted diff" },
    { token: "#problems", hint: "the errors and warnings reported by the language server" },
    { token: "#terminal", hint: "the last terminal command and its output" },
    { token: "#sym:", hint: "a symbol by name, and where it is used" },
    { token: "#member:", hint: "an IBM i source member — LIB/SRCFILE(MEMBER)" },
    { token: "#db2:", hint: "the result of a Db2 for i query" },
  ];
}

export interface Suggestion {
  token: string;
  hint: string;
  /** What to insert. A notation that takes an argument leaves the caret against the colon. */
  complete: string;
}

export interface SuggestionQuery {
  /** Everything typed so far. */
  value: string;
  /** Where the caret is. */
  caret: number;
}

/**
 * What to offer under the composer, given the text and the caret.
 *
 * Pulled out of the panel because the panel is where it could not be tested, and because the bug
 * that prompted it was not in the rendering: the list is derived entirely from the word under the
 * caret, so getting that wrong shows up as suggestions that are absent, stale, or for the wrong
 * prefix. Everything the caller does with the result is DOM plumbing.
 *
 * `slash` and `participant` are only offered at the start, because that is the only place they mean
 * anything; `#` works mid-sentence, which is where people reach for it.
 */
export function suggestionsFor(
  query: SuggestionQuery,
  sets: { slash: Array<{ name: string; hint: string }>; mentions: Suggestion[]; participants: Suggestion[] },
): Suggestion[] {
  const before = query.value.slice(0, query.caret);
  const word = /(\S*)$/.exec(before)?.[1] ?? "";

  if (query.value.startsWith("/") && !before.includes(" ")) {
    return sets.slash
      .filter((c) => c.name.startsWith(word))
      .map((c) => ({ token: c.name, hint: c.hint, complete: `${c.name} ` }));
  }

  if (word.startsWith("#")) {
    const needle = word.toLowerCase();
    return sets.mentions.filter((m) => m.token.toLowerCase().startsWith(needle));
  }

  // A participant is only a participant at the front, so `@` is offered only there — matching the
  // parser, which would ignore one anywhere else.
  if (word.startsWith("@") && query.value.trimStart().startsWith("@")) {
    const needle = word.toLowerCase();
    return sets.participants.filter((p) => p.token.toLowerCase().startsWith(needle));
  }

  return [];
}

/** Apply a suggestion: the text that replaces the word under the caret, and where the caret lands. */
export function applySuggestion(query: SuggestionQuery, suggestion: Suggestion): { value: string; caret: number } {
  const before = query.value.slice(0, query.caret);
  const word = /(\S*)$/.exec(before)?.[1] ?? "";
  const head = query.value.slice(0, query.caret - word.length) + suggestion.complete;
  return { value: head + query.value.slice(query.caret), caret: head.length };
}
