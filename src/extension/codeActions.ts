// Quick fixes on the editor's own diagnostics.
//
// This is the one place where an assistant inside an editor beats an assistant beside it: the
// language server already knows WHAT is wrong and WHERE, with a message written by people who
// understand the compiler. Handing that to the model — instead of asking it to find the bug by
// reading the file — turns a vague request into a precise one, and makes a small local model
// enough for a large share of everyday fixes.

import * as vscode from "vscode";
import { t } from "../shared/i18n.js";
import { selectionActions } from "../core/agent/selection.js";

export class HiveyCodeActions implements vscode.CodeActionProvider {
  static readonly kinds = [vscode.CodeActionKind.QuickFix, vscode.CodeActionKind.RefactorRewrite];

  provideCodeActions(
    document: vscode.TextDocument,
    range: vscode.Range | vscode.Selection,
    context: vscode.CodeActionContext,
  ): vscode.CodeAction[] {
    const actions: vscode.CodeAction[] = [];

    for (const diagnostic of context.diagnostics.slice(0, 3)) {
      const fix = new vscode.CodeAction(t("Fix with Hivey Code: {0}", short(diagnostic.message)), vscode.CodeActionKind.QuickFix);
      fix.diagnostics = [diagnostic];
      fix.command = {
        command: "hiveyCode.fixDiagnostic",
        title: t("Fix"),
        arguments: [document.uri, diagnostic],
      };
      actions.push(fix);

      const explain = new vscode.CodeAction(t("Explain this problem"), vscode.CodeActionKind.QuickFix);
      explain.diagnostics = [diagnostic];
      explain.command = {
        command: "hiveyCode.explainDiagnostic",
        title: t("Explain"),
        arguments: [document.uri, diagnostic],
      };
      actions.push(explain);
    }

    // On a selection, the two rows the catalogue marks for the lightbulb, and a way to the rest.
    //
    // Two, not eight: the lightbulb is shared with every other extension and with the editor's own
    // refactorings, and a provider that puts its whole menu there buries theirs. The full list is
    // one keystroke away, and it is the same list — both are built from `selectionActions`, so an
    // option cannot exist in one surface and be missing from the other.
    if (!range.isEmpty) {
      for (const offer of selectionActions().filter((a) => a.lightbulb)) {
        const action = new vscode.CodeAction(offer.label, vscode.CodeActionKind.RefactorRewrite);
        const command = offer.where === "file" ? "hiveyCode.rewriteWith" : "hiveyCode.askWith";
        action.command = { command, title: offer.label, arguments: [offer.instruction] };
        actions.push(action);
      }

      const more = new vscode.CodeAction(t("More with Hivey Code…"), vscode.CodeActionKind.RefactorRewrite);
      more.command = { command: "hiveyCode.selectionActions", title: t("More with Hivey Code…") };
      actions.push(more);
    }

    return actions;
  }
}

function short(message: string): string {
  const line = message.split("\n")[0] ?? message;
  return line.length > 60 ? `${line.slice(0, 57)}…` : line;
}
