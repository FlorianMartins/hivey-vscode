// The commands that live in the editor rather than in the panel: ask about a selection, rewrite a
// selection in place, write a commit message, explain what the terminal just printed.
//
// They share the panel's plumbing (provider, redaction, budget) but not its conversation: an
// inline edit is a one-shot request that should not pollute — or be polluted by — the discussion
// the user is having in the sidebar.

import * as vscode from "vscode";
import { t } from "../shared/i18n.js";
import { runTurn } from "../core/agent/loop.js";
import { isLocalEndpoint, redact, Vault } from "../core/redaction/index.js";
import { headToTokens } from "../core/util/tokens.js";
import type { ChatViewProvider } from "./chat.js";
import { endpointFor, providerFor, readSettings, redactionPolicy, type Keys } from "./config.js";
import { COMMIT_PROMPT, INLINE_EDIT_PROMPT } from "../core/prompts.js";
import { relative, type WorkspaceContext } from "./workspace.js";
import { selectionActions, type SelectionAction } from "../core/agent/selection.js";

export interface EditorDeps {
  chat: ChatViewProvider;
  extensionUri: vscode.Uri;
  keys: Keys;
  workspace: WorkspaceContext;
  log: vscode.OutputChannel;
}

export function registerEditorCommands(context: vscode.ExtensionContext, deps: EditorDeps): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("hiveyCode.askAboutSelection", async () => {
      const item = deps.workspace.activeContext();
      const question = await vscode.window.showInputBox({
        prompt: t("What do you want to know about this selection?"),
        placeHolder: t("Explain what this code does / find the bug / write a test"),
        ignoreFocusOut: true,
      });
      if (!question) return;
      await deps.chat.focusWithPrompt(question, item);
    }),

    vscode.commands.registerCommand("hiveyCode.editSelection", () => rewriteSelection(deps)),

    // One catalogue entry, run. Separate from `editSelection` because the instruction is already
    // known: asking for it again, prefilled, would be a dialog whose only useful answer is Enter.
    vscode.commands.registerCommand("hiveyCode.rewriteWith", (instruction: string) => rewriteSelection(deps, instruction)),

    vscode.commands.registerCommand("hiveyCode.selectionActions", () => selectionMenu(deps)),

    vscode.commands.registerCommand("hiveyCode.addSelectionToChat", async () => {
      await deps.chat.attachSelection();
    }),

    vscode.commands.registerCommand("hiveyCode.generateCommitMessage", async () => {
      const git = vscode.extensions.getExtension<GitExtensionApi>("vscode.git")?.exports?.getAPI(1);
      const repo = git?.repositories?.[0];
      if (!repo) {
        void vscode.window.showWarningMessage(t("No Git repository is open."));
        return;
      }
      const diff: string = await repo.diff(true);
      if (!diff.trim()) {
        void vscode.window.showWarningMessage(t("Nothing staged: run `git add` first."));
        return;
      }
      const message = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.SourceControl, title: t("Hivey Code: commit message…") },
        () => oneShot(deps, COMMIT_PROMPT, headToTokens(diff, 6000)),
      );
      if (message) repo.inputBox.value = stripFence(message).trim();
    }),

    // Quick fix on a diagnostic: the language server says what is wrong, so the model is asked a
    // precise question instead of being told to find the bug.
    vscode.commands.registerCommand("hiveyCode.fixDiagnostic", async (uri: vscode.Uri, diagnostic: vscode.Diagnostic) => {
      const editor = await vscode.window.showTextDocument(uri);
      const doc = editor.document;
      // Widen to whole lines with a little room around them: a fix rarely fits inside the squiggle.
      const start = Math.max(0, diagnostic.range.start.line - 3);
      const end = Math.min(doc.lineCount - 1, diagnostic.range.end.line + 3);
      const range = new vscode.Range(start, 0, end, doc.lineAt(end).text.length);
      const original = doc.getText(range);

      const replacement = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: t("Hivey Code: fixing…"), cancellable: true },
        (_p, token) =>
          oneShot(
            deps,
            INLINE_EDIT_PROMPT,
            [
              `Language: ${doc.languageId}`,
              `The editor reports on line ${diagnostic.range.start.line + 1}: ${diagnostic.message}`,
              "Instruction: fix exactly that problem and change nothing else.",
              "",
              "Fragment:",
              original,
            ].join("\n"),
            token,
          ),
      );
      if (!replacement) return;
      await editor.edit((b) => b.replace(range, stripFence(replacement)));
      void vscode.window.showInformationMessage(t("Fix applied — Ctrl+Z to undo."));
    }),

    vscode.commands.registerCommand("hiveyCode.explainDiagnostic", async (uri: vscode.Uri, diagnostic: vscode.Diagnostic) => {
      const doc = await vscode.workspace.openTextDocument(uri);
      const start = Math.max(0, diagnostic.range.start.line - 5);
      const end = Math.min(doc.lineCount - 1, diagnostic.range.end.line + 5);
      await deps.chat.focusWithPrompt(t("Explain this problem and propose the fix: “{0}”", diagnostic.message), {
        kind: "diagnostic",
        label: `${relative(uri)}:${diagnostic.range.start.line + 1}`,
        body: doc.getText(new vscode.Range(start, 0, end, doc.lineAt(end).text.length)),
        untrusted: true,
      });
    }),

    vscode.commands.registerCommand("hiveyCode.askWith", async (instruction: string) => {
      await deps.chat.focusWithPrompt(instruction, deps.workspace.activeContext());
    }),

    vscode.commands.registerCommand("hiveyCode.explainTerminalSelection", async () => {
      const selection = vscode.window.activeTerminal ? await copyTerminalSelection() : undefined;
      if (!selection?.trim()) {
        void vscode.window.showWarningMessage(t("Select some text in the terminal first."));
        return;
      }
      await deps.chat.focusWithPrompt(t("Explain this terminal output and propose the fix."), {
        kind: "terminal",
        label: t("terminal output"),
        body: headToTokens(selection, 3000),
        untrusted: true,
      });
    }),
  );
}

