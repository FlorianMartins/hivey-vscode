// Turning `#something` into the thing itself.
//
// The parser in core said what the user asked for; this fetches it. Everything here runs on the
// user's machine and finishes before a single byte is sent — which is the point of resolving
// mentions locally rather than in a product's backend. `#changes` on a private repository attaches
// a diff of unreleased code to a conversation with a model running on localhost, and nothing
// about that has to be trusted to anyone.
//
// Three rules hold throughout:
//   • A mention that cannot be resolved becomes a note saying so, not a silent omission. A model
//     told nothing about `#problems` assumes there were none.
//   • Everything fetched is marked untrusted, because a file, a diff and a terminal buffer are all
//     text the user did not write in this conversation, and one of them may be trying to give
//     instructions.
//   • The privacy rules apply here exactly as they do to an attachment made by hand: a blocked
//     file stays blocked whether it was picked in a dialog or named after a `#`.

import * as vscode from "vscode";
import { isDocumentUri } from "./models.js";
import { t } from "../shared/i18n.js";
import type { ContextItem } from "../core/session/session.js";
import { describeMention, type Mention } from "../core/session/mentions.js";
import { headToTokens } from "../core/util/tokens.js";
import type { Settings } from "./config.js";
import type { WorkspaceContext } from "./workspace.js";
import { relative } from "./workspace.js";
import { gitChangesSummary } from "./integrations/git.js";
import { ibmiConnected, ibmiInstance } from "./integrations/ibmi.js";
import { parseMemberRef, formatRows, isReadOnlySql } from "../core/ibmi/sql.js";

const MAX_TOKENS = 4000;

export interface ResolveDeps {
  workspace: WorkspaceContext;
  settings: Settings;
  /** The repository map, shared with the turn so the same budget is not spent twice. */
  repoMap: () => Promise<{ text: string; files: number; omitted: number } | undefined>;
}

export async function resolveMentions(mentions: Mention[], deps: ResolveDeps): Promise<ContextItem[]> {
  const out: ContextItem[] = [];
  for (const mention of mentions) {
    try {
      const item = await resolveOne(mention, deps);
      if (item) out.push(item);
    } catch (error) {
      // A mention that fails is worth saying out loud. The alternative — dropping it — produces an
      // answer built on an absence the user believes they filled.
      out.push({
        kind: "note",
        label: describeMention(mention),
        body: t("“{0}” could not be resolved: {1}", mention.raw, error instanceof Error ? error.message : String(error)),
      });
    }
  }
  return out;
}

