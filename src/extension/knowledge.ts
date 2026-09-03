// The knowledge base, as the editor sees it: files on disk, and the four tools that use them.
//
// What this is FOR, because it decides every detail below. An assistant that is new to a business
// every morning spends the first half of every conversation being told things it was told
// yesterday: which library holds the production programmes, that amounts are stored in cents, that
// nobody touches the settlement job before the batch, what the abbreviations mean. That is the
// expensive part of working with a model in a real trade — and it is knowledge that changes slowly,
// which is exactly the kind worth writing down once.
//
// Three rules keep it from becoming a pile:
//
//   • THE INDEX IS AMBIENT, THE KNOWLEDGE IS NOT. Every turn carries a list of titles, a dozen
//     tokens each. Nothing else travels until the model asks for it. A base that put itself in
//     every prompt would cost more than it saves by the fiftieth note.
//   • WRITING IS CHECKED AGAINST WHAT IS ALREADY THERE. The tool refuses a new note whose subject
//     already exists and hands back the notes that cover it, so the model updates rather than
//     accumulating three versions of one rule for the next reader to choose between.
//   • NOTHING IS DELETED SILENTLY. Retiring moves a note to `.archive/`, out of the index and out of
//     search. A base that can only grow is useless; one that can quietly lose things is worse.

import * as vscode from "vscode";
import { t } from "../shared/i18n.js";
import type { Tool, ToolResult } from "../core/agent/loop.js";
import {
  noteId,
  notePath,
  parseNote,
  serialiseNote,
  today,
  validId,
  type KnowledgeNote,
} from "../core/knowledge/note.js";
import { nearDuplicates, searchNotes } from "../core/knowledge/search.js";
import { knowledgeIndex } from "../core/knowledge/index.js";
import { HttpKnowledgeStore, type KnowledgeStore } from "../core/knowledge/store.js";
import { request } from "../core/util/http.js";
import { headToTokens } from "../core/util/tokens.js";
import { readSettings, type Settings } from "./config.js";

const MAX_NOTE_TOKENS = 4000;
const FOLDER = ".hiveycode";
const SUB = "knowledge";
const ARCHIVE = ".archive";

/** Where a note is written when it is new. The team's base by default: knowledge is usually theirs. */
export type Scope = "project" | "personal";

interface Root {
  scope: Scope;
  uri: vscode.Uri;
}

/**
 * The base as files, in up to two places.
 *
 * The project's notes live in the repository, so they are reviewed like code and arrive with a
 * clone — the argument that made skills files rather than settings, and it is stronger here: a note
 * saying how the settlement job works is worth more to the eleven other people on the team than to
 * the one who happened to ask.
 *
 * The personal base is for what is true of YOU across projects rather than of this repository, and
 * for anything you would not commit.
 */
export class FileKnowledgeStore implements KnowledgeStore {
  /** Where each id was last read from, so a note is written back where it came from. */
  private origin = new Map<string, Scope>();

  constructor(private readonly scope: "project" | "personal" | "both") {}

  describe(): string {
    return this.roots()
      .map((r) => (r.scope === "project" ? `${FOLDER}/${SUB}` : `~/${FOLDER}/${SUB}`))
      .join(", ");
  }

  private roots(): Root[] {
    const out: Root[] = [];
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (folder && this.scope !== "personal") {
      out.push({ scope: "project", uri: vscode.Uri.joinPath(folder.uri, FOLDER, SUB) });
    }
    if (this.scope !== "project") {
      const home = process.env["HOME"] ?? process.env["USERPROFILE"];
      if (home) out.push({ scope: "personal", uri: vscode.Uri.joinPath(vscode.Uri.file(home), FOLDER, SUB) });
    }
    return out;
  }

  async list(): Promise<KnowledgeNote[]> {
    const notes = new Map<string, KnowledgeNote>();
    this.origin.clear();
    for (const root of this.roots()) {
      for (const [id, uri] of await this.walk(root.uri)) {
        // The project's copy wins a collision: a team note and a personal note of the same name are
        // the same subject, and the one under review is the one to trust.
        if (notes.has(id) && this.origin.get(id) === "project") continue;
        const parsed = parseNote(id, await read(uri));
        if (!parsed.note) continue;
        notes.set(id, parsed.note);
        this.origin.set(id, root.scope);
      }
    }
    return [...notes.values()];
  }

  async read(id: string): Promise<KnowledgeNote | undefined> {
    if (!validId(id)) return undefined;
    for (const root of this.roots()) {
      const uri = vscode.Uri.joinPath(root.uri, notePath(id));
      try {
        const parsed = parseNote(id, await read(uri));
        if (parsed.note) {
          this.origin.set(id, root.scope);
          return parsed.note;
        }
      } catch {
        // Not in this root; try the next.
      }
    }
    return undefined;
  }

