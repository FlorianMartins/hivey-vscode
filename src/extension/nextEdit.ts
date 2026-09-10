// Watching what somebody edits, and offering the edit that follows.
//
// See `core/completion/nextEdit.ts` for what this is and why it is worth having. This file is the
// editor half: keeping a short journal of what changed, waiting for a pause, asking the model that
// is already running on the machine, and putting the answer somewhere the user can take it or
// ignore it without being interrupted.
//
// Three decisions about WHEN, and each is there to keep the feature from becoming a nuisance:
//
//   • Only after an edit. Opening a file and reading it must never make a model run — the pause
//     after moving the cursor is not a request for help.
//   • Only on a local endpoint, unless the user says otherwise. A feature that fires on every pause
//     in typing is the most expensive shape a remote request can take. Free on your own machine,
//     alarming on somebody's API key.
//   • Only one at a time, and cancelled the moment anything changes again. A suggestion computed
//     against a file that has since moved is worse than none: it will not apply, or worse, it will.

import * as vscode from "vscode";
import { t } from "../shared/i18n.js";
import {
  buildNextEditPrompt,
  checkNextEdit,
  describeRecentWork,
  parseNextEdit,
  summarise,
  type EditEvent,
  type NextEdit,
} from "../core/completion/nextEdit.js";
import { isLocalEndpoint } from "../core/redaction/index.js";
import { providerFor, readSettings, type Keys, type Settings } from "./config.js";
import { relative } from "./workspace.js";
import { EgressGate } from "./egress.js";

/** How long a pause counts as "stopped typing". Longer than completion's: this is not urgent. */
const IDLE_MS = 1200;

/** Files bigger than this are not offered: the whole file goes in the prompt. */
const MAX_FILE_CHARS = 24_000;

/** How many raw change events to keep. Enough for half a minute of fast typing. */
const JOURNAL_MAX = 400;

export interface Suggestion {
  uri: vscode.Uri;
  range: vscode.Range;
  edit: NextEdit;
  summary: string;
}

/**
 * The editor-side driver: a journal, a timer, and at most one suggestion.
 *
 * Deliberately not an `InlineCompletionItemProvider`. Inline completions are drawn at the cursor,
 * and the whole point here is that the interesting edit is somewhere else — a ghost suggestion the
 * user cannot see is not a feature. A hint-level diagnostic can be placed anywhere in the file, it
 * shows in the minimap and the Problems view, and it carries a quick fix, which is exactly the
 * shape "there is one more thing to change, over there" wants.
 */
export class NextEditWatcher {
  private readonly journal: EditEvent[] = [];
  private readonly diagnostics = vscode.languages.createDiagnosticCollection("hivey-next-edit");
  private timer: ReturnType<typeof setTimeout> | undefined;
  private inFlight: AbortController | undefined;
  private current: Suggestion | undefined;

  constructor(
    private readonly keys: Keys,
    private readonly log: vscode.OutputChannel,
  ) {}

  /** True when this is switched on for this document, and would cost nothing surprising. */
  private enabled(settings: Settings, document: vscode.TextDocument): boolean {
    if (!settings.completion.nextEdit) return false;
    if (settings.completion.provider === "off" || !settings.completion.enabled) return false;
    if (document.uri.scheme !== "file" && document.uri.scheme !== "untitled") return false;
    if (document.getText().length > MAX_FILE_CHARS) return false;
    // The rule that keeps this free. A remote completion endpoint is a bill per pause in typing,
    // and the user has to have said so explicitly — see `nextEditRemote`.
    // `provider === "off"` is already ruled out above, so this is the endpoint that would answer.
    const endpoint = settings.endpoints[settings.completion.provider];
    if (!isLocalEndpoint(endpoint ?? "") && !settings.completion.nextEditRemote) return false;
    // A file the operator excluded is not sent anywhere, and here the WHOLE file is sent.
    if (EgressGate.isBlocked(relative(document.uri), settings.privacy.blockedGlobs)) return false;
    return true;
  }

  /** Record a change, and restart the clock. */
  onChange(event: vscode.TextDocumentChangeEvent, previousText: string): void {
    if (!event.contentChanges.length) return;
    const settings = readSettings(event.document.uri);
    // Anything the user does invalidates a suggestion computed against the old text — including
    // accepting it, which is why this comes before the enabled check.
    this.clear();
    if (!this.enabled(settings, event.document)) return;

    this.journal.push({
      path: relative(event.document.uri),
      at: Date.now(),
      before: previousText,
      after: event.document.getText(),
    });
    if (this.journal.length > JOURNAL_MAX) this.journal.splice(0, this.journal.length - JOURNAL_MAX);

    if (this.timer) clearTimeout(this.timer);
    const uri = event.document.uri;
    this.timer = setTimeout(() => void this.predict(uri), IDLE_MS);
  }