/**
 * Everything on offer for a highlighted fragment, in one list.
 *
 * The right-click menu holds four rows because a context menu with a dozen is a context menu nobody
 * reads. This is where the rest live, and it is a quick pick rather than more submenus for the
 * reason the guided start is a submenu rather than a quick pick: a list opened from a keystroke
 * belongs in the middle of the screen, and a list opened from a click belongs under the click.
 *
 * Separated by where the result lands, because that is the only distinction that changes what
 * happens to your file — and the destination is written into the row, not left to be discovered.
 */
async function selectionMenu(deps: EditorDeps): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    void vscode.window.showWarningMessage(t("Open a file and select the code you want to work on."));
    return;
  }

  const all = selectionActions();
  const rows: Array<vscode.QuickPickItem & { action?: SelectionAction; ask?: boolean }> = [];
  for (const where of ["chat", "file"] as const) {
    rows.push({
      label: where === "chat" ? t("Answered in the conversation") : t("Rewritten in the file"),
      kind: vscode.QuickPickItemKind.Separator,
    });
    for (const action of all.filter((a) => a.where === where)) {
      rows.push({ label: action.label, action });
    }
  }
  rows.push({ label: "", kind: vscode.QuickPickItemKind.Separator });
  rows.push({ label: t("Ask something else…"), ask: true });

  const lines = editor.selection.isEmpty ? 0 : editor.selection.end.line - editor.selection.start.line + 1;
  const picked = await vscode.window.showQuickPick(rows, {
    // Says what it is about to act on. An action aimed at the wrong lines is the one mistake this
    // list can make on the user's behalf, and the selection is not visible while the list is open.
    placeHolder: lines
      ? t("{0}, {1} line(s) selected", relative(editor.document.uri), lines)
      : t("{0} — nothing selected, the current line is used", relative(editor.document.uri)),
    matchOnDescription: true,
  });
  if (!picked) return;
  if (picked.ask) {
    await vscode.commands.executeCommand("hiveyCode.askAboutSelection");
    return;
  }
  const action = picked.action;
  if (!action) return;
  if (action.where === "file") await rewriteSelection(deps, action.instruction);
  else await deps.chat.focusWithPrompt(action.instruction, deps.workspace.activeContext());
}

/**
 * Rewrite what is highlighted, in place.
 *
 * With no instruction it asks for one — that is Ctrl+I. With one, it does not ask: the row that was
 * clicked already said what it would do, and a prefilled dialog whose only sensible answer is Enter
 * is a step, not a confirmation. Nothing is lost either way, because the result arrives as an
 * ordinary edit: undo takes it back and the diff shows it.
 */