  async write(note: KnowledgeNote): Promise<void> {
    const roots = this.roots();
    if (!roots.length) throw new Error("No knowledge base is available: open a folder, or set a personal one.");
    const wanted = this.origin.get(note.id);
    const root = roots.find((r) => r.scope === wanted) ?? roots[0]!;
    const uri = vscode.Uri.joinPath(root.uri, notePath(note.id));
    await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(serialiseNote(note)));
    this.origin.set(note.id, root.scope);
  }

  /**
   * Retire a note.
   *
   * Moved to `.archive/`, with the reason and the date written into it, rather than deleted. The
   * base has to be able to shed what is no longer true — a base that only grows is one nobody
   * trusts — but "the agent decided this was obsolete" is not a standard of proof for destroying
   * the only written record of how something works.
   */
  async remove(id: string, reason: string): Promise<void> {
    for (const root of this.roots()) {
      const from = vscode.Uri.joinPath(root.uri, notePath(id));
      let text: string;
      try {
        text = await read(from);
      } catch {
        continue;
      }
      const to = vscode.Uri.joinPath(root.uri, ARCHIVE, notePath(id));
      const stamped = text.replace(/^---\n/, `---\nretired: ${today()}\nretired-because: ${reason.replace(/\n/g, " ")}\n`);
      await vscode.workspace.fs.writeFile(to, new TextEncoder().encode(stamped));
      await vscode.workspace.fs.delete(from);
      this.origin.delete(id);
      return;
    }
    throw new Error(`No note called “${id}”.`);
  }

  /** Every `.md` under a root, id first, skipping the archive. */
  private async walk(root: vscode.Uri, prefix = "", depth = 0): Promise<Array<[string, vscode.Uri]>> {
    if (depth > 3) return [];
    let entries: Array<[string, vscode.FileType]>;
    try {
      entries = await vscode.workspace.fs.readDirectory(root);
    } catch {
      return [];
    }
    const out: Array<[string, vscode.Uri]> = [];
    for (const [name, type] of entries) {
      if (name.startsWith(".")) continue;
      const uri = vscode.Uri.joinPath(root, name);
      if (type === vscode.FileType.Directory) {
        out.push(...(await this.walk(uri, `${prefix}${name}/`, depth + 1)));
        continue;
      }
      const id = noteId(`${prefix}${name}`);
      if (id) out.push([id, uri]);
    }
    return out;
  }
}

async function read(uri: vscode.Uri): Promise<string> {
  return new TextDecoder().decode(await vscode.workspace.fs.readFile(uri));
}

/** The store the settings ask for: a server when one is configured, files otherwise. */
export function knowledgeStore(settings: Settings): KnowledgeStore | undefined {
  if (!settings.knowledge.enabled) return undefined;
  const endpoint = settings.knowledge.endpoint.trim();
  if (endpoint) {
    return new HttpKnowledgeStore(endpoint, (url, init) => request(url, { ...init, label: "knowledge", timeoutMs: 20_000 }));
  }
  return new FileKnowledgeStore(settings.knowledge.scope);
}

/**
 * The list of titles that rides on every turn.
 *
 * Empty when the base is empty, and empty is the right answer: a heading announcing a knowledge
 * base with nothing in it teaches the model to look somewhere there is nothing.
 */
export async function knowledgeAmbient(settings: Settings): Promise<string | undefined> {
  const store = knowledgeStore(settings);
  if (!store) return undefined;
  try {
    const notes = await store.list();
    if (!notes.length) return undefined;
    return knowledgeIndex(notes, settings.knowledge.indexTokens).text || undefined;
  } catch {
    // A base that cannot be read must not take the turn down with it.
    return undefined;
  }
}