  /** Drop the current suggestion and stop anything computing one. */
  clear(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    this.inFlight?.abort();
    this.inFlight = undefined;
    if (this.current) {
      this.diagnostics.delete(this.current.uri);
      this.current = undefined;
    }
  }

  suggestionFor(uri: vscode.Uri, range: vscode.Range): Suggestion | undefined {
    if (!this.current || this.current.uri.toString() !== uri.toString()) return undefined;
    return this.current.range.intersection(range) ? this.current : undefined;
  }

  /** Apply the current suggestion. Re-checked against the file first: it may have moved. */
  async apply(): Promise<boolean> {
    const suggestion = this.current;
    if (!suggestion) return false;
    const document = await vscode.workspace.openTextDocument(suggestion.uri);
    const text = document.getText();
    const at = text.indexOf(suggestion.edit.find);
    if (at < 0 || text.indexOf(suggestion.edit.find, at + 1) >= 0) {
      // The file moved between the suggestion being drawn and the user clicking it. Applying by
      // offset here would edit whatever now happens to be there.
      this.clear();
      void vscode.window.showInformationMessage(t("That suggestion no longer matches the file."));
      return false;
    }
    const edit = new vscode.WorkspaceEdit();
    edit.replace(
      suggestion.uri,
      new vscode.Range(document.positionAt(at), document.positionAt(at + suggestion.edit.find.length)),
      suggestion.edit.replace,
    );
    const ok = await vscode.workspace.applyEdit(edit);
    this.clear();
    return ok;
  }

  private async predict(uri: vscode.Uri): Promise<void> {
    const settings = readSettings(uri);
    const document = vscode.workspace.textDocuments.find((d) => d.uri.toString() === uri.toString());
    if (!document || !this.enabled(settings, document)) return;
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.uri.toString() !== uri.toString()) return;

    const recentWork = describeRecentWork(this.journal, Date.now());
    if (!recentWork) return;

    const ctl = new AbortController();
    this.inFlight = ctl;
    try {
      // Guarded by `enabled()`, which returns false for "off" before anything reaches here.
      const providerId = settings.completion.provider as Exclude<Settings["completion"]["provider"], "off">;
      const provider = await providerFor(settings, this.keys, providerId);
      const text = document.getText();
      const prompt = buildNextEditPrompt({
        path: relative(uri),
        text,
        cursorLine: editor.selection.active.line,
        recentWork,
        languageId: document.languageId,
      });
      const result = await provider.chat({
        model: settings.completion.model,
        messages: [{ role: "user", content: prompt }],
        maxTokens: 400,
        temperature: 0,
        // Never: this is a prediction, not a question, and a thinking budget on every pause in
        // typing is the whole cost of the feature spent on nothing.
        reasoning: "none",
        signal: ctl.signal,
      });
      if (ctl.signal.aborted) return;

      const parsed = parseNextEdit(result.text);
      if (!parsed) return;
      const check = checkNextEdit(parsed, text, editor.selection.active.line);
      if (!check.ok) {
        // Silent. The model is small and wrong a fair amount of the time; a suggestion the user has
        // to notice and dismiss costs more attention than the feature saves.
        this.log.appendLine(`[next-edit] discarded: ${check.why}`);
        return;
      }

      const range = new vscode.Range(
        document.positionAt(check.offset!),
        document.positionAt(check.offset! + parsed.find.length),
      );
      const summary = summarise(parsed);
      const diagnostic = new vscode.Diagnostic(range, t("Hivey Code: {0}", summary), vscode.DiagnosticSeverity.Hint);
      diagnostic.source = "Hivey Code";
      // `Unnecessary` would grey the code out, which is a claim about the code rather than a
      // suggestion about it. No tag: a hint underline and a lightbulb are enough.
      this.current = { uri, range, edit: parsed, summary };
      this.diagnostics.set(uri, [diagnostic]);
    } catch (err) {
      if (!ctl.signal.aborted) this.log.appendLine(`[next-edit] ${(err as Error).message}`);
    } finally {
      if (this.inFlight === ctl) this.inFlight = undefined;
    }
  }

  dispose(): void {
    this.clear();
    this.diagnostics.dispose();
  }
}