async function rewriteSelection(deps: EditorDeps, fixed?: string): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) return;
  const range = editor.selection.isEmpty ? editor.document.lineAt(editor.selection.active.line).range : editor.selection;
  const original = editor.document.getText(range);
  const instruction =
    fixed ??
    (await vscode.window.showInputBox({
      prompt: t("Edit {0} ({1} line(s))", relative(editor.document.uri), range.end.line - range.start.line + 1),
      placeHolder: t("extract a function, handle the error, add the types…"),
      ignoreFocusOut: true,
    }));
  if (!instruction) return;

  const replacement = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: t("Hivey Code: rewriting…"), cancellable: true },
    (_p, token) =>
      oneShot(
        deps,
        INLINE_EDIT_PROMPT,
        [`Language: ${editor.document.languageId}`, `Instruction: ${instruction}`, "", "Fragment:", original].join("\n"),
        token,
      ),
  );
  if (!replacement) return;

  const cleaned = stripFence(replacement);
  await editor.edit((b) => b.replace(range, cleaned));
  // The user reviews it as a normal edit: it is in the undo stack and in the SCM diff.
  void vscode.window.showInformationMessage(t("Change applied — Ctrl+Z to undo."), t("See the diff")).then((c) => {
    if (c === t("See the diff")) void vscode.commands.executeCommand("workbench.view.scm");
  });
}

/**
 * One request, no conversation, no tools. Redaction still applies: an inline edit sends the code
 * being edited, which is exactly the material a privacy policy is about.
 */
async function oneShot(deps: EditorDeps, system: string, user: string, token?: vscode.CancellationToken): Promise<string | undefined> {
  const settings = readSettings();
  const id = settings.chat.provider;
  try {
    const baseUrl = endpointFor(settings, id);
    const isLocal = isLocalEndpoint(baseUrl);
    const vault = new Vault();
    const payload = isLocal ? user : redact(user, vault, redactionPolicy(settings)).text;

    const provider = await providerFor(settings, deps.keys, id);
    const ctl = new AbortController();
    token?.onCancellationRequested(() => ctl.abort());

    const result = await runTurn({
      provider,
      model: settings.chat.model,
      messages: [
        { role: "system", content: system, cacheable: true },
        { role: "user", content: payload },
      ],
      maxTokens: 2048,
      temperature: 0.2,
      signal: ctl.signal,
      afterResponse: (t) => vault.restore(t),
    });
    return result.text;
  } catch (err) {
    const message = (err as Error).message;
    deps.log.appendLine(`[one-shot] ${message}`);
    void vscode.window.showErrorMessage(`Hivey Code : ${message}`);
    return undefined;
  }
}

/** Models wrap code in fences even when told not to; unwrap rather than argue with them. */
export function stripFence(text: string): string {
  const m = text.match(/^\s*```[a-zA-Z0-9+#-]*\n([\s\S]*?)```\s*$/);
  return (m ? m[1]! : text).replace(/\n$/, "");
}

async function copyTerminalSelection(): Promise<string | undefined> {
  // There is no API to read a terminal selection; the supported route is the copy command, and
  // the clipboard is restored afterwards so the user does not lose what they had.
  const previous = await vscode.env.clipboard.readText();
  await vscode.commands.executeCommand("workbench.action.terminal.copySelection");
  const text = await vscode.env.clipboard.readText();
  await vscode.env.clipboard.writeText(previous);
  return text === previous ? undefined : text;
}

interface GitExtensionApi {
  getAPI(version: number): {
    repositories: Array<{
      diff(staged: boolean): Promise<string>;
      inputBox: { value: string };
    }>;
  };
}

/**
 * Quote a path for whichever shell the terminal is running.
 *
 * PowerShell, cmd and every POSIX shell all accept a double-quoted argument; what differs is the
 * escape character inside it. A path containing a double quote is not something any of them handles
 * the same way — and is not something a filesystem should contain — so it is refused rather than
 * mangled.
 */
function quote(value: string): string {
  if (value.includes('"')) throw new Error(`Refusing to run a path containing a quote: ${value}`);
  return `"${value}"`;
}