export function buildKnowledgeTools(settings: () => Settings): Tool[] {
  const store = (): KnowledgeStore => {
    const s = knowledgeStore(settings());
    if (!s) throw new Error("The knowledge base is switched off.");
    return s;
  };

  const search: Tool = {
    parallel: () => true,
    schema: {
      name: "knowledge_search",
      description:
        "Search the knowledge base — what has been recorded about this system, this business and these tools. Use it before answering from general knowledge, and before writing a note.",
      parameters: {
        type: "object",
        properties: { query: { type: "string", description: "Words to look for: a name, a rule, a subject." } },
        required: ["query"],
      },
    },
    approval: () => false,
    async run(args, ctx): Promise<ToolResult> {
      const query = String(args["query"] ?? "");
      const hits = searchNotes(await store().list(), query);
      ctx.report(t("{0} note(s) for “{1}”", hits.length, query));
      if (!hits.length) return { content: `Nothing recorded about “${query}”.` };
      return {
        content: hits
          .map((h) => [`## ${h.note.id} — ${h.note.title}`, ...h.lines.map((l) => `  ${l}`)].join("\n"))
          .join("\n\n"),
      };
    },
  };

  const readNote: Tool = {
    parallel: () => true,
    schema: {
      name: "knowledge_read",
      description: "Read one note from the knowledge base, whole, by its id.",
      parameters: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
    },
    approval: () => false,
    async run(args, ctx): Promise<ToolResult> {
      const id = String(args["id"] ?? "");
      const note = await store().read(id);
      if (!note) return { content: `No note called “${id}”.`, isError: true };
      ctx.report(t("read the note {0}", id));
      const header = [`# ${note.title}`, note.tags.length ? `Tags: ${note.tags.join(", ")}` : "", note.updated ? `Updated: ${note.updated}` : ""]
        .filter(Boolean)
        .join("\n");
      return { content: headToTokens(`${header}\n\n${note.body}`, MAX_NOTE_TOKENS) };
    },
  };

  const write: Tool = {
    schema: {
      name: "knowledge_write",
      description:
        "Record something durable in the knowledge base, or correct a note that is already there. Search first: if a note on this subject exists, pass its id to update it rather than adding a second one. Write what is true of this system, business or team — not what happened in this conversation.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string", description: "Path-shaped and lowercase: `finance/invoice-settlement`." },
          title: { type: "string", description: "One line naming the subject." },
          body: { type: "string", description: "The knowledge itself, in Markdown." },
          tags: { type: "string", description: "Comma-separated: a domain, a system, a language." },
          sources: { type: "string", description: "Where this came from: a file, a document, a person." },
          replaces: { type: "string", description: "The id of a note this supersedes, when one exists." },
        },
        required: ["id", "title", "body"],
      },
    },
    approval: (args) => t("record “{0}” in the knowledge base", String(args["title"] ?? args["id"])),
    async run(args, ctx): Promise<ToolResult> {
      const id = String(args["id"] ?? "").trim();
      const title = String(args["title"] ?? "").trim();
      const body = String(args["body"] ?? "").trim();
      if (!validId(id)) return { content: `“${id}” is not a usable id. Lowercase letters, digits, hyphens, and / to group.`, isError: true };
      if (!title || !body) return { content: "A note needs a title and a body.", isError: true };

      const s = store();
      const existing = await s.list();
      const already = existing.some((n) => n.id === id);
      const replaces = String(args["replaces"] ?? "").trim();

      // The check that keeps this a base rather than a pile. A NEW note whose subject is already
      // covered is refused once, with the notes that cover it — the model then updates the right
      // one, or says which it supersedes. Refusing rather than merging is deliberate: merging two
      // versions of a rule is a judgement about the business, and this is not the place to make it.
      if (!already && !replaces) {
        const near = nearDuplicates(existing, title, id);
        if (near.length) {
          return {
            content: [
              `The base already covers this. Update one of these instead — call knowledge_write again with its id — or pass "replaces" if it is genuinely superseded:`,
              ...near.slice(0, 3).map((n) => `- ${n.id} — ${n.title}`),
            ].join("\n"),
            isError: true,
          };
        }
      }

      const note: KnowledgeNote = {
        id,
        title,
        body,
        tags: split(args["tags"]),
        sources: split(args["sources"]),
        updated: today(),
      };
      await s.write(note);
      if (replaces && replaces !== id) {
        try {
          await s.remove(replaces, `superseded by ${id}`);
        } catch {
          // Superseding something that is not there is not a failure of the write that succeeded.
        }
      }
      ctx.report(t("recorded {0}", id));
      return { content: `Recorded as ${id}${already ? " (updated)" : ""}.` };
    },
  };

  const retire: Tool = {
    schema: {
      name: "knowledge_retire",
      description:
        "Retire a note that is no longer true. It is moved to the archive with the reason, not deleted. Use it when something has genuinely changed, never to tidy up.",
      parameters: {
        type: "object",
        properties: { id: { type: "string" }, reason: { type: "string" } },
        required: ["id", "reason"],
      },
    },
    approval: (args) => t("retire the note “{0}”", String(args["id"])),
    async run(args, ctx): Promise<ToolResult> {
      const id = String(args["id"] ?? "").trim();
      const reason = String(args["reason"] ?? "").trim();
      if (!reason) return { content: "Say why, in one line: the archive is read by people.", isError: true };
      await store().remove(id, reason);
      ctx.report(t("retired {0}", id));
      return { content: `${id} moved to the archive.` };
    },
  };

  return [search, readNote, write, retire];
}

function split(value: unknown): string[] {
  return typeof value === "string" ? value.split(",").map((p) => p.trim()).filter(Boolean) : [];
}