async function resolveOne(mention: Mention, deps: ResolveDeps): Promise<ContextItem | undefined> {
  switch (mention.kind) {
    case "selection":
    case "editor":
      return deps.workspace.activeContext(mention.kind === "selection" ? 2000 : 6000);

    case "file": {
      const path = mention.argument;
      if (!path) return undefined;
      const folder = vscode.workspace.workspaceFolders?.[0];
      if (!folder) throw new Error(t("No folder is open."));
      return deps.workspace.fileContext(vscode.Uri.joinPath(folder.uri, path), deps.settings);
    }

    case "openFiles": {
      // Every open TAB, not the editors currently on screen.
      //
      // It read `visibleTextEditors`, which is what is laid out in the editor area right now —
      // one document, or two in a split. So "attach all N open files" attached one, and the count
      // beside it was right while the result was wrong. `tabGroups` is what the Open Editors view
      // reads, and what anyone means by "open".
      const items: string[] = [];
      const seen = new Set<string>();
      for (const group of vscode.window.tabGroups.all) {
        for (const tab of group.tabs) {
          // Same rule as "attach all open editors", and for the same reason: `#open` returned
          // nothing at all over SSH, in a container, or on an IBM i, because every tab there is
          // served under a scheme that is not `file`.
          if (!(tab.input instanceof vscode.TabInputText)) continue;
          const uri = tab.input.uri;
          if (!isDocumentUri(uri) || seen.has(uri.toString())) continue;
          seen.add(uri.toString());
          try {
            const doc = await vscode.workspace.openTextDocument(uri);
            items.push(`--- ${relative(uri)}\n${doc.getText()}`);
          } catch {
            // A tab whose file has been deleted since. One missing file must not lose the rest.
          }
        }
      }
      if (!items.length) return undefined;
      return {
        kind: "files",
        label: t("open files"),
        body: headToTokens(items.join("\n\n"), MAX_TOKENS),
        untrusted: true,
      };
    }

    case "codebase": {
      const map = await deps.repoMap();
      if (!map) return undefined;
      return { kind: "repomap", label: t("repository map"), body: map.text };
    }

    case "changes": {
      const diff = await gitChangesSummary();
      if (!diff) throw new Error(t("No Git repository is open."));
      return { kind: "diff", label: t("uncommitted changes"), body: diff, untrusted: true };
    }

    case "problems": {
      const body = problems();
      return {
        kind: "diagnostics",
        label: t("problems"),
        // "None" is information: it tells the model the compiler is happy and the bug is elsewhere.
        body: body || t("The language servers report no errors or warnings."),
      };
    }

    case "terminal": {
      const text = await terminalSelection();
      if (!text) {
        throw new Error(t("Nothing is selected in a terminal. Select the output first, or paste it."));
      }
      return { kind: "terminal", label: t("terminal"), body: headToTokens(text, MAX_TOKENS), untrusted: true };
    }

    case "symbol": {
      const name = mention.argument;
      if (!name) return undefined;
      const symbols = await vscode.commands.executeCommand<vscode.SymbolInformation[]>(
        "vscode.executeWorkspaceSymbolProvider",
        name,
      );
      if (!symbols?.length) throw new Error(t("No symbol named “{0}”.", name));
      const lines: string[] = [];
      for (const symbol of symbols.slice(0, 8)) {
        const doc = await vscode.workspace.openTextDocument(symbol.location.uri).then(
          (d) => d,
          () => undefined,
        );
        const range = symbol.location.range;
        const text = doc ? doc.getText(new vscode.Range(range.start.line, 0, Math.min(range.end.line + 12, doc.lineCount - 1), 0)) : "";
        lines.push(`--- ${relative(symbol.location.uri)}:${range.start.line + 1}\n${text}`);
      }
      return { kind: "symbol", label: name, body: headToTokens(lines.join("\n\n"), MAX_TOKENS), untrusted: true };
    }

    case "member": {
      const ref = mention.argument;
      if (!ref) return undefined;
      const conn = requireIbmi();
      const { library, sourceFile, member } = parseMemberRef(ref);
      const text = await conn.getContent().downloadMemberContent(library, sourceFile, member);
      return {
        kind: "member",
        label: `${library}/${sourceFile}(${member})`,
        body: headToTokens(text, MAX_TOKENS),
        untrusted: true,
      };
    }

    case "sql": {
      const statement = mention.argument;
      if (!statement) return undefined;
      // A mention runs without a dialog, so it may only read. Anything else has to go through the
      // tool, where the user is asked — the notation must not become a way around the question.
      if (!isReadOnlySql(statement)) {
        throw new Error(t("“#db2:” runs statements that read. Ask the agent to run anything else, so you are asked first."));
      }
      const rows = await requireIbmi().getContent().runSQL(statement);
      return {
        kind: "db2",
        label: t("{0} rows", rows.length),
        body: headToTokens(`${statement}\n\n${formatRows(rows)}`, MAX_TOKENS),
        untrusted: true,
      };
    }
  }
  return undefined;
}

interface IbmiConnectionLike {
  getContent(): {
    runSQL(statement: string): Promise<Array<Record<string, unknown>>>;
    downloadMemberContent(library: string, sourceFile: string, member: string): Promise<string>;
  };
}

function requireIbmi(): IbmiConnectionLike {
  if (!ibmiConnected()) throw new Error(t("Not connected to an IBM i. Connect with Code for IBM i first."));
  return ibmiInstance()!.getConnection() as unknown as IbmiConnectionLike;
}

/** Errors and warnings, grouped by file, in the shape a compiler prints them. */
function problems(limit = 60): string {
  const lines: string[] = [];
  for (const [uri, diagnostics] of vscode.languages.getDiagnostics()) {
    const relevant = diagnostics.filter((d) => d.severity <= vscode.DiagnosticSeverity.Warning);
    if (!relevant.length) continue;
    lines.push(`--- ${relative(uri)}`);
    for (const d of relevant.slice(0, 20)) {
      const severity = d.severity === vscode.DiagnosticSeverity.Error ? "error" : "warning";
      lines.push(`  ${d.range.start.line + 1}:${d.range.start.character + 1} ${severity}: ${d.message}`);
      if (lines.length > limit) return lines.join("\n");
    }
  }
  return lines.join("\n");
}

/**
 * What is selected in the terminal.
 *
 * There is no API that reads a terminal's buffer, and the one that exists — shell integration —
 * reports command output only for shells that support it and only for commands run after the
 * integration attached. Copying the selection through the clipboard is the technique that works
 * everywhere, and the clipboard is put back exactly as it was, because silently replacing what
 * someone had copied is the kind of thing that loses work.
 */
async function terminalSelection(): Promise<string | undefined> {
  const terminal = vscode.window.activeTerminal;
  if (!terminal) return undefined;
  const saved = await vscode.env.clipboard.readText();
  try {
    await vscode.commands.executeCommand("workbench.action.terminal.copySelection");
    const text = await vscode.env.clipboard.readText();
    return text && text !== saved ? text : undefined;
  } finally {
    await vscode.env.clipboard.writeText(saved);
  }
}
