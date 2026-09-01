// The house rules, read from the repository.
//
// Every team has conventions a model cannot infer from one file: the error type everyone throws,
// the fact that this repository is French-commented, the library that was banned two years ago and
// still appears in every answer. Copilot reads `.github/copilot-instructions.md` for this, and that
// file is read here too — deliberately, because a team that already wrote one should not have to
// write it twice, and because the alternative is every assistant inventing its own dotfile.
//
// Two safeguards, both because this text goes into the system prompt of every turn:
//
//   • IT IS BOUNDED. A file that grows to a thousand lines would quietly eat the context budget on
//     every question, and nobody would connect the two. It is cut, and the cut is announced.
//   • IT IS INSTRUCTIONS, NOT CONTENT. The file is written by the team, checked into the
//     repository, and reviewed like code — so unlike an attachment, it is trusted. That is a real
//     decision and it rests entirely on the file being under version control: a rule that arrives
//     with a cloned repository has the same authority as the code that arrives with it, which is
//     to say the authority the user granted when they opened the folder.

import * as vscode from "vscode";
import { t } from "../shared/i18n.js";
import { estimateTokens } from "../core/util/tokens.js";

const MAX_TOKENS = 1200;

/** In order of preference. The first that exists wins; they are not concatenated. */
const CANDIDATES = [
  [".hiveycode", "instructions.md"],
  [".github", "copilot-instructions.md"],
  [".github", "instructions.md"],
];

export interface Instructions {
  path: string;
  text: string;
  truncated: boolean;
}

let cached: { key: string; value: Instructions | undefined } | undefined;

/** Drops the cache when one of the candidate files changes, so an edit takes effect immediately. */
export function watchInstructions(disposables: vscode.Disposable[]): void {
  const watcher = vscode.workspace.createFileSystemWatcher("**/{.hiveycode/instructions.md,.github/*instructions.md}");
  const clear = () => {
    cached = undefined;
  };
  watcher.onDidChange(clear);
  watcher.onDidCreate(clear);
  watcher.onDidDelete(clear);
  disposables.push(watcher, { dispose: clear });
}

export async function readInstructions(): Promise<Instructions | undefined> {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) return undefined;
  const key = folder.uri.toString();
  if (cached?.key === key) return cached.value;

  for (const parts of CANDIDATES) {
    const uri = vscode.Uri.joinPath(folder.uri, ...parts);
    try {
      const bytes = await vscode.workspace.fs.readFile(uri);
      const raw = new TextDecoder().decode(bytes).trim();
      if (!raw) continue;
      const value = clip(raw, parts.join("/"));
      cached = { key, value };
      return value;
    } catch {
      // Not there. The next candidate, or none at all.
    }
  }
  cached = { key, value: undefined };
  return undefined;
}

function clip(raw: string, path: string): Instructions {
  if (estimateTokens(raw) <= MAX_TOKENS) return { path, text: raw, truncated: false };
  // Cut on a line boundary rather than mid-sentence: half a rule reads as a whole one.
  const lines = raw.split("\n");
  const kept: string[] = [];
  let used = 0;
  for (const line of lines) {
    const cost = estimateTokens(line);
    if (used + cost > MAX_TOKENS) break;
    kept.push(line);
    used += cost;
  }
  return { path, text: kept.join("\n"), truncated: true };
}

/** The block appended to the system prompt, or an empty string when there is nothing to say. */
/**
 * The instruction files that exist, as workspace-relative paths.
 *
 * Every candidate rather than only the winning one: the prompt uses the first that exists, but the
 * context picker is answering a different question — "which of these can I look at" — and a file
 * that is being shadowed is exactly the one somebody needs to open to find out why.
 */
export async function instructionFiles(): Promise<string[]> {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) return [];
  const found: string[] = [];
  for (const parts of CANDIDATES) {
    const uri = vscode.Uri.joinPath(folder.uri, ...parts);
    try {
      await vscode.workspace.fs.stat(uri);
      found.push(parts.join("/"));
    } catch {
      /* absent */
    }
  }
  return found;
}

export async function instructionsPrompt(): Promise<string> {
  const found = await readInstructions();
  if (!found) return "";
  const header = `\n\nThe team that owns this repository wrote the following rules in ${found.path}. Follow them; where they contradict a general habit of yours, they win.`;
  const note = found.truncated ? `\n\n(${found.path} was longer than the budget allows and was cut.)` : "";
  return `${header}\n\n${found.text}${note}`;
}

/** For the interface: what is in force, in one line. */
export function instructionsLabel(found: Instructions | undefined): string {
  return found ? t("Rules from {0} are applied.", found.path) : t("No repository rules file.");
}