/**
 * The base, opened.
 *
 * A knowledge base the owner cannot read is a knowledge base nobody can correct, and correction is
 * the whole difference between a base and a pile. So: every note, with what it is about, one click
 * from the file it lives in — and a way to write one by hand, because the first note in a base is
 * usually a person's, not a model's.
 */
export async function showKnowledge(): Promise<void> {
  const settings = readSettings();
  if (!settings.knowledge.enabled) {
    const turnOn = t("Turn it on");
    const answer = await vscode.window.showInformationMessage(
      t("The knowledge base is switched off."),
      { modal: false, detail: t("It is what the agent has learned about this system and this business, kept in Markdown files it can search and correct.") },
      turnOn,
    );
    if (answer === turnOn) {
      await vscode.workspace.getConfiguration("hiveyCode").update("knowledge.enabled", true, vscode.ConfigurationTarget.Global);
    }
    return;
  }

  const store = knowledgeStore(settings)!;
  let notes: KnowledgeNote[] = [];
  try {
    notes = await store.list();
  } catch (err) {
    void vscode.window.showErrorMessage(`Hivey Code : ${(err as Error).message}`);
    return;
  }

  const write = t("Write a note…");
  const rows: Array<vscode.QuickPickItem & { note?: KnowledgeNote }> = [
    { label: write, detail: t("A Markdown file in {0} — opens ready to write", store.describe()) },
    ...(notes.length ? [{ label: "", kind: vscode.QuickPickItemKind.Separator }] : []),
    ...notes
      .sort((a, b) => (b.updated ?? "").localeCompare(a.updated ?? "") || a.id.localeCompare(b.id))
      .map((note) => ({
        label: note.title,
        description: note.id,
        detail: [note.tags.join(", "), note.updated].filter(Boolean).join(" · "),
        note,
      })),
  ];

  const picked = await vscode.window.showQuickPick(rows, {
    placeHolder: notes.length
      ? t("{0} note(s) in {1}", notes.length, store.describe())
      : t("Nothing recorded yet — {0}", store.describe()),
    matchOnDescription: true,
    matchOnDetail: true,
  });
  if (!picked) return;

  if (picked.label === write) {
    await newNote();
    return;
  }
  if (!picked.note) return;
  await openNote(picked.note);
}

/** A note in an editor: the file itself when there is one, a read-only copy when it came from a server. */
async function openNote(note: KnowledgeNote): Promise<void> {
  const folder = vscode.workspace.workspaceFolders?.[0];
  const home = process.env["HOME"] ?? process.env["USERPROFILE"];
  for (const base of [folder ? vscode.Uri.joinPath(folder.uri, FOLDER, SUB) : undefined, home ? vscode.Uri.joinPath(vscode.Uri.file(home), FOLDER, SUB) : undefined]) {
    if (!base) continue;
    const uri = vscode.Uri.joinPath(base, notePath(note.id));
    try {
      await vscode.workspace.fs.stat(uri);
      await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(uri));
      return;
    } catch {
      // Not here.
    }
  }
  const doc = await vscode.workspace.openTextDocument({ language: "markdown", content: serialiseNote(note) });
  await vscode.window.showTextDocument(doc);
}

/** A blank note, with its header already written: the format is the part nobody remembers. */
async function newNote(): Promise<void> {
  const settings = readSettings();
  const id = await vscode.window.showInputBox({
    prompt: t("An id for the note — lowercase, and / to group: finance/invoice-settlement"),
    placeHolder: "finance/invoice-settlement",
    validateInput: (value) => (validId(value.trim()) ? undefined : t("Lowercase letters, digits, hyphens, and / to group.")),
  });
  if (!id?.trim()) return;

  const folder = vscode.workspace.workspaceFolders?.[0];
  const home = process.env["HOME"] ?? process.env["USERPROFILE"];
  const base =
    settings.knowledge.scope !== "personal" && folder
      ? vscode.Uri.joinPath(folder.uri, FOLDER, SUB)
      : home
        ? vscode.Uri.joinPath(vscode.Uri.file(home), FOLDER, SUB)
        : undefined;
  if (!base) {
    void vscode.window.showWarningMessage(t("No folder is open and no home directory to write to."));
    return;
  }

  const uri = vscode.Uri.joinPath(base, notePath(id.trim()));
  try {
    await vscode.workspace.fs.stat(uri);
  } catch {
    await vscode.workspace.fs.writeFile(
      uri,
      new TextEncoder().encode(
        serialiseNote({
          id: id.trim(),
          title: "",
          tags: [],
          sources: [],
          body: t("What is true here, and why it matters. One subject per note."),
        }),
      ),
    );
  }
  const doc = await vscode.workspace.openTextDocument(uri);
  await vscode.window.showTextDocument(doc);
}
