// The panel's other half: everything the sidebar can do, minus the pixels.
//
// This is where the pieces meet — settings choose the provider, the mode chooses the tools, the
// router decides whether the question is worth escalating, the egress gate decides what may leave,
// the permission book decides what may run, and the session decides what the model is allowed to
// remember. Each of those lives somewhere else and is tested there; this file is the wiring, and
// it is deliberately the only place that knows about all of them.

import * as vscode from "vscode";
import { discardChanges, dirtyPaths } from "./integrations/git.js";
import { planGitRestore } from "../core/session/gitRestore.js";
import { DEFAULT_AGENT_STEPS } from "../core/agent/definitions.js";
import { changeSize, describeChangeSize } from "../core/text/diff.js";
import { spawn } from "node:child_process";
import { closeSync, fstatSync, openSync, readSync } from "node:fs";
import * as fsp from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  AUDIO_EXTENSION,
  cleanTranscript,
  dictationMode,
  transcriptionEndpoint,
  transcriptionModel,
  recogniserLanguage,
  localCommand,
  transcriptionBody,
} from "../core/dictation/dictation.js";
import { checkCredentials, normalizeBaseUrl } from "../core/providers/credentials.js";
import { callSignature, safeArgs } from "../core/agent/callSignature.js";
import { knowledgeAmbient } from "./knowledge.js";
import { language, t } from "../shared/i18n.js";
import { runTurn, type Tool } from "../core/agent/loop.js";
import { Permissions, commandPrefix, type PermissionStore, type Rule } from "../core/agent/permissions.js";
import { stablePrompt, turnDirectives } from "../core/prompts.js";
import { costOf, estimateCost, makeLookup, type Price } from "../core/router/pricing.js";
import { calibrate, observe, prune, type Calibration } from "../core/util/calibrate.js";
import { acceptsImages, IMAGE_TOKENS } from "../core/models/vision.js";
import { checkEndpoint } from "../core/providers/endpoint.js";
import { handoverNote, selfCheckMessage, verifyTurn, type TurnStep } from "../core/router/outcome.js";
import { unifiedDiff } from "../core/text/diff.js";
import { escalationTarget, route, type Route } from "../core/router/route.js";
import { describeFallback, fallbackChain, isRetryable } from "../core/router/fallback.js";
import type { Provider } from "../core/providers/index.js";
import { Session, renderEntry, type ContextItem, type Entry, type SessionData } from "../core/session/session.js";
import { headToTokens } from "../core/util/tokens.js";
import { matchesName } from "../core/ibmi/sql.js";
import { arcadInstalled } from "./integrations/arcad.js";
import {
  collectMemberContext,
  ibmiAllLibraries,
  ibmiAllMembers,
  ibmiEnabled,
  ibmiInstance,
  ibmiLibraryList,
  readMemberText,
  readStreamFileText,
} from "./integrations/ibmi.js";
import { filterHistory, searchTranscript, upsertSession } from "../core/session/history.js";
import { compactBrief, digestEntries, sessionAsContext, shouldSuggestCompact } from "../core/session/digest.js";
import {
  ALWAYS_ON,
  BUILTIN_SKILLS,
  builtinSkillsForModel,
  familiesInPlay,
  isSkillEnabled,
  normalizeGroups,
  SKILL_GROUPS,
  skillInvocation,
  toggleSkill,
  type SkillGroup,
} from "../core/session/skills.js";
import { capture, describeRestore, trimCheckpoints } from "../core/session/checkpoint.js";
import type { Plan } from "../core/agent/plan.js";
import { promptForMode, toolsForMode } from "../core/session/modes.js";
import { Hooks } from "./hooks.js";
import { policyState } from "./policy.js";
import {
  DEFAULT_TRIGGERS,
  describeOpinion,
  needsSecondOpinion,
  parseObjections,
  secondOpinionPrompt,
} from "../core/review/second.js";
import type { Corpus } from "./corpus.js";
import type { LearnedRouting } from "./learned.js";
import type { Episode } from "../core/corpus/corpus.js";
import { detectIbmiLanguage, ibmiPrompt } from "../core/ibmi/languages.js";
import { hiveyLabel, hiveyModel, isHivey } from "../core/router/hivey.js";
import { parsePrompt, participantDirective, type MentionKind, type Participant } from "../core/session/mentions.js";
import { resolveMentions } from "./mentions.js";
import { instructionFiles, instructionsPrompt } from "./instructions.js";
import { buildDefinitionTools, createDefinition, definitionUri, DefinitionStore, type SubAgentRun } from "./definitions.js";
import { skillsPrompt } from "../core/agent/definitions.js";
import { autoApprove } from "../core/agent/autoApprove.js";
import { matchGlob } from "../core/util/glob.js";
import { discoverLocal, rankModels, suggestPull } from "../core/providers/discover.js";
import { endpointSettingKey, REMOTE_VENDORS, vendor, type ProviderId } from "../core/providers/vendors.js";
import { request } from "../core/util/http.js";
import { estimateTokens } from "../core/util/tokens.js";
import { isLocalEndpoint, streamingRestorer, Vault } from "../core/redaction/index.js";
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
  UiApproval,
} from "../shared/protocol.js";
import { findRecorder, installWhisper, installedWhisper, recordArgv, recorderAdvice, runWhisper, startRecording } from "./whisper.js";
import { modelFor, whisperAsset } from "../core/dictation/local.js";
import { SECTION, endpointFor, providerFor, readSettings, routerConfig, type Keys, type Settings, writeTarget } from "./config.js";
import { EgressGate, safeHost, summarize } from "./egress.js";
import { renderPromptAudit, type PromptAudit } from "../core/audit/prompt.js";
import { youShouldKnow, type Notice } from "../core/session/notices.js";
import { MUTATING_TOOLS, VERIFIER_TOOLS } from "../core/router/outcome.js";
import { effortToSend, promptedThinking, splitThinkingText, thinkingMode, thinkingSplitter } from "../core/router/thinking.js";
import { planVerdict } from "../core/agent/plan.js";
import { contextWindow, labelFor, listModels, openFiles, openFileUris, ownModelIds, supportsReasoning } from "./models.js";
import { servedSetChanged } from "../core/models/watch.js";
import { billsTheUser } from "../core/router/billing.js";
import { attachmentTokens } from "./budgets.js";
import { loadPrices } from "./prices.js";
import { contextBudget, repoMapBudget } from "../core/context/budget.js";
import { perFileBudget } from "../core/util/tokens.js";
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
  // Built from the vendor table rather than copied out of it: a card whose "Get a key" button is
  // not on this list is a button that does nothing, and it would be found by a user, not by us.
  ...REMOTE_VENDORS.map((v) => v.keysUrl).filter((u): u is string => Boolean(u)),
  "https://ollama.com/download",
];

const PREFS_KEY = "hiveyCode.prefs";
/** What each model's provider has actually been counting. See `core/util/calibrate.ts`. */
/**
 * The stored token calibration.
 *
 * The key carries a generation, and this is the second. Everything under the first was learned from
 * a measurement that compared our estimate WITHOUT the images against the provider's count WITH
 * them, so every request carrying a screenshot taught a ratio above 1 for a reason that had nothing
 * to do with tokenization, and the factor drifted upwards — inflating the estimate on the consent
 * card and the figure the spending cap is checked against. Keeping that table would mean carrying
 * the error for another ten requests. Bad measurements are discarded, not averaged out.
 */
const CALIBRATION_KEY = "hiveyCode.tokenCalibration.v2";
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

/**
 * The tools whose presence means a turn was VERIFIED.
 *
 * A turn that ran no check is neither a success nor a failure, and recording it as either would
 * teach the learned router from nothing — which is how a model with a perfect record turns out to
 * have answered twenty questions nobody checked.
 */
// ⚠️ This was a second copy of `VERIFIERS` from `core/router/outcome.ts` — the same five names, in
// two files, with nothing keeping them in step. Adding a verifier to the router would have silently
// stopped the panel counting it, and the learned routing would have gone on measuring the old set.
// One source, imported.

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

  /**
   * The same questions, in a form the panel can DRAW — and redraw.
   *
   * The map above holds what to do with an answer; this holds what the question looks like. Kept
   * because a card that exists only as a message the panel has already consumed cannot survive a
   * rebuild, and a lost card is a turn that waits for ever on a request that has already been paid
   * for. Every path that adds to one of these adds to both, and every path that resolves removes
   * from both — see `ask`.
   */
  private pendingApprovals: UiApproval[] = [];

  /**
   * Post a question, draw it from the state, and clean up however it is answered.
   *
   * One function for all three kinds — a tool asking permission, consent to send, an edit to
   * review — because the thing that went wrong was bookkeeping, and three copies of bookkeeping is
   * three chances to forget the line that removes the card.
   */
  private askInPanel(
    request: UiApproval,
    decide: (answer: "once" | "session" | "always" | "no") => void,
    onAbort?: () => void,
  ): void {
    this.pendingApprovals = [...this.pendingApprovals, request];
    this.approvals.set(request.id, (answer) => {
      this.forgetApproval(request.id);
      decide(answer);
      // ⚠️ The panel is told the question is gone. Without this, the card stayed on screen marked
      // "Allowed once." and "Waiting for your answer above" sat under the composer for the rest of
      // the session — reported exactly so. It had always been true and never visible, because every
      // approval used to happen inside a TURN, and the turn's next step sent the state a moment
      // later. The first approval asked outside a turn — may I install a recorder? — had nothing
      // following it, and the residue became the whole of what you could see.
      this.sendState();
    });
    this.sendState();
    // A turn that is cancelled must not leave a promise hanging for ever, nor a card on screen for
    // a question nobody is waiting on.
    this.turn?.signal.addEventListener("abort", () => {
      if (!this.approvals.delete(request.id)) return;
      this.forgetApproval(request.id);
      onAbort?.();
      this.sendState();
    });
  }

  private forgetApproval(id: string): void {
    this.approvals.delete(id);
    this.pendingApprovals = this.pendingApprovals.filter((a) => a.id !== id);
  }
  private readonly priceLookup = makeLookup(loadPrices());

  /**
   * What each model's provider counts, against what this extension estimated.
   *
   * Global rather than per-workspace: a tokenizer is a property of the model, not of the project,
   * and a user who opens a second repository should not start from zero.
   */
  private calibration: Calibration = {};

  /** One measurement, folded in and persisted only when it actually moved the number. */
  private noteUsage(info: { model: string; estimated: number; actual: number }): void {
    const next = observe(this.calibration, info.model, { estimated: info.estimated, actual: info.actual });
    if (next === this.calibration) return;
    this.calibration = prune(next);
    void this.ctx.globalState.update(CALIBRATION_KEY, this.calibration);
  }

  /**
   * How much of the conversation may reach the model this turn.
   *
   * The user's figure when they set one, otherwise derived from the window of the model actually
   * selected — see `core/context/budget.ts` for why a flat 8000 was destroying answers rather than
   * saving money.
   */
  private budgetTokensFor(s: Settings): number {
    // The answer budget is passed in, because the reserve has to hold whatever this user actually
    // asks the model to write back: somebody who raised `chat.maxOutputTokens` has made the reply
    // bigger, and a reserve computed from a default would be short by exactly that much.
    return contextBudget(s.context.maxTokens, this.modelWindow(s), s.chat.maxOutputTokens);
  }

  /**
   * "For this conversation" on the spending card.
   *
   * A cap is a habit; a piece of work is an exception. Someone in the middle of something expensive
   * should not have to answer the same question at every turn, nor permanently move a limit they
   * chose on purpose. Held in memory and cleared with the conversation, which is exactly as long as
   * the exception is meant to last.
   */
  private budgetWaived = false;

  /**
   * What one attached file may take of it — counting the ones already attached.
   *
   * The count is what was missing. Each file used to be cut to a share of the budget computed as
   * though it were the only one, so attaching a second doubled the context and a third trebled it,
   * with nothing putting it right before the request was priced.
   */
  private perFileTokens(adding = 1): number {
    const settings = readSettings();
    return attachmentTokens(settings, this.attachments.length + adding, this.modelWindow(settings));
  }

  /** The selected model's own window, 0 when nothing knows it. */
  private modelWindow(s: Settings): number {
    const id = hiveyModel(s.chat.model, "everyday");
    // The live list first, because a provider serving its own build of a model knows its window
    // better than a catalogue does — then the catalogue, because the live list is fetched, fails
    // silently, and is simply absent for the first seconds of every window. Falling through to zero
    // sends the budget back to its floor, and the only visible effect of that is an attachment cut
    // to a fraction of what the model could have read.
    return this.models.find((m) => m.id === id)?.context || contextWindow(id);
  }

  /** An estimate corrected by what this model has been measured to do. */
  private tokensFor(model: string, estimated: number): number {
    return calibrate(this.calibration, model, estimated);
  }

  /**
   * "Always" on the spending card: move the cap that refused, far enough that it stops asking.
   *
   * Twice the request that tripped it, rounded up, and never downwards — the user answered a
   * question about one request, and the honest reading of "always" is a ceiling that this kind of
   * request fits under rather than one glued to this exact figure. Written globally: a spending
   * limit is a fact about the person paying, not about the folder that happens to be open.
   */
  private async raiseBudget(
    reason: "per-request" | "per-request-size" | "daily",
    estimateUsd: number,
    promptTokens?: number,
  ): Promise<void> {
    const config = vscode.workspace.getConfiguration(SECTION);
    // A size refusal raises the SIZE ceiling. Raising a dollar cap because somebody accepted a very
    // large request would answer a question nobody asked, and would leave the ceiling that actually
    // stopped them exactly where it was — so the next identical request asks again.
    if (reason === "per-request-size") {
      const current = config.get<number>("budget.perRequestTokens", 0);
      const next = Math.max(current, Math.ceil(((promptTokens ?? 0) * 2) / 1000) * 1000);
      if (next === current) return;
      await config.update("budget.perRequestTokens", next, vscode.ConfigurationTarget.Global);
      this.post({ type: "status", text: t("Size ceiling raised to {0} tokens.", next.toLocaleString()) });
      return;
    }
    const key = reason === "per-request" ? "budget.perRequestUsd" : "budget.dailyUsd";
    const current = config.get<number>(key, 0);
    const floor = reason === "per-request" ? estimateUsd : this.gate.budget.spentToday() + estimateUsd;
    const next = Math.max(current, Math.ceil(floor * 2 * 100) / 100);
    if (next === current) return;
    await config.update(key, next, vscode.ConfigurationTarget.Global);
    this.post({ type: "status", text: t("Cap raised to ${0}.", next.toFixed(2)) });
  }
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
    this.calibration = ctx.globalState.get<Calibration>(CALIBRATION_KEY) ?? {};
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
    const providers = REMOTE_VENDORS.map((v) => v.id);
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
      if (!view.visible) return;
      this.view = view;
      // Coming back to the panel is the likeliest moment for the list to be stale: pulling a model
      // happens in a terminal, which means somewhere else.
      void this.checkOwnModels();
    });
    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.ctx.extensionUri, "media")],
    };
    view.webview.html = this.html(view.webview);
    // One timer for the whole provider, however many copies of the panel are resolved. It does
    // nothing while every copy is hidden and nothing while a turn is running; two minutes is slow
    // enough to be invisible in a proxy's access log and fast enough that a model pulled during a
    // build is there by the time anybody looks.
    if (!this.watchingOwnModels) {
      this.watchingOwnModels = true;
      const timer = setInterval(() => void this.checkOwnModels(), 120_000);
      this.ctx.subscriptions.push(new vscode.Disposable(() => clearInterval(timer)));
    }
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
<html lang="${language()}" data-appearance="${readSettings().appearance}">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="${uri("style.css")}">
<title>Hivey Code</title>
</head>
<!-- ⚠️⚠️ NO style ATTRIBUTE HERE, and that is the fix rather than an omission.
     The floor below which the panel scrolls sideways instead of rearranging itself used to be written
     as a min-width style attribute on this very element — which is precisely what style-src without
     'unsafe-inline' forbids, and the CSP above has no 'unsafe-inline' on purpose, because a model's
     output is rendered in this document. So the floor was declared in the one place this document's
     own security policy guarantees will be thrown away, and for a whole release dragging the side bar
     narrow did nothing: reported twice, and invisible to every test because the markup was exactly
     right. It travels in the state now (panelMinWidth) and the page applies it as a style PROPERTY,
     which the same policy allows. See src/webview/main.ts. -->
<body>
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
      ...(e.id === this.streamingEntryId ? { streaming: true } : {}),
      ...(e.usage ? { usage: e.usage } : {}),
      ...(e.checkpoint?.length ? { checkpointFiles: e.checkpoint.length } : {}),
      ...(e.checkpointPartial ? { checkpointPartial: true } : {}),
      ...(e.checkpointCommands ? { checkpointCommands: e.checkpointCommands } : {}),
      ...(e.plan ? { plan: e.plan } : {}),
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
    const implicit = this.workspace.activeContext(this.perFileTokens(), s);
    const contextTokens = this.contextTokens();
    const budgetTokens = this.budgetTokensFor(s);

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
      // A preset is not a model, so everything the panel wants to know about "the model" has to be
      // asked of the one that would answer an ordinary turn — its window, whether it thinks, what
      // it costs. The NAME stays the preset's: that is what the user chose and what they can act on.
      reasoningAvailable: supportsReasoning(hiveyModel(s.chat.model, "everyday")),
      model: s.chat.model,
      modelLabel: isHivey(s.chat.model)
        ? hiveyLabel(s.chat.model)
        : this.models.length
          ? labelFor(this.models, s.chat.model)
          : s.chat.model,
      // WHERE THE REQUEST ACTUALLY GOES, not what the setting says.
      //
      // A Hivey preset is a routing over OpenRouter's catalogue, so `route()` sends it to OpenRouter
      // before it ever looks at `chat.provider`. The panel was reporting the setting — so somebody
      // who stored an OpenAI key, chose OpenAI in the composer and kept a preset as their model saw
      // "OpenAI" while every request went to OpenRouter, against the OpenRouter balance. When that
      // balance ran out the error said to top up an account they had not chosen to use, and nothing
      // on screen connected the two.
      provider: isHivey(s.chat.model) ? "openrouter" : s.chat.provider,
      // A preset is served from the catalogue, so it is remote whatever the provider setting still
      // says. Getting this wrong would not merely mislabel a row: this flag is what the empty
      // conversation reads to promise that nothing leaves the machine.
      // Where the answer comes from. NOT whether it costs anything — those were the same field for
      // two releases and a gateway broke both of them at once.
      remote: isHivey(s.chat.model) || !isLocalEndpoint(baseUrl),
      billed: isHivey(s.chat.model) || billsTheUser(s.chat.provider),
      contextTokens,
      ...(this.contextParts().length ? { contextParts: this.contextParts() } : {}),
      sentTokens: this.session.plannedTokens(budgetTokens),
      contextBudget: budgetTokens,
      contextBudgetAuto: !(typeof s.context.maxTokens === "number" && s.context.maxTokens > 0),
      // The window the chosen model actually has, straight from the catalogue. Zero when it is not
      // known — a local runtime that reports no such number, most often — and the panel then offers
      // fixed steps instead of pretending to know a ceiling.
      modelContext: this.modelWindow(s),
      contextFill: budgetTokens > 0 ? Math.min(1, contextTokens / budgetTokens) : 0,
      ...(this.cacheSeen.prompt > 0 ? { cacheHitRate: this.cacheSeen.cached / this.cacheSeen.prompt } : {}),
      // Computed here rather than in the panel because the budget is a setting, and a panel that
      // guessed at it would offer to summarize a conversation that fits comfortably.
      // No offer when it happens by itself: a banner proposing what is already scheduled to
      // happen at that exact threshold is a question with one answer.
      suggestCompact:
        shouldSuggestCompact(contextTokens, budgetTokens, this.session.entries.filter((e) => e.included).length),
      busy: this.turn !== undefined,
      appearance: s.appearance,
      panelMinWidth: Math.max(0, Math.round(s.panel.minWidth)),
      // Only when there is somewhere to transcribe. See `core/dictation/dictation.ts`.
      ...(() => {
        const here = Boolean(installedWhisper(this.ctx.globalStorageUri.fsPath, process.platform, s.dictation.localModel));
        const mode = dictationMode(s.dictation, s.chat.provider, here);
        const offerable = Boolean(whisperAsset({ platform: process.platform, arch: process.arch }));
        return {
          // The button exists wherever dictation can be MADE to work, not only where it already does:
          // the one thing it can always do is offer to install a transcriber.
          ...(mode === "off" && !offerable ? {} : { dictation: true }),
          ...(mode === "whisper" || (mode === "off" && offerable) ? { dictationWav: true } : {}),
        };
      })(),
      budget: { spentTodayUsd: this.gate.budget.spentToday(), dailyUsd: s.budget.dailyUsd },
      sessionCostUsd: this.session.totalCostUsd(),
      pendingApprovals: this.pendingApprovals,
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
      // An image costs what an image costs, not what the sentence describing it costs. Counting the
      // label would tell the user an attachment is worth twelve tokens when it is worth a thousand.
      attachments: this.attachments.map((c) => ({
        kind: c.kind,
        label: c.label,
        tokens: c.image ? IMAGE_TOKENS : estimateTokens(c.body),
        ...(c.note
          ? { detail: c.note }
          : c.image
            ? { detail: c.body.replace(/^\[[^:]*:\s*/, "").replace(/\]$/, "") }
            : {}),
      })),
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
    // Opening the list is the moment being out of date actually costs something.
    else if (screen === "models") void this.checkOwnModels();
  }

  /**
   * Switch mode from outside the panel.
   *
   * It existed only as a click on the composer's own menu, which had two costs. The palette and a
   * keybinding could not reach it — and neither could the integration suite, so PLAN MODE WAS NEVER
   * EXERCISED BY A TEST. A mode that changes the system prompt and the whole tool set, with no test
   * that runs a turn in it, is a mode that breaks quietly.
   */
  setMode(mode: Mode): void {
    this.session.mode = mode;
    this.savePrefs();
    this.sendState();
  }

  /** Rebuild the model list. Used when a setting the list depends on changes under it. */
  reloadModels(): void {
    void this.loadModels();
  }

  newSession(): void {
    this.wizard = undefined;
    this.persist();
    const mode = this.session.mode;
    this.session = new Session();
    this.session.mode = mode;
    // The prefix is being rewritten from nothing anyway, so this is the free moment to take a fresh
    // map. See `frozenMap`.
    this.frozenMap = undefined;
    this.cacheSeen = { prompt: 0, cached: 0 };
    this.attachments = [];
    this.screen = "chat";
    this.searchQuery = "";
    // A new conversation starts cautious again: session-wide permissions do not carry over, and
    // neither does a spending exception that was granted for a particular piece of work.
    this.permissions.clearSession();
    this.budgetWaived = false;
    this.sendState();
  }

  /**
   * Those waiting for the current turn's answer. Resolved with the text the model produced.
   *
   * There is exactly one caller — the branch review, which has to PARSE the answer — and it goes
   * through the chat view rather than its own request path because that is where the model, the
   * budget, the egress gate and the transcript are. A review with its own path out would be a
   * second place a request can leave the machine, and this product has one.
   */
  private waiting: Array<(answer: string) => void> = [];

  /**
   * The episode being assembled across an escalation, when the corpus is on.
   *
   * It spans two turns — the local attempt and the remote one — and it is kept only if the second
   * verifies green. Held for exactly one turn: carrying it further would attach a diff nobody can
   * attribute to the question that produced it.
   */
  private pendingEpisode: Episode | undefined;

  /** Set by `activate` when the learning corpus is available. Absent means nothing is recorded. */
  corpus: Corpus | undefined;

  /** Set by `activate`. Absent means the turn uses exactly the model the user configured. */
  learnedRouting: LearnedRouting | undefined;

  /** Ask, and resolve with what came back. Empty when the turn produced nothing. */
  async askAndWait(text: string, context?: ContextItem): Promise<string> {
    const answer = new Promise<string>((resolve) => this.waiting.push(resolve));
    await this.focusWithPrompt(text, context);
    return answer;
  }

  /** Called wherever a turn ends, including when it failed or was stopped. */
  private settle(): void {
    if (!this.waiting.length) return;
    const latest = [...this.session.entries].reverse().find((e) => e.role === "assistant");
    const text = latest?.text ?? "";
    const waiting = this.waiting;
    this.waiting = [];
    for (const resolve of waiting) resolve(text);
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
          // What is already configured, read every time the panel comes up.
          //
          // This used to run only on a first run or when nothing could answer, so an established
          // user's `hasKey` stayed empty for the whole session — and the composer, which asks it
          // whether a provider is set up, called a key that was sitting in the keychain "not set
          // up". The setup screen was right because opening it refreshed this; the panel beside it
          // was wrong because nothing ever did. Three keychain reads is not a cost worth being
          // wrong over.
          await this.refreshSetup();
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
          this.stopTurn();
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
          if (found) {
            this.session = new Session(found);
            this.frozenMap = undefined;
          }
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
            maxTokens: Math.floor(this.budgetTokensFor(readSettings()) * 0.25),
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
              normalizeGroups(this.wizard.families),
              vscode.ConfigurationTarget.Global,
            );
            this.wizard.step = "skills";
          } else {
            // The skills step sends what is TICKED. Everything offered and not ticked is switched
            // off — which is only correct because the offer was limited to the chosen families.
            const on = new Set(m.value);
            const offered = BUILTIN_SKILLS.filter(
              (sk) => normalizeGroups(this.wizard!.families).includes(sk.group) && !ALWAYS_ON.has(sk.name),
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
            normalizeGroups(m.groups as SkillGroup[]),
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
          const uri = definitionUri(m.source);
          if (uri) await vscode.window.showTextDocument(uri);
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
          // A preset decides its own route, so setting the provider under one changes nothing at
          // all — the setting is written, the panel shows it, and every request still goes to
          // OpenRouter. Saying so and offering the way out is the difference between a control that
          // does nothing and a control that explains itself.
          if (isHivey(readSettings().chat.model) && m.provider !== "openrouter") {
            const pick = t("Choose a model");
            const keep = t("Keep the preset");
            const answer = await vscode.window.showWarningMessage(
              t(
                "{0} is a Hivey preset: it always answers through OpenRouter and bills your OpenRouter account. Choosing {1} will not change that until you pick one of its models.",
                hiveyLabel(readSettings().chat.model),
                m.provider,
              ),
              pick,
              keep,
            );
            if (answer === pick) {
              await config.update("chat.provider", m.provider, writeTarget());
              this.openModelPicker();
              break;
            }
            if (answer !== keep) break;
          }
          await config.update("chat.provider", m.provider, writeTarget());
          await this.refreshSetup();
          void this.loadModels(true);
          this.sendState();
          break;
        }
        case "restoreCheckpoint":
          await this.restoreCheckpoint(m.id);
          break;
        case "dictate":
          await this.transcribe(m.audio, m.ms);
          break;
        case "startDictation":
          await this.startDictation();
          break;
        case "stopDictation":
          await this.stopDictation(Boolean(m.cancel));
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
        case "setContextBudget": {
          const config = vscode.workspace.getConfiguration(SECTION);
          await config.update("context.maxTokens", m.tokens, writeTarget());
          this.sendState();
          break;
        }
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
        case "pollModels":
          await this.checkOwnModels();
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
        case "askAgain": {
          const entry = this.session.get(m.id);
          if (!entry || entry.role !== "user") break;
          // The attachments it was asked with, not whatever is attached now. Asking the same
          // question against different context is not asking the same question.
          this.attachments = [...(entry.context ?? [])];
          await this.ask(entry.text);
          break;
        }
        case "compareEntry": {
          const entry = this.session.get(m.id);
          if (!entry || entry.role !== "user") break;
          await this.compareAcrossModels(entry, entry.context ?? []);
          break;
        }
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
          const item = await this.workspace.fileContext(uri, readSettings(), this.perFileTokens());
          if (item) {
            this.attachments.push(item);
            this.remember(m.path);
          } else {
            void vscode.window.showWarningMessage(t("{0} could not be attached.", m.path));
          }
          this.sendState();
          break;
        }
        case "pasteContext": {
          const item = pastedContext(m, this.perFileTokens());
          if (!item) {
            void vscode.window.showWarningMessage(t("Nothing usable was pasted."));
            break;
          }
          // Said once, at the moment of the gesture, rather than buried in a settings page. A model
          // that cannot see the image will not say so — it answers about an image nobody looked at —
          // and the person pasting is the only one who can choose a different model.
          if (item.image) {
            const settings = readSettings();
            if (!acceptsImages(settings.chat.model)) {
              void vscode.window.showWarningMessage(
                t("{0} does not read images. It is attached, but the answer will be about the text alone.", settings.chat.model),
              );
            }
          }
          this.attachments = this.attachments.filter((a) => a.label !== item.label);
          this.attachments.push(item);
          this.sendState();
          break;
        }
        case "setImplicit":
          // Remembered by LABEL rather than as a flag. Dismissing means "not this file", and the
          // suggestion should come back when a different file is opened — which is what the editor's
          // own chat does, and what stops a single dismissal switching the feature off for ever.
          this.implicitDismissed = m.on ? undefined : this.workspace.activeContext(this.perFileTokens(), readSettings())?.label;
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

        case "saveProvider": {
          // Both, or neither. See the protocol note: two separate saves is two chances to leave half
          // a configuration behind, and a key stored against no address looks configured.
          const provider = m.provider as ProviderId;
          let baseUrl = vendor(provider)?.baseUrl ?? "";
          if (m.url !== undefined && m.url.trim()) {
            const checked = checkEndpoint(m.url);
            if (!checked.url) {
              void vscode.window.showWarningMessage(checked.problem ?? t("That address cannot be used."));
              break;
            }
            baseUrl = checked.url;
          }
          // Checked before anything is written. A credential that is known to work is a different
          // thing from one that has been written down, and one GET costs no tokens.
          const check = await vscode.window.withProgress(
            { location: vscode.ProgressLocation.Notification, title: t("Checking the key against {0}…", baseUrl) },
            () =>
              checkCredentials(
                { wire: vendor(provider)?.wire ?? "openai", label: vendor(provider)?.label ?? provider },
                baseUrl,
                m.key,
                fetch,
              ),
          );
          if (!check.ok) {
            const anyway = t("Store it anyway");
            const answer = await vscode.window.showWarningMessage(
              check.why,
              { modal: true, detail: t("Nothing has been saved yet.") },
              anyway,
            );
            if (answer !== anyway) break;
          }
          const config = vscode.workspace.getConfiguration(SECTION);
          if (m.url !== undefined && m.url.trim() && baseUrl !== vendor(provider)?.baseUrl) {
            await config.update(`endpoints.${vendor(provider)?.settingKey ?? provider}`, baseUrl, vscode.ConfigurationTarget.Global);
          }
          await this.keys.store(provider as Parameters<Keys["store"]>[0], m.key);
          // Storing a key is only half the intent: somebody who pastes an OpenRouter key wants to use
          // OpenRouter, and leaving the provider on `local` makes the key look ignored.
          await config.update("chat.provider", provider, vscode.ConfigurationTarget.Global);
          await this.refreshSetup();
          void this.loadModels(true);
          void vscode.window.showInformationMessage(
            check.ok
              ? t("{0} is ready. {1}", vendor(provider)?.label ?? provider, check.models ? t("{0} models available.", check.models) : t("The key works."))
              : t("{0} key stored, unverified.", vendor(provider)?.label ?? provider),
          );
          break;
        }

        case "clearKey": {
          await this.keys.delete(m.provider as Parameters<Keys["delete"]>[0]);
          await this.refreshSetup();
          break;
        }

        case "addServer": {
          // Completed rather than refused, like every other address in the product: somebody who
          // types `192.168.1.50:11434/v1` has said exactly one thing, and demanding they type the
          // scheme as well is the product making them do its work. Checked here rather than stored
          // and failed later, because an address that is not an address would sit in the settings
          // looking configured and probe nothing for ever.
          const checkedServer = checkEndpoint(m.url);
          if (!checkedServer.url) {
            void vscode.window.showWarningMessage(checkedServer.problem ?? t("That address cannot be used."));
            break;
          }
          const url = checkedServer.url;
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
          // The moment it is typed is the only moment the person who can fix it is looking. A host
          // with no scheme is completed rather than refused — `api.openai.com/v1` has exactly one
          // plausible reading — and anything else is rejected with its reason, here, instead of
          // becoming "Invalid URL" on every question from now on.
          const checked = checkEndpoint(m.url);
          // A key pasted into the address field is not a mistake to report, it is an intention to
          // carry out: the person meant to give this provider their key. Stored where keys go, and
          // said afterwards — see `recoverMisplacedKeys` for the same decision in the settings.
          if (checked.credential) {
            await this.keys.store(m.provider as ProviderId, m.url.trim());
            void vscode.window.showInformationMessage(t("That is a key, not an address — saved as the key."));
            await this.refreshSetup();
            void this.loadModels(true);
            break;
          }
          if (!checked.url) {
            void vscode.window.showWarningMessage(checked.problem ?? t("That address cannot be used."));
            break;
          }
          if (checked.repaired) {
            void vscode.window.showInformationMessage(t("Saved as {0}.", checked.url));
          }
          const config = vscode.workspace.getConfiguration(SECTION);
          // The manifest spells `openai-compatible` differently from the provider id, because a
          // hyphen is not a legal settings key segment. The vendor table owns that translation.
          const provider = m.provider as ProviderId;
          const key = endpointSettingKey(provider);
          await config.update(key, checked.url, vscode.ConfigurationTarget.Global);

          // Typing a gateway's address IS choosing the gateway.
          //
          // Saving a key switched the provider — "somebody who pastes an OpenRouter key wants to use
          // OpenRouter" — and saving an address did not. Which left the one vendor that may need no
          // key at all with no way to be selected: the user filled in their proxy's address, the
          // composer went on saying "Local", and the models the proxy serves never appeared. "When I
          // click on gateway it shows local."
          //
          // Only for a vendor whose address has no default. Editing OpenAI's base URL for an Azure
          // deployment is a change of address, not a change of mind about which provider to use.
          if (vendor(provider)?.needsUrl && readSettings().chat.provider !== provider) {
            await config.update("chat.provider", provider, vscode.ConfigurationTarget.Global);
            void this.loadModels(true);
          }
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
          // Filtered to one key when the panel named one. Dropping somebody into forty settings
          // after telling them to change one is handing them a search task, not an answer.
          await vscode.commands.executeCommand("workbench.action.openSettings", m.key ?? SECTION);
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
      // Recorded, not just posted — the same lesson as the turn's own failure path. A message is
      // consumed by the panel and destroyed by the next rebuild, so anything that went wrong while
      // handling what the user did (attaching a file, switching model, restoring a checkpoint)
      // showed for a fraction of a second and then never existed. An error nobody can read is an
      // error nobody can report.
      const message = (err as Error).message;
      this.log.appendLine(`[chat] ${(err as Error).stack ?? message}`);
      if (this.session.entries.length) this.session.add({ role: "assistant", text: "", model: "" }).error = message;
      this.post({ type: "error", message });
      this.sendState();
    }
  }

  private async attach(what: "active" | "editor" | "selection" | "browse" | "openFiles" | "mention"): Promise<void> {
    const settings = readSettings();
    switch (what) {
      case "active":
      case "selection": {
        const item = this.workspace.activeContext(this.perFileTokens());
        if (item) this.attachments.push(item);
        break;
      }
      case "editor": {
        // The whole file, whatever is selected. `active` hands back the selection when there is
        // one, so with three lines highlighted there was no way to attach the file they are in —
        // which is the case where you most want to.
        const item = this.workspace.activeFileContext(this.perFileTokens());
        if (item) this.attachments.push(item);
        break;
      }
      case "browse": {
        const picked = await vscode.window.showOpenDialog({ canSelectMany: true, openLabel: "Joindre" });
        for (const uri of picked ?? []) {
          const item = await this.workspace.fileContext(uri, settings, this.perFileTokens());
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
          const item = await this.workspace.fileContext(uri, settings, this.perFileTokens());
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

  /**
   * What the user's own sources were serving when we last looked. See `ownModelIds`.
   *
   * `undefined` until the first look, which is not the same as "nothing there": treating the first
   * observation as a change would rebuild the list once for no reason on every window.
   */
  private ownSeen: string[] | undefined;
  /** One timer for the provider, not one per resolved view. */
  private watchingOwnModels = false;

  /**
   * Notice a model appearing on a machine the user controls.
   *
   * `ollama pull` is a thing people do WHILE the editor is open, and so is adding a model to an
   * internal proxy. The list was fetched once when the panel woke up and then only when somebody
   * pressed Refresh — a button nobody presses, because nobody knows the list is stale until they
   * have failed to find what they just installed.
   *
   * Only the user's own sources are probed, and only while the panel is on screen. The vendors are
   * left alone: those are calls against an account with a rate limit, and their catalogues change a
   * few times a year rather than a few times an afternoon. The probe is cheap because it is against
   * loopback or a machine on the same network, and it is silent because it does nothing at all
   * unless the answer has changed — in which case the list is rebuilt the proper way, so the result
   * is exactly what pressing Refresh would have given.
   */
  private async checkOwnModels(): Promise<void> {
    if (this.turn) return; // A running turn has better uses for the socket and the attention.
    if (![...this.views].some((v) => v.visible)) return;
    let now: string[];
    try {
      now = await ownModelIds(readSettings(), this.keys);
    } catch {
      return; // A server that is down is not news. It will be there, or not, next time.
    }
    const changed = servedSetChanged(this.ownSeen, now);
    this.ownSeen = now;
    if (changed) await this.loadModels();
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
    // Not into the transcript.
    //
    // `status` is the channel a RUNNING turn reports through — "read src/app.ts", "ran the tests" —
    // and the panel gives anything arriving on it a live turn to sit in. So refreshing the
    // catalogue, which is housekeeping nobody asked for in the conversation, made the panel draw an
    // assistant turn that said "413 models" and appeared to be thinking. The count belongs where
    // the editor puts background news, and only when the refresh was actually requested.
    if (force) void vscode.window.setStatusBarMessage(t("Hivey Code: {0} models", this.models.length), 4000);
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
   * pseudonymized on exactly the same path.
   *
   * The sub-agent sees only the task it was given. That is the point of one: it starts on a clean
   * context, so a long conversation does not have to be re-read to answer a small question.
   */
  /**
   * What the context is made of, for the bar.
   *
   * Only what is knowable WITHOUT assembling a request. The conversation and the attachments are in
   * hand; the instructions and the repository map are not — they are built during a turn, and
   * rebuilding them on every state post would spend real work to redraw a bar. So their sizes are
   * remembered from the last turn, and **left out entirely before the first one**: a bar that showed
   * "instructions" before anything had been assembled would be showing a number nobody measured.
   *
   * The arithmetic and the rules — the floor under which parts merge, free space never negative, no
   * share invented when the window is unknown — are in `core/context/breakdown.ts` with their tests.
   */
  private contextParts(): Array<{ label: string; tokens: number }> {
    const parts: Array<{ label: string; tokens: number }> = [];
    if (this.lastPromptTokens) parts.push({ label: t("instructions"), tokens: this.lastPromptTokens });
    if (this.lastAmbientTokens) parts.push({ label: t("repository map"), tokens: this.lastAmbientTokens });

    let conversation = 0;
    for (const entry of this.session.entries) {
      if (!entry.included || entry.error) continue;
      conversation += estimateTokens(entry.text);
      for (const item of entry.context ?? []) {
        parts.push({ label: item.label, tokens: item.image ? IMAGE_TOKENS : estimateTokens(item.body) });
      }
    }
    if (conversation > 0) parts.push({ label: t("the conversation"), tokens: conversation });
    return parts;
  }

  /**
   * The last request, for the audit. In memory, never on disk, cleared with the session.
   *
   * Not in the ledger: that file keeps metadata and only metadata, by design. See
   * `core/audit/prompt.ts` for the three rules this holds to.
   */
  private lastAudit: PromptAudit | undefined;

  /**
   * The last request, rendered — or nothing, when none has been sent in this session.
   *
   * Returns the text rather than opening a document: the panel does not own the editor, and a method
   * that renders is one a test can call.
   */
  auditLastPrompt(): string | undefined {
    return this.lastAudit ? renderPromptAudit(this.lastAudit) : undefined;
  }

  /** Measured during a turn, because that is the only moment they are assembled. */
  private lastPromptTokens: number | undefined;
  private lastAmbientTokens: number | undefined;

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
      maxSteps: definition.maxSteps ?? DEFAULT_AGENT_STEPS,
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
      restoreArgs: (text) => env.vault.restore(text),
      report: (message) => run.report(`${definition.name}: ${message}`),
      onUsage: (info) => this.noteUsage(info),
    });

    // A sub-agent is a full turn — up to eight steps on a paid model — and its cost was recorded
    // nowhere: not against the budget that is supposed to be able to refuse it, not in the ledger
    // that claims to hold every request that left this machine, not in the total the panel shows.
    // Money left and nothing counted it, which is the one kind of accounting error that cannot be
    // argued about.
    if (!env.isLocal) {
      const cost = costOf(result.usage, this.priceLookup(model));
      this.delegatedCostUsd += cost.usd;
      this.gate.record(
        {
          at: Date.now(),
          provider: env.providerId,
          host: safeHost(env.baseUrl),
          model,
          promptTokens: result.usage.promptTokens,
          completionTokens: result.usage.completionTokens,
          cachedTokens: result.usage.cachedTokens,
          usd: cost.usd,
          redactions: 0,
          redactionSummary: `${t("sub-agent")}: ${definition.name}`,
        },
        env.settings,
      );
    }
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
    if (vendor(provider)?.needsUrl && !settings.endpoints[provider]) return true;
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
   * Pin or unpin the last answer, and say what it became.
   *
   * A command rather than only a button, for the reason "attach all open editors" became one: a
   * click handler inside a hover row is not something a test can press, so the only thing that
   * ever checked pinning was a person — twice, and both times what they reported was that it did
   * nothing. It does something; it now also says so out loud.
   */
  togglePinLastAnswer(): boolean | undefined {
    for (let i = this.session.entries.length - 1; i >= 0; i--) {
      const entry = this.session.entries[i]!;
      if (entry.role !== "assistant" || entry.error) continue;
      const pinned = !entry.pinned;
      this.session.setPinned(entry.id, pinned);
      this.persist();
      this.sendState();
      void vscode.window.setStatusBarMessage(
        pinned ? t("Answer pinned — it stays when the context is trimmed or summarized.") : t("Answer unpinned."),
        4000,
      );
      return pinned;
    }
    void vscode.window.showInformationMessage(t("There is no answer to pin yet."));
    return undefined;
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
   * Stop the answer.
   *
   * A method rather than two lines inside the message switch, and a command rather than only a
   * button, for the reason "attach all open editors" became one: what a button does cannot be
   * driven from a test, so the one thing anybody would want to check about a stop button — that
   * pressing it ends the turn — could not be checked at all.
   *
   * Returns whether there was something to stop, which is what makes it observable: a caller can
   * tell "stopped it" from "nothing was running", and those are the two states worth telling apart
   * when the complaint is that the button does nothing.
   */
  stopTurn(): boolean {
    const ctl = this.turn;
    if (!ctl) return false;
    ctl.abort();

    // The turn is over for the user NOW, not when the abort finishes travelling.
    //
    // Most of what a turn is doing can be cancelled in a millisecond. Some of it cannot: a query on
    // a partition, a REST call to a server that is thinking, a command someone else's API will
    // return from when it is ready. Waiting for those to notice is what makes a stop button feel
    // broken — the one thing this control cannot afford, because the reason people press it is that
    // something is already taking too long.
    //
    // So the panel is released here, and the rest unwinds on its own time. It cannot disturb what
    // comes next: every callback on the turn checks the signal before posting, and the cleanup only
    // runs if the turn it belongs to is still the current one.
    this.turn = undefined;
    this.settle();
    this.post({ type: "status", text: t("Stopped.") });
    this.post({ type: "turnEnd" });
    this.persist();
    this.sendState();
    return true;
  }

  /** True while a turn is running. */
  get busy(): boolean {
    return this.turn !== undefined;
  }

  /**
   * End a turn from a path that never reaches the block whose `finally` ends it.
   *
   * Guarded on identity, like that `finally`: a turn abandoned before it started must not clear a
   * turn that has since begun.
   */
  private endTurnEarly(ctl: AbortController): void {
    if (this.turn !== ctl) return;
    this.turn = undefined;
    this.settle();
    this.post({ type: "turnEnd" });
    this.sendState();
  }

  /** Whatever is highlighted in the editor, attached without a question asked about it. */
  async attachSelection(): Promise<void> {
    await this.reveal();
    await this.attach("selection");
  }

  /**
   * Compacting, asked for rather than offered.
   *
   * The machinery has been here since the offer banner was written, and the banner was the only way
   * to reach it: it appears at two thirds of the budget and nowhere else, so wanting the summary
   * earlier — or having dismissed the offer once — left `/compact` typed into the composer as the
   * only route. A feature reachable only by knowing its name is a feature most people do not have.
   */
  async compactConversation(): Promise<void> {
    await this.reveal();
    await this.compact();
  }

  /** What the conversation currently costs to re-send: the entries still in the prompt. */
  private contextTokens(): number {
    return this.session.entries
      .filter((e) => e.included)
      .reduce((sum, e) => sum + estimateTokens(e.text) + (e.context ?? []).reduce((a, c) => a + estimateTokens(c.body), 0), 0);
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
    // The families in play, not merely the chosen ones: a skill the open files switched on has to be
    // in this list, or the model is offered a skill the person cannot see and cannot type.
    const policy = { ...readSettings().skills, groups: this.familiesFor().groups };
    // Only the families in play. A picker listing seventy skills of which sixty belong to languages
    // this project does not contain is a picker nobody reads to the end.
    // A skill whose machinery is switched off is not offered: `/remember` with no knowledge base
    // would reach for tools that are not in the turn, and the model would explain that it cannot.
    const available = (sk: (typeof BUILTIN_SKILLS)[number]): boolean =>
      sk.needs !== "knowledge" || readSettings().knowledge.enabled;
    const builtins = BUILTIN_SKILLS.filter((sk) => policy.groups.includes(sk.group) && available(sk)).map((sk) => ({
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
  /**
   * The families in play for THIS conversation, decided once and then held.
   *
   * ⚠️ Memoised on the conversation's id on purpose, and the reason is the bill rather than tidiness.
   * This list is part of the cacheable prefix (`core/prompts.ts`): a prompt cache matches on a
   * prefix and misses on everything after the first byte that differs, so a skills list that changed
   * when the user clicked a different editor tab would throw away the whole prefix — repository map
   * included — on every turn. "Which skills exist" is allowed to live there precisely because it is
   * a fact about the conversation and not about the cursor.
   *
   * Which also means the automation's effect is felt at the START of a conversation. That is the
   * behaviour to describe, not a limitation to hide: open the files you are working on, then ask.
   */
  private familiesFor(): { groups: SkillGroup[]; fromOpenFiles: SkillGroup[] } {
    const settings = readSettings();
    if (this.families?.session !== this.session.id) {
      const { fromOpenFiles } = familiesInPlay(
        settings.skills.groups,
        openFiles().map((f) => f.language),
        settings.skills.auto,
      );
      this.families = { session: this.session.id, fromOpenFiles };
    }
    // Only the DETECTED half is frozen, because that is the half nobody asked for. The chosen list is
    // read fresh every time: the composer's skills button writes it, and a choice the user has just
    // made deliberately should take effect on the next message rather than the next conversation.
    const { fromOpenFiles } = this.families;
    return { groups: normalizeGroups([...settings.skills.groups, ...fromOpenFiles]), fromOpenFiles };
  }

  private families: { session: string; fromOpenFiles: SkillGroup[] } | undefined;

  private uiSkillGroups(): UiSkillGroup[] {
    const { groups, fromOpenFiles } = this.familiesFor();
    const active = new Set(groups);
    const suggested = new Set(fromOpenFiles);
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
    const policy = { groups: normalizeGroups(w.families), disabled: readSettings().skills.disabled };
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
      // A failure is part of the record. An export that quietly drops it is a record that lies by
      // omission — and it is the document somebody attaches when they report that nothing works.
      if (entry.error) lines.push(`> ${t("Failed")}: ${entry.error}`, "");
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
  /**
   * A source member, or several, chosen from lists.
   *
   * This was three menus deep — library, then source file, then member — and each step was a list
   * that could come back empty with a field underneath it. Three chances to end up typing a name by
   * hand, which is both the slowest way to do this and the one most likely to be wrong: the whole
   * point of being connected is that the names are already known over there.
   *
   * So: pick libraries, say what the name looks like, pick members. The source file stops being a
   * step and becomes part of what each row says, because nobody looking for a program thinks "it is
   * in QRPGLESRC" first — they think of its name. Libraries and members are both multi-select,
   * which is what makes two versions of the same component a single gesture.
   */
  private async pickMembers(withDependencies: boolean): Promise<void> {
    try {
      const libraries = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Window, title: t("Reading the libraries…") },
        () => ibmiAllLibraries(),
      );
      // The same filter as everywhere else, so `ARC*` finds ARCAD_ENG. The built-in one is fuzzy and
      // takes the star literally, which means the one syntax people reach for here matches nothing.
      const chosenLibraries = await this.pickFiltered(
        [
          ...libraries.map((l) => ({
            label: l.name,
            description: l.inList ? t("in your library list") : (l.text ?? ""),
          })),
          { label: "$(edit) " + t("Type library names…"), description: t("Separated by spaces or commas"), other: true },
        ],
        {
          placeHolder: libraries.length
            ? t("Which libraries? {0} on this system — {1} to filter", libraries.length, "ARC*")
            : t("No library could be listed — type the names"),
          many: true,
          nameOf: (row) => row.label,
        },
      );
      if (!chosenLibraries?.length) return;

      const names = chosenLibraries.filter((l) => !(l as { other?: boolean }).other).map((l) => l.label);
      if (chosenLibraries.some((l) => (l as { other?: boolean }).other)) {
        const typed = await vscode.window.showInputBox({ prompt: t("Library names"), placeHolder: "ARCADV1 ARCADV2" });
        for (const name of (typed ?? "").split(/[\s,;]+/).filter(Boolean)) names.push(name.toUpperCase());
      }
      if (!names.length) return;

      const pattern =
        (await vscode.window.showInputBox({
          prompt: t("Member name, or part of one"),
          placeHolder: "*531*",
          value: "*",
        })) ?? "";
      if (!pattern.trim()) return;

      const hits: Array<{ library: string; sourceFile: string; name: string; extension: string; text?: string }> = [];
      await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: t("Searching {0}…", names.join(", ")) },
        async (progress) => {
          for (const library of names) {
            // What it is doing, not a count of something it has not counted yet.
            //
            // It reported "LIB — 0 found" once, before doing any work, and never again: with one
            // library — which is the ordinary case — the number sat at zero from the first moment
            // to the last while thousands of members were being read. A figure that cannot move is
            // worse than no figure, because it reads as a search that has found nothing.
            //
            // Members READ, which is what is known while reading. How many of them MATCH is not
            // known until the filtering below, and the picker says it in its own title.
            progress.report({ message: t("{0} — reading the member list…", library) });
            try {
              const members = await ibmiAllMembers(library, (read, sourceFile) => {
                progress.report({
                  message: sourceFile
                    ? t("{0}/{1} — {2} members read", library, sourceFile, read)
                    : t("{0} — {1} members read", library, read),
                });
              });
              for (const member of members) {
                if (matchesName(member.name, pattern)) hits.push({ library, ...member });
              }
            } catch {
              // One library that cannot be read is one fewer looked in, not a failed search.
            }
          }
        },
      );

      if (!hits.length) {
        // Said plainly, with what was searched: an empty list and a failed listing look the same on
        // screen, and telling them apart is the difference between trying another pattern and
        // reporting a broken feature.
        void vscode.window.showInformationMessage(
          t("Nothing matching “{0}” in {1}.", pattern, names.join(", ")),
        );
        return;
      }

      const rows = hits
        .sort((a, b) => a.library.localeCompare(b.library) || a.name.localeCompare(b.name))
        .map((h) => ({
          label: `${h.name}${h.extension ? `.${h.extension}` : ""}`,
          description: `${h.library}/${h.sourceFile}`,
          detail: h.text ?? "",
          hit: h,
        }));

      if (withDependencies) {
        const one = await this.pickFiltered(rows, {
          placeHolder: t("{0} found — which one to follow?", rows.length),
          many: false,
          nameOf: (row) => row.hit.name,
        });
        if (!one?.length) return;
        const hit = one[0]!.hit;
        await this.attachWithDependencies(hit.library, hit.sourceFile, hit.name);
        return;
      }

      const picked = await this.pickFiltered(rows, {
        placeHolder: t("{0} found — tick the ones to attach", rows.length),
        many: true,
        nameOf: (row) => row.hit.name,
      });
      if (!picked?.length) return;
      for (const one of picked) {
        try {
          const text = await readMemberText(one.hit.library, one.hit.sourceFile, one.hit.name);
          this.pushContext({
            kind: "member",
            label: `${one.hit.library}/${one.hit.sourceFile}(${one.hit.name})`,
            body: headToTokens(text, picked.length > 3 ? 3000 : 6000),
            untrusted: true,
          });
        } catch (error) {
          void vscode.window.showWarningMessage(`Hivey Code: ${(error as Error).message}`);
        }
      }
    } catch (error) {
      void vscode.window.showWarningMessage(`Hivey Code: ${(error as Error).message}`);
    }
  }

  /**
   * One component, in every version that has it.
   *
   * The other flow asks "what is in this library"; this one asks "where is this member", which is
   * the question when two versions are on the table. The order of the questions is the difference:
   * the name first, because you already know it, then the libraries to look in.
   *
   * What it cannot do is tell you which library is which version. That mapping lives in the ARCAD
   * repository and Elias publishes no way to read it, so guessing at library naming conventions
   * would produce an integration that works at one customer and misleads at the next.
   */
  private async pickAcrossVersions(): Promise<void> {
    try {
      const pattern = await vscode.window.showInputBox({
        prompt: t("Which component? A name, or part of one"),
        placeHolder: "CUSTMAINT",
      });
      if (!pattern?.trim()) return;

      const libraries = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Window, title: t("Reading the libraries…") },
        () => ibmiAllLibraries(),
      );
      const chosen = await this.pickFiltered(
        libraries.map((l) => ({
          label: l.name,
          description: l.inList ? t("in your library list") : (l.text ?? ""),
        })),
        {
          placeHolder: t("Which version libraries? {0} on this system", libraries.length),
          many: true,
          nameOf: (row) => row.label,
        },
      );
      if (!chosen?.length) return;

      const hits: Array<{ library: string; sourceFile: string; name: string; extension: string; text?: string }> = [];
      await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: t("Looking for {0}…", pattern) },
        async (progress) => {
          for (const library of chosen) {
            // Same counter, same defect, same fix — see the member search above. A figure reported
            // once before any work and never again reads as a search that has found nothing.
            progress.report({ message: t("{0} — reading the member list…", library.label) });
            try {
              const members = await ibmiAllMembers(library.label, (read, sourceFile) => {
                progress.report({
                  message: sourceFile
                    ? t("{0}/{1} — {2} members read", library.label, sourceFile, read)
                    : t("{0} — {1} members read", library.label, read),
                });
              });
              for (const member of members) {
                if (matchesName(member.name, pattern)) hits.push({ library: library.label, ...member });
              }
            } catch {
              // A library that cannot be read is one fewer version looked in, not a failed search.
            }
          }
        },
      );

      if (!hits.length) {
        void vscode.window.showInformationMessage(
          t("Nothing matching “{0}” in {1}.", pattern, chosen.map((c) => c.label).join(", ")),
        );
        return;
      }

      // Ticked by default: having asked for one component in several versions, wanting all of them
      // is the ordinary case, and untickng one is easier than ticking five.
      const rows = hits.map((h) => ({
        label: `${h.library} — ${h.name}${h.extension ? `.${h.extension}` : ""}`,
        description: h.sourceFile,
        detail: h.text ?? "",
        picked: true,
        hit: h,
      }));
      const picked = await this.pickFiltered(rows, {
        placeHolder: t("{0} versions of “{1}” — untick any you do not want", rows.length, pattern),
        many: true,
        nameOf: (row) => row.hit.library,
      });
      if (!picked?.length) return;

      for (const one of picked) {
        try {
          const text = await readMemberText(one.hit.library, one.hit.sourceFile, one.hit.name);
          this.pushContext({
            kind: "member",
            label: `${one.hit.library}/${one.hit.sourceFile}(${one.hit.name})`,
            body: headToTokens(text, picked.length > 2 ? 4000 : 6000),
            untrusted: true,
          });
        } catch (error) {
          void vscode.window.showWarningMessage(`Hivey Code: ${(error as Error).message}`);
        }
      }
    } catch (error) {
      void vscode.window.showWarningMessage(`Hivey Code: ${(error as Error).message}`);
    }
  }

  /**
   * A tick-list whose filter means what it says.
   *
   * The quick pick's own filter is fuzzy: typing `531` matches `5331`, because it accepts the
   * characters in order with gaps between them. That is right for a command palette, where you are
   * half-remembering a name, and wrong for a list of members, where 531 and 5331 are two different
   * programs and picking the wrong one is a real mistake.
   *
   * So the items are recomputed on every keystroke with the same rule the search box uses —
   * "contains", or the glob if there is a `*` in it. VS Code still runs its own filter over what it
   * is given, but everything given to it already matches, so nothing extra survives and nothing
   * that should is hidden.
   */
  private async pickFiltered<T extends vscode.QuickPickItem>(
    all: T[],
    options: { placeHolder: string; many: boolean; nameOf: (item: T) => string },
  ): Promise<T[] | undefined> {
    const picker = vscode.window.createQuickPick<T>();
    picker.placeholder = options.placeHolder;
    picker.canSelectMany = options.many;
    picker.matchOnDescription = true;
    picker.matchOnDetail = true;
    picker.items = all;
    picker.onDidChangeValue((value) => {
      const wanted = value.trim();
      // The escape hatch always survives the filter. A row that says "type a name" is the one row
      // that has to be there precisely when nothing else matched what you typed.
      picker.items = wanted
        ? all.filter((item) => (item as { other?: boolean }).other || matchesName(options.nameOf(item), wanted))
        : all;
    });
    return new Promise<T[] | undefined>((resolve) => {
      let done = false;
      picker.onDidAccept(() => {
        done = true;
        // `selectedItems` is what is ticked when many are allowed, and the highlighted row when one
        // is: the same property means both, which is the only reason this works for both shapes.
        resolve([...picker.selectedItems]);
        picker.hide();
      });
      picker.onDidHide(() => {
        if (!done) resolve(undefined);
        picker.dispose();
      });
      picker.show();
    });
  }

  /** One member and everything it reaches, each piece its own attachment. */
  private async attachWithDependencies(library: string, sourceFile: string, member: string): Promise<void> {
    const { root, found, missing } = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: t("Following what {0} uses…", member) },
      () => collectMemberContext(library, sourceFile, member),
    );
    this.pushContext({ kind: "member", label: root.ref, body: headToTokens(root.text, this.perFileTokens()), untrusted: true });
    for (const dep of found) {
      this.pushContext({ kind: "member", label: dep.ref, body: headToTokens(dep.text, this.perFileTokens()), untrusted: true });
    }
    if (missing.length) {
      void vscode.window.showInformationMessage(
        t("Attached {0} of {1}. Not found: {2}", found.length + 1, found.length + 1 + missing.length, missing.join(", ")),
      );
    }
  }

  /** A stream file, by path. There is no list to offer: the IFS is a file system, not a catalogue. */  /** A stream file, by path. There is no list to offer: the IFS is a file system, not a catalogue. */
  private async attachStreamFile(): Promise<void> {
    const home = ibmiInstance()?.getConnection()?.getConfig()?.homeDirectory;
    const path = await vscode.window.showInputBox({
      prompt: t("Path on the IFS"),
      placeHolder: home ? `${home}/build.sh` : "/home/you/build.sh",
      value: home ? `${home}/` : "/",
    });
    if (!path?.trim()) return;
    try {
      const text = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Window, title: t("Reading {0}…", path) },
        () => readStreamFileText(path),
      );
      this.pushContext({ kind: "file", label: path.trim(), body: headToTokens(text, this.perFileTokens()), untrusted: true });
    } catch (error) {
      void vscode.window.showWarningMessage(`Hivey Code: ${(error as Error).message}`);
    }
  }

  /** One way in for anything attached from outside the workspace, so the rules are applied once. */
  private pushContext(item: ContextItem): void {
    if (this.attachments.some((a) => a.label === item.label)) {
      void vscode.window.showInformationMessage(t("{0} is already attached.", item.label));
      return;
    }
    this.attachments.push(item);
    this.screen = "chat";
    this.sendState();
    void vscode.window.setStatusBarMessage(t("{0} attached.", item.label), 4000);
  }

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

    // One subject per heading.
    //
    // These were two groups that both said "open editors": the first held "all of them" and "choose
    // among them", the second listed them. Three routes to the same files under two headings, and
    // the reader has to work out that they are the same files. What actually divides them is not
    // "one editor versus several" but WHICH editor: the one in front of you, or the set.
    group(() => {
      const editorRows: Row[] = [];
      if (active?.hasSelection) {
        editorRows.push({
          label: "$(selection) " + t("This selection"),
          description: `${active.path} · ${active.selectedLines} ${active.selectedLines === 1 ? t("line") : t("lines")}`,
          run: () => this.attach("selection"),
        });
      }
      if (active) {
        editorRows.push({
          label: "$(file-code) " + t("This file"),
          description: active.path,
          run: () => this.attach("editor"),
        });
      }
      // A heading over nothing is worse than no heading.
      if (!editorRows.length) return;
      rows.push(sep(t("The editor")));
      rows.push(...editorRows);
    });

    // The tabs themselves, and everything that acts on the whole set, under the one heading that
    // describes them. Listing them inline matters: picking the file you are switching between is
    // the commonest thing anyone does here, and two clicks for it was one too many.
    group(() => {
      rows.push(sep(files.length ? t("Open editors ({0})", files.length) : t("Open editors")));
      // Offered even when there are none, and the reason is said rather than the row hidden: a row
      // that vanishes when there is nothing to attach is indistinguishable from a feature that has
      // been removed, which is exactly how this was reported once already.
      rows.push({
        label: "$(files) " + (files.length ? t("All {0} of them", files.length) : t("All open editors")),
        description: files.length ? t("~{0} tokens", Math.round(files.length * 1200)) : t("No editor is open"),
        ...(files.length ? { run: () => this.attach("openFiles") } : {}),
      });
      for (const f of files.slice(0, 15)) {
        rows.push({
          label: "$(file) " + f.path,
          description: f.active ? t("active") : f.dirty ? t("edited") : "",
          run: () => this.onMessage({ type: "attachPath", path: f.path }),
        });
      }
      // Ticking boxes beats picking twice only once there are several to tick; below that the list
      // above is faster than the dialog.
      if (files.length > 3) {
        rows.push({
          label: "$(list-selection) " + t("Choose several…"),
          description: t("Tick the ones you want"),
          run: () => this.pickOpenEditors(),
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

    // ── IBM i ───────────────────────────────────────────────────────────────────────────────
    //
    // Only when there is a connection, because every row here needs one and a menu that offers what
    // it cannot do is worse than a menu that is short. What these attach never touches the
    // workspace: a member is fetched through Code for IBM i's connection and a stream file through
    // the file system it registers, so nothing has to be downloaded, opened in a tab, or checked
    // out first. That is the whole point — the source of truth for these files is the partition.
    if (ibmiEnabled(readSettings().ibmi.integration)) {
      group(() => {
        rows.push(sep(t("IBM i")));
        rows.push({
          label: "$(server) " + t("Source members…"),
          description: t("Search by name across the libraries you choose"),
          run: () => this.pickMembers(false),
        });
        rows.push({
          label: "$(references) " + t("Member and what it uses…"),
          description: t("Its copybooks and the programs it calls"),
          run: () => this.pickMembers(true),
        });
        rows.push({ label: "$(file-directory) " + t("Stream file (IFS)…"), run: () => this.attachStreamFile() });
        // ARCAD keeps each version in its own set of libraries, so the versions of a component are
        // members of the same name in different libraries. Nothing here knows which library belongs
        // to which version — Elias exposes no API for that mapping — so the libraries are named by
        // the person who knows them, and the search does the rest.
        if (arcadInstalled()) {
          rows.push({
            label: "$(versions) " + t("The same member across versions…"),
            description: t("ARCAD keeps each version in its own libraries"),
            run: () => this.pickAcrossVersions(),
          });
        }
      });
    }

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
      const item = await this.workspace.fileContext(uri, readSettings(), this.perFileTokens());
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
      repoMap: () => this.workspace.repoMap(repoMapBudget(this.budgetTokensFor(settings))),
      budgetTokens: this.budgetTokensFor(settings),
      attachmentTokens: this.perFileTokens(),
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

    const activeFamilies = this.familiesFor().groups.filter((g) => g !== "general").length;
    const skillsOn = skills.filter((sk) => sk.enabled).length;
    const agentsOn = found.agents.filter((a) => !settings.agents.disabled.includes(a.name)).length;

    // Choosing and making are the same menu.
    //
    // Writing a skill was reachable only from the command palette, which means it was reachable
    // only by someone who already knew it existed. The place a person looks for "make one" is the
    // place that lists the ones there are — so the two live together, separated by a rule rather
    // than by a search box.
    type Row = vscode.QuickPickItem & {
      id?: "families" | "skills" | "agents" | "newSkill" | "newAgent" | "share";
    };
    const chosen = await vscode.window.showQuickPick<Row>(
      [
        {
          label: "$(folder) " + t("Areas"),
          description: activeFamilies ? t("{0} chosen", activeFamilies) : t("none chosen"),
          detail: t("Which languages and subjects this conversation is about"),
          id: "families",
        },
        {
          label: "$(symbol-event) " + t("Skills"),
          description: t("{0} in play", skillsOn),
          detail: t("The `/` commands offered, within the areas you chose"),
          id: "skills",
        },
        {
          label: "$(person) " + t("Sub-agents"),
          description: t("{0} in play", agentsOn),
          detail: t("Each runs on its own, with its own tools, and reports back"),
          id: "agents",
        },
        { label: t("Your own"), kind: vscode.QuickPickItemKind.Separator },
        {
          label: "$(add) " + t("New skill…"),
          description: found.skills.length ? t("{0} in this repository", found.skills.length) : undefined,
          detail: t("A Markdown file in .hiveycode/skills/ — opens ready to write"),
          id: "newSkill",
        },
        {
          label: "$(add) " + t("New sub-agent…"),
          description: found.agents.length ? t("{0} in this repository", found.agents.length) : undefined,
          detail: t("A Markdown file in .hiveycode/agents/ — opens ready to write"),
          id: "newAgent",
        },
        {
          label: "$(export) " + t("Share with the team"),
          detail: t("They travel with the repository; copy them to send them further"),
          id: "share",
        },
      ],
      { placeHolder: t("What Hivey Code may reach for") },
    );
    // Escape at the top level is the way out.
    if (!chosen) return false;

    if (chosen.id === "newSkill" || chosen.id === "newAgent") {
      await createDefinition(chosen.id === "newSkill" ? "skill" : "agent");
      // Not back to the menu: the new file is now open and being written in, and a picker over it
      // would be in the way of the only thing that can happen next.
      return false;
    }
    if (chosen.id === "share") {
      await this.shareSkills();
      return true;
    }

    const config = vscode.workspace.getConfiguration(SECTION);

    if (chosen.id === "families") {
      const auto = this.familiesFor().fromOpenFiles;
      const picked = await vscode.window.showQuickPick(
        SKILL_GROUPS.filter((g) => g.id !== "general").map((g) => ({
          label: g.label,
          description: t("{0} skills", BUILTIN_SKILLS.filter((sk) => sk.group === g.id).length),
          // ⚠️ Ticked from the CHOSEN list alone. A family the open files switched on is already in
          // play, and pre-ticking it here would quietly write it into the setting the moment somebody
          // pressed Enter on an unrelated row — turning a thing that lapses on its own into a
          // permanent choice they never made. It is said instead.
          detail: auto.includes(g.id) ? `${g.hint} · ${t("already on, from the files you have open")}` : g.hint,
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
          normalizeGroups(picked.map((row) => row.id)),
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
      // A dead end told you what was missing and left you to work out how to fix it. The answer to
      // "none defined" is the one button that defines one.
      const make = t("Create a sub-agent");
      const answer = await vscode.window.showInformationMessage(
        t("No sub-agent is defined."),
        { modal: false, detail: t("A sub-agent is a Markdown file in .hiveycode/agents/ describing a job, its tools and its limits.") },
        make,
      );
      if (answer === make) {
        await createDefinition("agent");
        return false;
      }
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
        const item = await this.workspace.rangeContext(
          picked.symbol.location.uri,
          picked.symbol.location.range,
          readSettings(),
          this.perFileTokens(),
        );
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
    void vscode.window.setStatusBarMessage(t("Attached here. Ask your question."), 4000);
  }

  /**
   * Turn a recording into text in the composer.
   *
   * Local first, and off until configured: see `core/dictation/dictation.ts` for why a recording of
   * somebody's voice is not something to send by default. The text lands in the composer rather than
   * in a sent question — a recogniser mis-hears, and a dictated question that sends itself is a
   * question nobody proof-read.
   */
  /**
   * Make sure there is somewhere to turn a voice into words, asking to install one if not.
   *
   * ⚠️ Called BEFORE the recording starts, which is the whole point. It used to live inside
   * `transcribe`, so the question "shall I install a transcriber?" arrived only after somebody had
   * pressed the microphone, spoken, and pressed it again — reported as « on doit cliquer deux fois
   * comme si on voulait envoyer un message alors que l'outil n'est pas installé ». Everything a thing
   * needs is asked for before it is done, not after.
   */
  private async ensureTranscriber(): Promise<boolean> {
    const settings = readSettings();
    const storage = this.ctx.globalStorageUri.fsPath;
    const here = Boolean(installedWhisper(storage, process.platform, settings.dictation.localModel));
    if (dictationMode(settings.dictation, settings.chat.provider, here) !== "off") return true;
    if (!whisperAsset({ platform: process.platform, arch: process.arch })) {
      this.post({
        type: "dictationFailed",
        why: t(
          "Dictation needs a transcriber. The simplest way on any machine is a Groq key — its free tier is 2,000 transcriptions a day without a card — which this borrows automatically once it is your provider. A key for OpenAI is borrowed the same way. Or point hiveyCode.dictation.command at a transcriber on this machine, which sends nothing anywhere. OpenRouter and local model servers do not transcribe.",
        ),
      });
      return false;
    }
    const model = modelFor(settings.dictation.localModel);
    const go = await new Promise<boolean>((resolve) => {
      this.askInPanel(
        {
          id: randomNonce(),
          tool: "run_command",
          description: t("Install a transcriber on this machine? ({0} MB, once)", model.mb + 10),
          choices: ["once", "no"],
          detail: [
            t("Your voice is then turned into words here, by whisper.cpp. Nothing is sent anywhere, ever, and it costs nothing."),
            t("Downloaded from github.com and huggingface.co — the only addresses this extension fetches without being told to."),
            t("Model: {0} — {1}", model.id, model.hint),
          ],
        },
        (answer) => resolve(answer === "once"),
      );
    });
    if (!go) {
      this.post({ type: "dictationFailed", why: t("Dictation needs a transcriber, and none was installed.") });
      return false;
    }
    try {
      await installWhisper(storage, process.platform, process.arch, settings.dictation.localModel, (what) =>
        this.post({ type: "dictationProgress", what }),
      );
      return true;
    } catch (err) {
      this.post({ type: "dictationFailed", why: t("The transcriber could not be installed: {0}", (err as Error).message) });
      return false;
    }
  }

  /** The recording in progress, if any. One at a time: a second microphone is a second voice. */
  private recording:
    | { stop: () => Promise<string>; cancel: () => void; dir: string; started: number; level: ReturnType<typeof setInterval> }
    | undefined;

  /**
   * Start recording with a program on this machine.
   *
   * ⚠️ Here rather than in the panel because VS Code does not give an extension's panel a microphone
   * — `media` is granted to the workbench and withheld from a `vscode-webview://` origin, with no
   * prompt and no setting. Reported as « aucun moyen d'activer », and there genuinely is none.
   */
  private async startDictation(): Promise<void> {
    if (this.recording) return;
    // Everything this needs, asked for before a word is spoken rather than after.
    if (!(await this.ensureTranscriber())) return;
    const settings = readSettings();
    const dir = await fsp.mkdtemp(join(tmpdir(), "hivey-dictation-"));
    const wav = join(dir, "voice.wav");
    const configured = recordArgv(settings.dictation.recordCommand, wav);
    const found = configured ? undefined : findRecorder(process.platform);
    const argv = configured ?? (found ? [found.program, ...found.args(wav)] : undefined);
    if (!argv) {
      await fsp.rm(dir, { recursive: true, force: true });
      // ⚠️ OFFER TO INSTALL IT, rather than hand somebody a command to copy. « si il faut installer un
      // widget on ne peut pas faire en sorte que quand on clique sur le micro qu'il demande un
      // approuval pour faire la commande dans le terminal pour installer ? » — and it is the right
      // shape: this extension already asks before it runs anything, so an install is the same
      // question it asks every day, with a card that says exactly what will run.
      //
      // In a TERMINAL rather than silently: an install prints what it is doing, asks its own
      // questions sometimes, and takes a while. Somebody watching it is somebody who can stop it.
      const advice = recorderAdvice(process.platform);
      const go = await new Promise<boolean>((resolve) => {
        this.askInPanel(
          {
            id: randomNonce(),
            tool: "run_command",
            description: t("Install a recorder? {0}", advice),
            choices: ["once", "no"],
            detail: [
              t("Nothing on this machine can record, and the panel is not allowed a microphone of its own — the editor withholds that from every extension."),
              t("It runs in a terminal, where you can see it. Press the microphone again when it has finished."),
            ],
          },
          (answer) => resolve(answer === "once"),
        );
      });
      if (go) {
        const term = vscode.window.createTerminal({ name: "Hivey Code — recorder" });
        term.show(true);
        term.sendText(advice);
      }
      this.post({
        type: "dictationFailed",
        why: go
          ? t("Installing — press the microphone again once the terminal has finished.")
          : t("Nothing here can record. Set hiveyCode.dictation.recordCommand to a command that writes a WAV, with {file} for the file."),
      });
      return;
    }
    try {
      const run = startRecording(argv, wav, configured ? "signal" : (found?.stop ?? "signal"));
      // ⚠️ How loud it is, read from the file as it grows — the panel has no microphone to listen to.
      // A recorder that only writes when it stops, which is the Windows one, sends nothing and the
      // ring keeps its resting size: a bar that never moves beats one that invents a voice.
      let read = 44;
      const level = setInterval(() => {
        try {
          const fd = openSync(wav, "r");
          try {
            const size = fstatSync(fd).size;
            if (size <= read) return;
            const take = Math.min(size - read, 32_000);
            const buf = Buffer.alloc(take - (take % 2));
            readSync(fd, buf, 0, buf.length, read);
            read = size;
            let sum = 0;
            for (let i = 0; i + 1 < buf.length; i += 2) {
              const sample = buf.readInt16LE(i) / 32768;
              sum += sample * sample;
            }
            const rms = buf.length ? Math.sqrt(sum / (buf.length / 2)) : 0;
            // ⚠️ Calibrated against a real recording rather than guessed. Speech sits very low in a
            // linear scale — an RMS of 0.01 to 0.1 — so a bar driven by it barely moves; the fourth
            // root opens that range out. The FLOOR is the other half and the half that was missing:
            // without it, room noise held the edge at a quarter lit and the difference between
            // silence and a voice was invisible, which is the whole thing this is for.
            const open = Math.pow(rms, 0.25);
            this.post({ type: "dictationLevel", level: Math.max(0, Math.min(1, (open - 0.2) / 0.55)) });
          } finally {
            closeSync(fd);
          }
        } catch {
          /* the file is not there yet, or is being written — the next tick will do */
        }
      }, 120);
      this.recording = { ...run, dir, started: Date.now(), level };
      // Whether the edge can follow the voice at all. A recorder that writes its file once, at the
      // end, sends nothing to follow — and a ring left flat is indistinguishable from a broken one, so
      // the panel is told to breathe instead of to pretend.
      this.post({ type: "dictationStarted", levels: configured ? true : (found?.streams ?? false) });
      this.post({ type: "dictationProgress", what: t("Listening… press again to stop.") });
    } catch (err) {
      await fsp.rm(dir, { recursive: true, force: true });
      this.post({ type: "dictationFailed", why: t("The recorder could not be started: {0}", (err as Error).message) });
    }
  }

  /** Stop, and turn what was recorded into words — or throw it away. */
  private async stopDictation(cancel: boolean): Promise<void> {
    const run = this.recording;
    if (!run) return;
    this.recording = undefined;
    clearInterval(run.level);
    this.post({ type: "dictationLevel", level: 0 });
    if (cancel) {
      run.cancel();
      await fsp.rm(run.dir, { recursive: true, force: true });
      this.post({ type: "dictationProgress", what: "" });
      return;
    }
    try {
      const wav = await run.stop();
      this.post({ type: "dictationProgress", what: t("Transcribing…") });
      const audio = await fsp.readFile(wav);
      await this.transcribe(audio.toString("base64"), Date.now() - run.started);
    } catch (err) {
      this.post({ type: "dictationFailed", why: t("The recording failed: {0}", (err as Error).message) });
    } finally {
      await fsp.rm(run.dir, { recursive: true, force: true });
    }
  }

  private async transcribe(audioBase64: string, ms: number): Promise<void> {
    const settings = readSettings();
    const storage = this.ctx.globalStorageUri.fsPath;
    let mode = dictationMode(
      settings.dictation,
      settings.chat.provider,
      Boolean(installedWhisper(storage, process.platform, settings.dictation.localModel)),
    );
    if (mode === "off") {
      this.post({
        type: "dictationFailed",
        // ⚠️ Says BOTH ways out, because the one that needs no account is the one people do not know
        // about. And it no longer pretends the editor could do this for us: VS Code's own speech is a
        // proposed API, available to its own extensions and to nobody else.
        why: t(
          "Dictation needs a transcriber. The simplest way on any machine is a Groq key — its free tier is 2,000 transcriptions a day without a card — which this borrows automatically once it is your provider. A key for OpenAI is borrowed the same way. Or point hiveyCode.dictation.command at a transcriber on this machine, which sends nothing anywhere. OpenRouter and local model servers do not transcribe.",
        ),
      });
      return;
    }
    const audio = Buffer.from(audioBase64, "base64");
    // Guarded rather than trusted: a stuck recorder can hand over a very large buffer, and the local
    // path writes it to disk while the remote one would upload it.
    if (audio.length > 25 * 1024 * 1024) {
      this.post({ type: "dictationFailed", why: t("That recording is too long. Keep it under a couple of minutes.") });
      return;
    }
    this.log.appendLine(`[dictation] ${mode}, ${Math.round(ms / 100) / 10}s, ${audio.length} bytes`);
    try {
      const text =
        mode === "local"
          ? await this.transcribeLocally(audio, settings)
          : mode === "whisper"
            ? await this.transcribeHere(audio, settings)
            : await this.transcribeRemotely(audio, settings);
      const clean = cleanTranscript(text);
      if (!clean) {
        // Distinguished from a failure on purpose: the tool worked and there was nothing to hear.
        this.post({ type: "dictationFailed", why: t("Nothing was heard.") });
        return;
      }
      this.post({ type: "dictated", text: clean });
    } catch (err) {
      this.post({ type: "dictationFailed", why: (err as Error).message });
    }
  }

  /** Run the user's own transcriber. Nothing leaves the machine. */
  private async transcribeLocally(audio: Buffer, settings: Settings): Promise<string> {
    const dir = await fsp.mkdtemp(join(tmpdir(), "hivey-dictation-"));
    const file = join(dir, `speech.${AUDIO_EXTENSION}`);
    await fsp.writeFile(file, audio);
    try {
      const built = localCommand(settings.dictation.command, file);
      if ("message" in built) throw new Error(built.message);
      const [program, ...args] = built.argv;
      return await new Promise<string>((resolve, reject) => {
        // argv, no shell: see `localCommand`. A path with a space in it is one argument here and two
        // to a shell, and a settings box is exactly where such a path gets typed.
        const child = spawn(program!, args, { cwd: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath });
        let out = "";
        let err = "";
        child.stdout.on("data", (chunk: Buffer) => (out += chunk.toString("utf8")));
        child.stderr.on("data", (chunk: Buffer) => (err += chunk.toString("utf8")));
        child.on("error", (e) => reject(new Error(t("Could not run the dictation command: {0}", e.message))));
        const timer = setTimeout(() => {
          child.kill();
          reject(new Error(t("The dictation command did not finish in time.")));
        }, 120_000);
        child.on("close", (code) => {
          clearTimeout(timer);
          // stderr is where whisper.cpp writes its progress, so it is only interesting when the
          // command failed AND printed no text.
          if (code !== 0 && !out.trim()) reject(new Error(err.trim().split("\n").slice(-2).join(" ") || t("The dictation command failed.")));
          else resolve(out);
        });
      });
    } finally {
      // The recording is deleted whatever happened. Leaving somebody's voice in a temp directory
      // because the transcriber crashed is not a failure mode worth having.
      await fsp.rm(dir, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  /**
   * Transcribe at a configured endpoint, with consent, and in the ledger.
   *
   * ⚠️ Asked every time, and never remembered. Everywhere else in this product a consent can be
   * given "always", because what leaves is code the user chose to attach. This is a recording of
   * their voice: it cannot be pseudonymised, the user cannot see what is in it the way they can read
   * a diff, and "always" on a microphone is the one permission this project should not offer.
   */
  /**
   * Transcribe with the model this extension installed.
   *
   * ⚠️ The recording is a WAV here and WebM everywhere else, because whisper.cpp decodes WAV, FLAC and
   * MP3 and not Opus. The panel is told which to record by `dictationLocal` in the state — a
   * difference the remote services never forced anybody to notice, since they accept both.
   *
   * The file is written to a temporary directory and removed whatever happens. A recording of
   * somebody's voice left on disk after it has been turned into words is a thing nobody asked for.
   */
  private async transcribeHere(audio: Buffer, settings: Settings): Promise<string> {
    const storage = this.ctx.globalStorageUri.fsPath;
    const where = installedWhisper(storage, process.platform, settings.dictation.localModel);
    if (!where) throw new Error(t("The transcriber is not installed."));
    const dir = await fsp.mkdtemp(join(tmpdir(), "hivey-dictation-"));
    const wav = join(dir, "voice.wav");
    try {
      await fsp.writeFile(wav, audio);
      return await runWhisper(where, wav, recogniserLanguage(settings.dictation, language()));
    } finally {
      await fsp.rm(dir, { recursive: true, force: true });
    }
  }

  private async transcribeRemotely(audio: Buffer, settings: Settings): Promise<string> {
    // The configured endpoint, or the chat provider's when it is one known to transcribe. See
    // `transcriptionEndpoint`: nothing is borrowed on a guess.
    const endpoint = normalizeBaseUrl(
      transcriptionEndpoint(settings.dictation, {
        provider: settings.chat.provider,
        baseUrl: endpointFor(settings, settings.chat.provider),
      }) ?? "",
    );
    const host = (() => {
      try {
        return new URL(endpoint).host;
      } catch {
        throw new Error(t("hiveyCode.dictation.endpoint is not an address."));
      }
    })();
    const go = await new Promise<boolean>((resolve) => {
      this.askInPanel(
        {
          id: randomNonce(),
          tool: "send",
          description: t("Send this recording of your voice to {0}?", host),
          choices: ["once", "no"],
          detail: [
            t("A recording cannot be pseudonymised, the way a diff can be read before it is sent."),
            t("About {0} s of audio, {1} kB.", Math.max(1, Math.round(audio.length / 4000)), Math.round(audio.length / 1024)),
          ],
        },
        (answer) => resolve(answer === "once"),
        () => resolve(false),
      );
    });
    if (!go) throw new Error(t("Not sent."));

    const { body, contentType } = transcriptionBody(audio, {
      model: transcriptionModel(settings.dictation, settings.chat.provider),
      // The same hint a local transcriber gets: the editor's language when nothing was chosen.
      ...(() => {
        const hint = recogniserLanguage(settings.dictation, language());
        return hint ? { language: hint } : {};
      })(),
    });
    // The gateway's key, when one is stored: a self-hosted transcriber usually needs none, and a
    // missing key is not a reason to refuse — the endpoint will say so if it minds.
    const key = await Promise.resolve(this.keys.get("openai-compatible" as never)).catch(() => undefined);
    const res = await fetch(`${endpoint}/audio/transcriptions`, {
      method: "POST",
      headers: { "content-type": contentType, ...(key ? { authorization: `Bearer ${key}` } : {}) },
      // Copied into its own buffer so the typed array handed to `fetch` is backed by a plain
      // ArrayBuffer, which is what the DOM BodyInit type accepts.
      body: new Uint8Array(body).buffer as ArrayBuffer,
    });
    if (!res.ok) throw new Error(t("The transcriber answered HTTP {0}.", res.status));
    return await res.text();
  }

  private async restoreCheckpoint(id: string): Promise<void> {
    const entry = this.session.get(id);
    if (!entry || entry.role !== "user") return;
    // A turn that changed no file is still a place in the conversation you can go back to. Refusing
    // to rewind unless something was written to disk made the restore point exist only in agent
    // mode — while the thing most people want to undo is a question that sent the answer off in the
    // wrong direction, which costs nothing on disk and everything in context.
    const snapshots = entry.checkpoint ?? [];
    const folder = vscode.workspace.workspaceFolders?.[0];
    if ((snapshots.length || entry.dirtyBefore?.length) && !folder) {
      void vscode.window.showWarningMessage(t("Restoring needs the folder these files belong to open."));
      return;
    }

    const commands = entry.checkpointCommands ?? 0;
    // ⚠️ What git can put back that the checkpoint cannot: files a COMMAND rewrote. Computed here
    // rather than remembered, because "dirty now" is only knowable now — and `dirtyBefore`, recorded
    // when the turn started, is what separates the turn's changes from the user's own.
    const viaGit = entry.dirtyBefore
      ? planGitRestore(entry.dirtyBefore, dirtyPaths(), snapshots.map((snap) => join(folder?.uri.fsPath ?? "", snap.path)))
      : { restorable: [], keptBecauseYours: [] };
    const words = {
      files: (n: number) => t("{0} file(s) go back to how they were.", n),
      created: (n: number) => t("{0} file(s) created by that turn are deleted.", n),
      partial: t("Some changes were too large to record and will NOT be undone."),
      // Named, and with the count, because the honest version of this sentence is the whole reason
      // the count is kept: a restore that silently leaves a formatter's rewrite in place puts the
      // repository into a state it was never in.
      commands: (n: number) =>
        viaGit.restorable.length
          ? t("{0} command(s) also ran; git puts their {1} file(s) back.", n, viaGit.restorable.length)
          : t("⚠️ {0} command(s) also ran. Whatever they changed is NOT recorded and will NOT be undone.", n),
    };
    const detail = snapshots.length
      ? describeRestore(snapshots, Boolean(entry.checkpointPartial), words, commands)
      : commands
        ? // The worst case, and the one that used to read "nothing on disk moves": the turn's only
          // writes came from commands, so there is nothing to put back and plenty that changed.
          //
          // ⚠️ It names the remedy, because the message without one reads as "this feature is
          // broken". Reported that way: « il ouvre une fenêtre qui dit qu'il ne peut pas modifier et
          // restore les modifications ». The turn in question had written its files through `node -e`
          // — because `edit_file` was failing on Windows line endings — so the checkpoint truthfully
          // held nothing. Both halves are worth saying: what this cannot undo, and what can.
          t(
            "That turn called no edit tool, so there is nothing to put back — but {0} command(s) ran, and whatever they changed stays. Use git to review or undo those.",
            commands,
          )
        : viaGit.restorable.length
          ? t("That turn called no edit tool, but git can put back {0} file(s) it changed.", viaGit.restorable.length)
          : t("That turn changed no file, so nothing on disk moves.");
    const go = t("Restore");
    const answer = await vscode.window.showWarningMessage(
      t("Go back to before “{0}”?", entry.text.trim().split("\n")[0]!.slice(0, 60)),
      {
        modal: true,
        detail: `${detail}\n\n${
          snapshots.length
            ? t("Anything you changed by hand in those files since is overwritten. Ctrl+Z undoes this.")
            : t("Everything said after this point leaves the conversation, and the question comes back to the composer.")
        }`,
      },
      go,
    );
    if (answer !== go) return;

    // ⚠️ Git first, then the snapshots. The two never touch the same file — `planGitRestore` removes
    // anything the checkpoint holds — but the order matters anyway: a failed `clean` must not leave
    // the snapshots applied and the commands' work in place, which would be a state the repository
    // was never in.
    if (viaGit.restorable.length) {
      const failed = await discardChanges(viaGit.restorable);
      if (failed) {
        void vscode.window.showErrorMessage(t("Git could not put those files back: {0}", failed));
        return;
      }
    }

    const edit = new vscode.WorkspaceEdit();
    for (const snap of snapshots) {
      const uri = vscode.Uri.joinPath(folder!.uri, snap.path);
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

    if (snapshots.length && !(await vscode.workspace.applyEdit(edit))) {
      void vscode.window.showErrorMessage(t("The files could not be restored; the conversation is unchanged."));
      return;
    }

    // ⚠️⚠️ AND SAVE. A `WorkspaceEdit` writes to the editor's in-memory documents, not to disk: the
    // buffers show the old content while every file on disk still holds the agent's version. That
    // is the defect Florian reported as "le restore to checkpoint ne semble pas revert le code" —
    // and it is the worst shape a bug can take here, because the screen says it worked. Everything
    // that reads from disk disagrees: the compiler, a watcher rebuilding a stylesheet, git, the next
    // shell command. Worse, closing the window without saving loses the restore entirely.
    //
    // Saving keeps the undo stack intact, so the promise on the dialog still holds: Ctrl+Z undoes
    // the rollback, it just needs saving again. The alternative — relying on the user's
    // `files.refactoring.autoSave` — makes a recovery operation correct only for some settings.
    const unsaved: string[] = [];
    for (const snap of snapshots) {
      if (snap.before === undefined) continue; // Deleted on purpose; there is nothing to save.
      const uri = vscode.Uri.joinPath(folder!.uri, snap.path);
      const doc = vscode.workspace.textDocuments.find((d) => d.uri.toString() === uri.toString());
      if (!doc?.isDirty) continue;
      if (!(await doc.save())) unsaved.push(snap.path);
    }
    if (unsaved.length) {
      // Named, not counted. "Some files could not be saved" sends somebody looking through the whole
      // change; the paths say exactly which ones are still showing one thing and holding another.
      void vscode.window.showWarningMessage(
        t("Restored in the editor but NOT saved to disk: {0}. Save them, or the files on disk still hold the change.", unsaved.join(", ")),
      );
    }

    const restoredFiles = snapshots.length + viaGit.restorable.length;
    // The question comes back to the composer. Restoring is a rewind, not a deletion: the thing you
    // most often want next is the same question, asked differently.
    const text = this.session.rewindTo(id);
    this.screen = "chat";
    this.persist();
    this.sendState();
    if (text) this.post({ type: "restoreDraft", text });
    void vscode.window.showInformationMessage(
      restoredFiles
        ? t("{0} file(s) restored. The conversation is back to that point.", restoredFiles)
        : t("The conversation is back to that point. No file needed restoring."),
    );
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

  private async compact(): Promise<boolean> {
    const settings = readSettings();
    // Compaction rewrites the transcript, so the cache is lost regardless: the one moment where a
    // rebuilt map costs nothing.
    this.frozenMap = undefined;
    const covered = this.session.entries.filter((e) => e.included && !e.error && e.text.trim());
    if (covered.length < 2) {
      void vscode.window.showInformationMessage(t("There is not enough conversation to summarize yet."));
      return false;
    }

    this.screen = "chat";
    this.turn?.abort();
    const ctl = new AbortController();
    this.turn = ctl;
    this.post({ type: "turnStart" });
    this.post({ type: "status", text: t("Summarizing the conversation…") });

    // Summarizing is a chore, not a conversation: it reads a transcript and writes a page of prose,
    // and a preset says so — this is exactly the traffic the cheap tier exists for. On a preset the
    // provider follows the model, because the catalogue it routes over is OpenRouter's.
    const providerId = isHivey(settings.chat.model) ? "openrouter" : settings.chat.provider;
    const model = hiveyModel(settings.chat.model, "chore");
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
        maxTokens: Math.floor(this.budgetTokensFor(settings) * 0.8),
        omittedNote: (n) => t("({0} earlier exchanges omitted.)", n),
      });

      const messages = [
        { role: "system" as const, content: compactBrief(), cacheable: true },
        { role: "user" as const, content: transcript },
      ];
      const prepared = await this.gate.prepare(messages, settings, { provider: providerId, model, baseUrl, isLocal }, vault);
      if (!prepared) {
        this.post({ type: "status", text: t("Request cancelled.") });
        return false;
      }

      let streamed = "";
      // The summary streams too, so it needs the same holding as an answer does: a marker cut by a
      // packet boundary is two halves that match nothing. Found by the guard in the redaction tests
      // rather than by looking, which is the point of writing it as a rule over the source.
      const live = streamingRestorer((text) => vault.restore(text));
      const result = await runTurn({
        provider,
        model,
        messages: prepared.messages,
        onUsage: (info) => this.noteUsage(info),
        signal: ctl.signal,
        maxTokens: 2048,
        temperature: 0.2,
        onDelta: (d) => {
          if (!d.text || ctl.signal.aborted) return;
          streamed += d.text;
          const shown = live.push(d.text);
          if (shown) this.post({ type: "delta", text: shown });
        },
        afterResponse: (text) => vault.restore(text),
        restoreArgs: (text) => vault.restore(text),
      });

      const rest = live.flush();
      if (rest && !ctl.signal.aborted) this.post({ type: "delta", text: rest });

      const summary = (result.text || streamed).trim();
      if (!summary) {
        this.post({ type: "error", message: t("The summary came back empty; nothing was changed.") });
        return false;
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
          "{0} exchanges summarized: {1} → {2} tokens. Everything stays on screen.",
          covered.length,
          before,
          after,
        ),
      });
      this.persist();
      return true;
    } catch (err) {
      const message = (err as Error).message;
      this.post({ type: "error", message });
      this.log.appendLine(`[compact] ${message}`);
      return false;
    } finally {
      // Only if this turn is still the current one. See `runTurn` — same trap, same guard.
      if (this.turn === ctl) {
        this.turn = undefined;
        this.settle();
    this.settle();
        this.post({ type: "turnEnd" });
        this.sendState();
      }
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
          repoMap: () => this.workspace.repoMap(repoMapBudget(this.budgetTokensFor(settings))),
          budgetTokens: this.budgetTokensFor(settings),
          attachmentTokens: this.perFileTokens(),
        })
      : [];
    // The file on screen, unless the user waved it away or has already attached it by hand. It goes
    // FIRST, because it is what the question is most likely about, and because a model reads the
    // beginning of a long prompt more reliably than the middle.
    const implicit = this.workspace.activeContext(this.perFileTokens(), settings);
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

  /**
   * A second attempt at the same question, on a bigger model, because the first one is PROVEN not
   * to have worked. Carries the evidence, so the second model finishes rather than starts over.
   */
  /**
   * The three largest things in the request, named.
   *
   * Shown beside the estimate rather than instead of it. The estimate answers "how much"; this
   * answers "because of what", which is the only one of the two a person can do anything about —
   * detach a file, narrow a selection, lower the budget.
   *
   * Approximate on purpose: it measures the sources rather than the assembled messages, so the
   * lines will not sum exactly to the total. A breakdown that has to be exact is a breakdown that
   * has to be maintained in step with the assembly, and would be dropped the first time the two
   * drifted. Naming the big one correctly is what matters.
   */
  private whereTheTokensWent(systemPrompt: string, ambient: string | undefined): string[] {
    const parts: Array<{ label: string; tokens: number }> = [
      { label: t("instructions"), tokens: estimateTokens(systemPrompt) },
    ];
    if (ambient) parts.push({ label: t("repository map"), tokens: estimateTokens(ambient) });

    let conversation = 0;
    for (const entry of this.session.entries) {
      if (!entry.included || entry.error) continue;
      conversation += estimateTokens(entry.text);
      for (const item of entry.context ?? []) {
        if (item.image) {
          parts.push({ label: item.label, tokens: IMAGE_TOKENS });
          continue;
        }
        parts.push({ label: item.label, tokens: estimateTokens(item.body) });
      }
    }
    parts.push({ label: t("the conversation"), tokens: conversation });

    const total = parts.reduce((sum, p) => sum + p.tokens, 0);
    if (total <= 0) return [];
    return parts
      .sort((a, b) => b.tokens - a.tokens)
      // A tenth of the request or it is not what anybody is looking for, and at most three lines:
      // the card is a question, not a report.
      .filter((p) => p.tokens >= total * 0.1)
      .slice(0, 3)
      .map((p) => t("{0} — ~{1} tokens", p.label, p.tokens));
  }

  private async runTurn(handover?: { provider: ProviderId; model: string; note: string }): Promise<void> {
    const settings = readSettings();
    const mode = this.session.mode;
    // Every file this turn is about to change gets snapshotted against the question that asked for
    // it. Set here rather than passed down: `confirmEdit` sits several layers of tool machinery
    // away, and threading an id through all of them would put a checkpoint concern in files that
    // have nothing to do with checkpoints.
    this.checkpointFor = [...this.session.entries].reverse().find((e) => e.role === "user")?.id;
    // ⚠️ What was already yours before this turn. A checkpoint holds only what the edit tools wrote;
    // a command rewrites files nothing snapshotted, and git holds THEIR previous state — but only for
    // files that were clean when the turn began. Recorded here, once, because afterwards there is no
    // way to tell our changes from the user's. See `core/session/gitRestore.ts`.
    if (this.checkpointFor && mode === "agent") {
      const entry = this.session.get(this.checkpointFor);
      if (entry && !entry.dirtyBefore) entry.dirtyBefore = dirtyPaths();
    }
    this.plan = undefined;
    this.delegatedCostUsd = 0;
    this.turn?.abort();
    const ctl = new AbortController();
    this.turn = ctl;
    this.post({ type: "turnStart" });

    const nonce = randomNonce();
    // Chat mode answers from what it was given: no repository map, no tools, no surprises.
    // The repository's own rules, if it has any. They sit in the cacheable prefix, which is where
    // text that is identical on every turn belongs.
    const houseRules = await instructionsPrompt();
    // The knowledge base's table of contents, and only that. It sits in the cacheable prefix with
    // the house rules because it is the same kind of text: identical from one turn to the next, and
    // about the work rather than about the question.
    const learned = await knowledgeAmbient(settings);
    // FROZEN for the life of the conversation, and this is the other half of protecting the cache.
    //
    // The map is ranked around the file being edited, so it used to be rebuilt every time the user
    // switched tab — and the map sits inside the cacheable prefix. Switching tab therefore threw
    // away the prompt cache for the whole conversation, on a provider that bills the miss. Nobody
    // would ever connect the two.
    //
    // A map that is one tab-switch out of date costs nothing: it is a list of paths and symbols, the
    // model can read any file it wants, and the ranking only decides what it sees FIRST. It is
    // rebuilt when the conversation is compacted, when a new one starts, and when the user asks —
    // which are the moments where the prefix is being rewritten anyway.
    // Rebuilt when the repository has gained or lost a file since the map was taken. Freezing it
    // protects the cacheable prefix from a tab switch; it must not outlive the structure it
    // describes, or the agent asks for a file it created a minute ago and is told it does not exist.
    if (this.frozenMapAt !== this.workspace.structureVersion()) this.frozenMap = undefined;
    if (mode !== "chat" && settings.context.repoMap && !this.frozenMap) {
      // The first question of a conversation is what the map is ranked around, and it is frozen
      // there afterwards — which is the right trade: the question that opens a conversation is what
      // the conversation is about, and re-ranking on every follow-up would cost the prompt cache far
      // more than a better ordering is worth.
      const opening = [...this.session.entries].reverse().find((e) => e.role === "user")?.text;
      this.frozenMap = await this.workspace.repoMap(repoMapBudget(this.budgetTokensFor(settings)), false, opening);
      this.frozenMapAt = this.workspace.structureVersion();
    }
    const ambient = mode !== "chat" && settings.context.repoMap ? this.frozenMap : undefined;
    // The workspace's own commands, run around every tool call. The steps they produce are pushed
    // into the same list the tool calls are, so a failing hook reaches `verifyTurn` exactly as a
    // failing test does — see `core/hooks/hooks.ts`.
    const hookSteps: Array<{ tool: string; summary: string; ok: boolean; call?: string }> = [];
    const allTools: Tool[] = buildTools({
      settings: () => settings,
      hooks: new Hooks(this.ctx.workspaceState, this.log, (step) => {
        hookSteps.push({ tool: "hook", summary: step.summary, ok: step.ok, call: step.command });
        if (!ctl.signal.aborted) this.post({ type: "status", text: step.summary, tool: "hook", ok: step.ok });
      }),
      confirmEdit: (u, n) => this.confirmEdit(u, n),
      // The plan goes to the panel as it is written and onto the answer when the turn ends, so it
      // is both a live progress display and part of the record.
        // Offered only when the section is on: a tool whose output nothing shows spends tokens for
        // nothing, which is the rule this project already applied to the plan tool.
        ...(readSettings().notices.enabled ? { onNotice: (notice: Notice) => turnNotices.push(notice) } : {}),
      onPlan: (plan) => {
        if (ctl.signal.aborted) return;
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
      // The built-in skills, offered to the model the way the repository's own are: names and one
    // line each in the prompt, instructions on demand. They were reachable only by a user who knew
    // the slash command to type — so forty IBM i skills and eight finance ones, every one of them
    // backed by an evaluation task, were conditional on knowing a magic word.
    //
    // Filtered by what the user has actually switched on, which is also what bounds the cost: the
    // whole catalogue is eighty-five, a typical setup enables a fraction of it, and a skill that
    // is off must not be described either — the model would announce something the user cannot
    // invoke.
    // `familiesFor()` and not the raw setting: the families the open files imply are in play too, and
    // they are the reason forty IBM i skills now reach a conversation about an RPG member without
    // anybody having opened a settings page first.
    const familiesNow = this.familiesFor().groups;
    const offeredBuiltins = builtinSkillsForModel(
      BUILTIN_SKILLS.filter(
        (sk) => familiesNow.includes(sk.group) && isSkillEnabled(sk.name, settings.skills.disabled),
      ),
    );
    const modelSkills = [
      ...definitions.skills.filter((sk) => isSkillEnabled(skillInvocation(sk.name), settings.skills.disabled)),
      // The repository's own first: a team that wrote a skill with the same name as a built-in one
      // meant theirs, and `use_skill` resolves on the first match.
      ...offeredBuiltins.filter((b) => !definitions.skills.some((sk) => skillInvocation(sk.name) === b.name)),
    ];
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
            skills: modelSkills,
            agents: definitions.agents.filter((a) => !settings.agents.disabled.includes(a.name)),
          },
        ),
      );
    }

    // Split in two, and the split is worth money. The system prompt is the head of the cacheable
    // prefix: every provider's prompt cache hits up to the first byte that differs, so one line in
    // here that follows the open editor around costs the WHOLE prefix on every turn — the repository
    // map included. What used to sit in it and should not: the dialect note, which is derived from
    // the attached files, and the participant directive, which is per-turn by definition. Both now
    // ride after the transcript, where they are also read last. See `stablePrompt`.
    const directives = turnDirectives({
      dialect: dialectNote(this.attachments),
      ...(this.participant ? { participant: participantDirective(this.participant) } : {}),
    });
    // Named rather than inlined, because the card that asks the user to consent has to be able to
    // say how big each of them is. A number nobody can attribute is a number nobody can act on.
    // ⚠️ The provider's own thinking by default; the prompted kind ONLY where there is none. Asking a
    // model that reasons natively to also deliberate in the prompt makes it think twice, pay for
    // both, and spend the answer budget competing with its own reasoning. See `router/thinking.ts`.
    //
    // It belongs in the cacheable prefix because it is derived from the model and the chosen effort,
    // neither of which follows the user around. A model change invalidates the prefix, which costs
    // nothing: a different model has a different cache anyway.
    //
    // ⚠️ Decided from the CONFIGURED model, not the routed one: the prefix is assembled before
    // `route()` picks an endpoint, and it has to be, because the prompt is part of what the routing
    // budget is computed from. The same resolution the panel uses to decide whether to show the
    // reasoning control at all (`reasoningAvailable`), so the control and the prompt cannot disagree.
    // A mid-turn fallback to a different model therefore keeps this prefix — which is right: the
    // alternative is rebuilding and re-sending the whole conversation to change one paragraph.
    const thinkingFor = hiveyModel(settings.chat.model, "everyday");
    const thinkingHow =
      thinkingMode(thinkingFor, this.reasoning) === "prompted" ? promptedThinking(this.reasoning) : "";
    const systemPrompt = stablePrompt({
        mode: promptForMode(mode),
        ...(thinkingHow ? { thinking: thinkingHow } : {}),
        workspace: workspaceNote(),
        houseRules,
        knowledge: learned,
        skills:
          mode === "chat"
            ? ""
            : skillsPrompt(modelSkills),
    });
    const ambientText = ambient
      ? `${ambient.text}\n\n(${ambient.files} files mapped, ${ambient.omitted} omitted)`
      : undefined;
    // Remembered for the context bar, which is drawn outside a turn and cannot assemble these.
    this.lastPromptTokens = estimateTokens(systemPrompt);
    this.lastAmbientTokens = ambientText ? estimateTokens(ambientText) : undefined;
    const built = this.session.build({
      systemPrompt,
      ambient: ambientText,
      maxTokens: this.budgetTokensFor(settings),
      nonce,
    });

    // Counted once, used twice: on the card the user consents with, and in the ledger row the
    // request leaves behind. This is the one thing in a request the redaction cannot touch —
    // everything else has been through the pseudonymizer, and a screenshot leaves as it is.
    const outgoingImages = built.messages.reduce((n, msg) => n + (msg.images?.length ?? 0), 0);

    const lastUser = [...this.session.entries].reverse().find((e) => e.role === "user");
    const decision = route(routerConfig(settings), {
      kind: mode === "chat" ? "chat" : "agent",
      prompt: lastUser?.text ?? "",
      promptTokens: built.estimatedTokens,
    });
    let providerId = decision.provider;
    let model = decision.model;
    // A hand-over has already decided where this goes: it exists because the router's first answer
    // was tried and failed. Asking the router again would send it back to the model that just lost.
    if (handover) {
      providerId = handover.provider;
      model = handover.model;
    } else if (decision.suggestEscalation) {
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

    // What this repository has actually measured, when the user asked for it. Off by default, and
    // never to a model they have not configured — see `learned.ts`. A hand-over is left alone: it
    // exists because a model already failed, and the learned router's opinion of that model is the
    // opinion that just lost.
    if (!handover) {
      const choice = this.learnedRouting?.decide(settings, tools.map((x) => x.schema.name));
      if (choice && choice.model !== model) {
        model = choice.model;
        providerId = choice.provider as ProviderId;
        this.post({
          type: "status",
          text: choice.exploring
            ? t("Trying {0}: {1}", choice.model, choice.why)
            : t("Chose {0}: {1}", choice.model, choice.why),
        });
      }
    }

    const baseUrl = safeUrl(settings, providerId);
    const isLocal = isLocalEndpoint(baseUrl);
    const vault = new Vault();
    // Shared with the hook runner above: `hookSteps` is the same array, so the order the turn
    // actually happened in is preserved and "the last one wins" means what it says.
    const steps: Array<{ tool: string; summary: string; ok: boolean; call?: string }> = hookSteps;
    const verifierOutput = new Map<string, string>();
    // Asides the model recorded this turn. Cleared with the turn, because an aside about the file
    // you were editing an hour ago is not something you should know now.
    const turnNotices: Notice[] = [];
    // Whether this turn's tool calls arrived through the protocol or had to be read out of the
    // model's message. A fact about the setup, and the one the user is told about — see
    // `providers/textToolCall.ts` for what is given up when they come from the text.
    let usedTextToolCalls = false;

    // What this question will send, said before it is sent.
    //
    // It existed once as a modal dialog, was removed for being invasive, and is back as a card in
    // the conversation — which is where it belonged: it is a fact about the message being sent, and
    // the message is on that screen. "Always" switches it off for good, so anyone who does not want
    // it pays for it once. Nothing about it is a privacy control; the egress gate is separate and
    // untouched by the answer given here.
    // Asked only when there is a bill to consent to.
    //
    // It was asked for every turn, local ones included, where it quoted "~2 100 tokens · on this
    // machine, nothing billed" and waited for a click. A question whose answer is always zero is
    // not a question, it is a step — and the whole argument of running a model on your own machine
    // is that nobody has to think about what a question costs. The gateway counts as free for the
    // same reason it has no price in the picker: it is the user's own proxy and this extension has
    // no price list for it. See `core/router/billing.ts`.
    //
    // Nothing here is a privacy control. What leaves the machine is the egress gate's question,
    // asked separately, and untouched by this.
    if (settings.privacy.confirmSend !== "never" && billsTheUser(providerId)) {
      const price = this.priceLookup(model);
      // Corrected by what this model has actually been counting, so the figure the user is
      // shown before sending is the one they will be billed against rather than a safe-side guess.
      const estimatedTokens = this.tokensFor(model, built.estimatedTokens);
      const cost = isLocal ? 0 : estimateCost(estimatedTokens, price);
      const detail = [
        t("~{0} tokens", estimatedTokens),
        isLocal ? t("on this machine, nothing billed") : t("~{0} $ on {1}", cost.toFixed(4), safeHost(baseUrl)),
        // Where they went. A single large number is not a fact anybody can act on: "468 726 tokens
        // for one message and two files" was reported as an anomaly, and it was one — but nothing
        // on the card said which of the two files, or whether it was the files at all. Three lines
        // turn the figure into something that can be argued with.
        ...this.whereTheTokensWent(systemPrompt, ambientText),
      ];
      if (outgoingImages && !isLocal) detail.push(t("{0} image(s), sent as they are — an image cannot be pseudonymized", outgoingImages));
      const answer = await new Promise<"once" | "session" | "always" | "no">((resolve) => {
        // Through the same path as the other two, which is the point: a card that exists only as a
        // message the panel has already consumed dies with the next rebuild, and the promise behind
        // it waits for ever — on a request that has already been sent and paid for. Stopping must
        // also answer it, or the turn parks on a question nobody will answer.
        this.askInPanel(
          {
            id: randomNonce(),
            tool: "send",
            description: t("Send this question to {0}?", model),
            choices: ["once", "always", "no"],
            detail,
          },
          resolve,
          () => resolve("no"),
        );
      });
      if (answer === "no") {
        // Answering "no" — or stopping — ends the turn here, before the block whose `finally` does
        // the ending. Said explicitly, because a `return` from this point used to leave the turn
        // marked as running: the panel was told the turn had ended while the extension still held a
        // controller for it, and from then on the two disagreed about whether anything was running.
        this.post({ type: "status", text: ctl.signal.aborted ? t("Stopped.") : t("Not sent.") });
        this.endTurnEarly(ctl);
        return;
      }
      if (answer === "always") {
        await vscode.workspace
          .getConfiguration(SECTION)
          .update("privacy.confirmSend", "never", vscode.ConfigurationTarget.Global);
      }
    }

    // Where to go if this one will not answer. Computed BEFORE the attempt, from the route that was
    // chosen, so the chain is a property of the decision rather than something improvised inside a
    // catch block. Empty for a user with one remote model and nothing local — see `fallbackChain`.
    const chain = fallbackChain(routerConfig(settings), { provider: providerId, model, why: "" }, {
      kind: mode === "chat" ? "chat" : "agent",
      ...(settings.completion.model ? { localModel: settings.completion.model } : {}),
    });

    try {
      const provider = await providerFor(settings, this.keys, providerId);

      // The evidence rides at the END, after the transcript, so it is the last thing the model
      // reads before answering — and so it stays out of the cacheable prefix, which must be
      // identical from one turn to the next or the provider's prompt cache misses on all of it.
      const outgoing = [
        ...built.messages,
        ...(directives ? [{ role: "user" as const, content: directives }] : []),
        ...(handover ? [{ role: "user" as const, content: handover.note }] : []),
      ];
      const prepared = await this.gate.prepare(outgoing, settings, { provider: providerId, model, baseUrl, isLocal }, vault);
      if (!prepared) {
        this.post({ type: "status", text: t("Request cancelled.") });
        this.post({ type: "turnEnd" });
        return;
      }

      // Held for the audit, in memory, for this session only.
      //
      // The ledger records that a request happened and never what it contained — a log of what you
      // were trying to keep private is not a privacy feature, and that rule is unchanged. This
      // answers a different question, asked at a different moment: "what, literally, did you just
      // send?" It is the pseudonymized form, because that is the form that left; showing the
      // original would say the client's name went out when a marker went out.
      this.lastAudit = {
        at: Date.now(),
        model,
        host: safeHost(baseUrl),
        isLocal,
        messages: prepared.messages.map((m) => ({
          role: m.role,
          content: m.content,
          ...(m.images?.length ? { images: m.images.length } : {}),
        })),
        tools: tools.map((tool) => tool.schema.name),
        redactions: summarize(prepared.findings),
      };

      // The spending guard ASKS. It used to refuse, and that is the defect that made the extension
      // look dead.
      //
      // The cap is checked on an estimate, and the estimate charges the whole prompt at the input
      // price plus a quarter of it at the output price. On a premium model that is about $34 per
      // million tokens, so the old default cap of $0.25 was reached at around seven thousand
      // tokens — less than what agent mode assembles before the question is even added: the
      // repository map, the house rules, the open file. Every turn was therefore refused BEFORE
      // anything was sent, and refused by posting a message, which the panel consumes and the next
      // rebuild destroys. What the user saw was a red line that flashed for a fraction of a second,
      // no answer, no card, and a conversation whose context filled up with questions nobody ever
      // answered. Nothing in the interface said the word "budget".
      //
      // Two changes, and both are needed. The defaults moved to where an ordinary turn fits and a
      // runaway prompt still does not (see `hiveyCode.budget.*`). And going over the cap is now a
      // question in the conversation instead of a silent end: a guard whose only move is to kill
      // the turn without a readable reason protects the user from nothing.
      if (billsTheUser(providerId) && !this.budgetWaived) {
        const estimate = estimateCost(this.tokensFor(model, prepared.estimatedTokens), this.priceLookup(model));
        const verdict = this.gate.budget.check(estimate, prepared.estimatedTokens);
        if (!verdict.ok) {
          const decision = await new Promise<"once" | "session" | "always" | "no">((resolve) => {
            this.askInPanel(
              {
                id: randomNonce(),
                tool: "budget",
                description: t("This question is estimated at ${0}, over your cap. Send it anyway?", estimate.toFixed(3)),
                choices: ["once", "session", "always", "no"],
                detail: [
                  verdict.message,
                  t("~{0} tokens to {1}", this.tokensFor(model, prepared.estimatedTokens), safeHost(baseUrl)),
                ],
              },
              resolve,
              () => resolve("no"),
            );
          });
          if (decision === "no") {
            // Recorded, not posted. A refusal the user can still read after the next render is the
            // whole point: this is the message they never got to see.
            this.session.add({ role: "assistant", text: "", model }).error = t(
              "Not sent — over the spending cap: {0}. Raise hiveyCode.budget.perRequestUsd or hiveyCode.budget.dailyUsd, or use a local model.",
              verdict.message,
            );
            this.post({ type: "status", text: ctl.signal.aborted ? t("Stopped.") : t("Not sent.") });
            this.endTurnEarly(ctl);
            return;
          }
          // The exception lasts as long as the piece of work does, and no longer.
          if (decision === "session") this.budgetWaived = true;
          if (decision === "always") await this.raiseBudget(verdict.reason, estimate, prepared.estimatedTokens);
        }
      }

      const answer = this.session.add({ role: "assistant", text: "", model });
      // Named so the panel can leave it to the live turn. Cleared in the `finally`, whatever
      // happened — an answer that stays marked as in flight is an answer nothing ever draws.
      this.streamingEntryId = answer.id;
      let streamed = "";
      let thought = "";
      // A marker arrives split across packets — `⟨EMA` then `IL_1⟩` — and neither half matches the
      // pattern, so restoring chunk by chunk showed the placeholder raw and then left it raw: text
      // already on screen is never revisited. One restorer per stream, flushed when the turn ends.
      // See `streamingRestorer`.
      const liveText = streamingRestorer((text) => vault.restore(text));
      const liveThought = streamingRestorer((text) => vault.restore(text));
      // ⚠️ Prompted deliberation arrives in the TEXT channel, because a model with no native thinking
      // has no other channel to put it in. Without this the user reads the model's working-out as its
      // answer — the same failure shape as a tool call written into the message. Only built when the
      // instruction was actually sent: a splitter running on a native-reasoning model would be
      // scanning every token for delimiters nobody asked for.
      const splitThinking = thinkingHow ? thinkingSplitter() : undefined;

      // One attempt, wrapped so it can be repeated against a different endpoint. See the catch below.
      const attempt = (
        useProvider: Provider,
        useModel: string,
        outputTokens = settings.chat.maxOutputTokens,
      ): Promise<Awaited<ReturnType<typeof runTurn>>> =>
        runTurn({
        provider: useProvider,
        model: useModel,
        messages: prepared.messages,
        tools,
        signal: ctl.signal,
        maxTokens: outputTokens,
        // Never an effort a model cannot use. The control is hidden when `canReason` is false, but a
        // stored preference survives a model change — so switching to a plain model went on sending
        // `effort: "high"` to an endpoint with no idea what to do with it. Hidden is not unsent.
        reasoning: effortToSend(useModel, this.reasoning),
        // Asked once, when the model stops calling tools: it changed files and ran nothing, so
        // finish it. The cheap middle between telling the user and escalating to a billed model.
        selfCheck: (trace) =>
          selfCheckMessage(
            trace.map((x) => ({
              tool: x.call.name,
              ok: !x.result.isError,
              summary: x.result.content.split("\n")[0] ?? "",
              // From the raw arguments the model sent: the trace keeps the call, not the coerced
              // arguments, and naming the file is the whole difference between "you changed
              // something" and a message somebody can act on.
              call: callSignature(x.call.name, safeArgs(x.call.args)),
            })),
          ),
        // Nothing from a stopped turn reaches the panel. Cancellation unwinds through a provider
        // and a tool, and anything still in flight would otherwise stream into whatever turn is on
        // screen by then — text from the question the user gave up on, appearing under the next one.
        onDelta: (d) => {
          if (ctl.signal.aborted) return;
          // Split before anything else sees it, so `streamed` — which becomes the saved answer —
          // never contains the deliberation.
          const split = splitThinking && d.text ? splitThinking.push(d.text) : undefined;
          const deltaText = split ? split.text : d.text;
          const deltaThought = (d.reasoning ?? "") + (split?.reasoning ?? "");
          if (deltaText) {
            streamed += deltaText;
            // Kept on the entry as it arrives, not only at the end. What is on screen during a turn
            // is a live element the next redraw discards; the entry is what survives one. Without
            // this, stopping — which redraws immediately — showed an empty answer under the
            // question, and the words the model had already said came back only later, if at all.
            answer.text = vault.restore(streamed);
            // Placeholders are resolved as they stream, so the user never reads their own data
            // through a marker — including one the packet boundary cut in two.
            const shown = liveText.push(deltaText);
            if (shown) this.post({ type: "delta", text: shown });
          }
          if (deltaThought) {
            thought += deltaThought;
            const shownThought = liveThought.push(deltaThought);
            if (shownThought) this.post({ type: "reasoning", text: shownThought });
          }
        },
        onToolResult: ({ call, result }) => {
          if (call.source === "text") usedTextToolCalls = true;
          const summary = String(result.content).split("\n")[0]?.slice(0, 120) ?? "";
          // The whole of what a check printed, not the first line of it. The step list wants one
          // line; a model asked to fix the failure wants the error, and the error is never on the
          // first line — "exit code 1" is, and it says nothing. Overwritten each time, so a check
          // that failed and then passed leaves nothing to explain.
          if (result.isError) verifierOutput.set(call.name, String(result.content).slice(0, 4000));
          else verifierOutput.delete(call.name);
          // What it was asked to do, alongside what came back. Without the first half a turn reads
          // as six identical lines: the result of a command says nothing about which command.
          let signature = "";
          try {
            signature = callSignature(call.name, JSON.parse(call.args || "{}") as Record<string, unknown>);
          } catch {
            signature = "";
          }
          steps.push({ tool: call.name, summary, ok: !result.isError, ...(signature ? { call: signature } : {}) });
          if (ctl.signal.aborted) return;
          this.post({
            type: "status",
            text: summary,
            tool: call.name,
            ok: !result.isError,
            ...(signature ? { call: signature } : {}),
          });
        },
        report: (msg) => {
          if (ctl.signal.aborted) return;
          this.post({ type: "status", text: msg });
        },
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
        restoreArgs: (t) => vault.restore(t),
        onUsage: (info) => this.noteUsage(info),
        ...(settings.chat.promptCache ? { promptCache: true } : {}),
        });

      let result: Awaited<ReturnType<typeof runTurn>>;
      try {
        result = await attempt(provider, model);
      } catch (err) {
        // Only while nothing has reached the user. A turn that has already streamed a sentence or
        // run a tool cannot be moved elsewhere: the second model would repeat the sentence and
        // re-run the side effect. So the fallback covers exactly the case it is for — a provider
        // that refuses before it starts, which is what a rate limit and a dead network both are.
        const untouched = !streamed && !steps.length;
        if (!untouched || ctl.signal.aborted || !isRetryable(err) || !chain.length) throw err;
        result = await this.runFallback(chain, settings, { provider: providerId, model, why: "" }, attempt, ctl);
      }

      // The splitter's tail, BEFORE the restorers: an unterminated deliberation goes to the reasoning
      // channel, never to the answer. See `thinkingSplitter().flush`.
      if (splitThinking) {
        const tail = splitThinking.flush();
        if (tail.text) {
          streamed += tail.text;
          const shown = liveText.push(tail.text);
          if (shown && !ctl.signal.aborted) this.post({ type: "delta", text: shown });
        }
        if (tail.reasoning) {
          thought += tail.reasoning;
          const shownThought = liveThought.push(tail.reasoning);
          if (shownThought && !ctl.signal.aborted) this.post({ type: "reasoning", text: shownThought });
        }
      }

      // Whatever the restorers were still holding. Not lost, and not shown raw: a stream that ends
      // mid-marker — a model that stops talking, a turn the user stops — still owes the reader the
      // characters it was waiting on.
      for (const [restorer, type] of [
        [liveText, "delta"],
        [liveThought, "reasoning"],
      ] as const) {
        const rest = restorer.flush();
        if (rest && !ctl.signal.aborted) this.post({ type, text: rest });
      }

      // Thought until there was nothing left to answer with.
      //
      // A model that reasons is charged for its reasoning out of the SAME output budget as its
      // reply, so a long think can consume the whole of it — and the turn then ends with a full
      // block of thinking and not one word of answer. The provider says so, in `finish_reason`,
      // and nothing read it: a truncated turn and a finished one were indistinguishable.
      //
      // Repeated once, with four times the budget, and only when there is NOTHING to show. A
      // truncated answer that reached the user is left alone — it is imperfect and it is theirs,
      // and asking again would bill them twice for a paragraph they can already read. This is the
      // one case where the answer is empty, which is worth nothing at all.
      if (result.truncated && !result.text.trim() && !ctl.signal.aborted) {
        const roomier = settings.chat.maxOutputTokens * 4;
        this.log.appendLine(`[turn] the answer budget ran out during reasoning; retrying at ${roomier}`);
        this.post({ type: "status", text: t("It spent the whole answer on thinking. Asking again with more room…") });
        thought = "";
        streamed = "";
        result = await attempt(provider, model, roomier);
        // Still nothing, and now it is worth saying rather than showing an empty bubble. The
        // reasoning is kept: it is what the model did produce, and it is the evidence for raising
        // hiveyCode.chat.maxOutputTokens rather than guessing.
        if (!result.text.trim()) {
          answer.error = t(
            "The model used its whole answer budget on reasoning and produced no reply. Raise hiveyCode.chat.maxOutputTokens, or use a lower reasoning effort.",
          );
        }
      }

      // What the provider's cache actually served, accumulated across the conversation. Shown in the
      // ring: the cache is most of the bill on a long conversation, and the things that break it are
      // invisible without a number.
      this.cacheSeen.prompt += result.usage.promptTokens;
      this.cacheSeen.cached += result.usage.cachedTokens;

      // ⚠️ `result.text` is the provider's RAW reply and still carries the deliberation block; only
      // `streamed` went through the splitter. Taking the raw field would strip the block from the
      // screen and then write it back into the saved transcript — visible on reopening, and sent to
      // the model on the next turn as if it were the answer.
      if (splitThinking && result.text) {
        const whole = splitThinkingText(result.text);
        answer.text = whole.text || streamed;
        if (whole.reasoning && !thought.includes(whole.reasoning)) thought = whole.reasoning;
      } else {
        answer.text = result.text || streamed;
      }
      if (this.plan) answer.plan = this.plan;
      // "À savoir": what it noticed, what it did not verify, and the state of the tool. Two of the
      // three are derived from facts already in hand rather than asked of the model — a section that
      // depended on the model volunteering would be absent on the models that most need it.
      if (settings.notices.enabled) {
        const unfinished = planVerdict(this.plan);
        const notices = youShouldKnow({
          reported: turnNotices,
          changed: steps.some((x) => MUTATING_TOOLS.has(x.tool) && x.ok),
          verified: steps.some((x) => VERIFIER_TOOLS.has(x.tool) && x.ok),
          planLeft: unfinished.left.map((step: { title: string }) => step.title),
          // From the budget this turn actually used, which is the figure the ring is showing.
          ...(this.lastPromptTokens && this.budgetTokensFor(settings) > 0
            ? { contextFill: Math.min(1, this.lastPromptTokens / this.budgetTokensFor(settings)) }
            : {}),
          ...(billsTheUser(providerId)
            ? { spend: { today: this.gate.budget.spentToday(), cap: settings.budget.dailyUsd } }
            : {}),
          // Measured, not guessed: true when the runtime returned no tool calls through the
          // protocol and they had to be read out of the model's message. See `textToolCall.ts`.
          toolCallsFromText: usedTextToolCalls,
        });
        if (notices.length) answer.notices = notices;
      }
      answer.usdCost = 0;
      answer.usage = {
        promptTokens: result.usage.promptTokens,
        completionTokens: result.usage.completionTokens,
        cachedTokens: result.usage.cachedTokens,
      };
      if (thought) answer.reasoning = thought;
      if (steps.length) answer.steps = steps;

      // ⚠️ What a command did is NOT in the checkpoint, and the restore dialog has to say so. The
      // checkpoint is built in `confirmEdit`, so it holds exactly what the edit tools touched; a
      // command is opaque, and `prettier --write`, `sed -i`, a codemod or a build that regenerates a
      // stylesheet rewrite files nothing snapshotted. Counted here, at the end of the turn, because
      // this is where the turn's steps exist and `checkpointFor` is still set.
      if (this.checkpointFor) {
        const ran = steps.filter((x) => x.tool === "run_command" && x.ok).length;
        if (ran) {
          const entry = this.session.get(this.checkpointFor);
          if (entry) entry.checkpointCommands = (entry.checkpointCommands ?? 0) + ran;
        }
      }

      if (!isLocal) {
        const cost = costOf(result.usage, this.priceLookup(model));
        // Plus whatever this turn delegated. A sub-agent's bill belongs to the answer that ordered
        // it, not to nobody.
        answer.usdCost = cost.usd + this.delegatedCostUsd;
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
            // Recorded because it is the part of the request the redaction count says nothing
            // about: "0 redactions" on a turn that sent a screenshot would be true and misleading.
            ...(outgoingImages ? { images: outgoingImages } : {}),
          },
          settings,
        );
      }

      if (result.stoppedBecause === "max-steps") {
        this.post({ type: "status", text: t("Stopped after the maximum number of steps.") });
      }
      this.persist();

      // The turn is over and the evidence is in. This is the only place in the extension that
      // decides to spend money on the strength of something that HAPPENED rather than something
      // that was predicted — see `verifyTurn`.
      if (!handover && !ctl.signal.aborted && mode !== "chat") {
        await this.escalateOnFailure(steps, verifierOutput, settings, model, providerId);
      }

      // One more measurement for this repository, when the user asked for learned routing. The verdict
      // is `verifyTurn`'s, which is the same evidence the escalation spends money on — so a turn that
      // nothing verified counts as neither a success nor a failure and is simply not recorded.
      {
        const verdict = verifyTurn(steps, this.plan);
        const verified = steps.some((x) => VERIFIER_TOOLS.has(x.tool));
        if (verified && !ctl.signal.aborted) {
          void this.learnedRouting?.observe(model, steps.map((x) => x.tool), verdict.kind === "none");
        }
      }

      // The other half of the learning corpus. An episode is kept only when the verification went
      // GREEN after the remote model — an episode whose final diff does not work is not a training
      // example, it is two wrong answers. `handover` is true on the escalated turn itself, which is
      // the turn whose verdict decides.
      if (handover && this.pendingEpisode && !ctl.signal.aborted && verifyTurn(steps, this.plan).kind === "none") {
        const episode = this.pendingEpisode;
        this.pendingEpisode = undefined;
        void this.corpus?.record({
          ...episode,
          final: { model, diff: (await this.turnDiffs()).join("\n") },
        });
      } else if (handover) {
        // One chance. Carrying it into a third turn would attach a diff nobody can attribute.
        this.pendingEpisode = undefined;
      }
    } catch (err) {
      const message = (err as Error).message;
      this.log.appendLine(`[turn] ${message}`);
      // A turn the user stopped has no error to report. Cancellation surfaces as a failure at
      // whatever layer noticed first, and showing that to someone who pressed stop tells them their
      // own decision went wrong.
      if (!ctl.signal.aborted) {
        // Written into the conversation, ALWAYS — and this is the defect that hid every other one.
        //
        // It used to be recorded only when an empty assistant entry already existed, which is to
        // say only when the turn had got as far as contacting a model. A failure before that — a
        // bad address, a missing key, a refused request, anything while the prompt was being built
        // — was recorded nowhere. It was posted as a message, drawn into the turn in progress, and
        // destroyed by the next rebuild: a red line that appeared for a fraction of a second and
        // left nothing behind. The user could see something was wrong and could not read what.
        const last = this.session.entries[this.session.entries.length - 1];
        if (last?.role === "assistant" && !last.text) last.error = message;
        else this.session.add({ role: "assistant", text: "", model }).error = message;
        this.post({ type: "error", message });
        // And once, out of the transcript, because a transcript can be scrolled past — and because
        // somebody who cannot get an answer needs the text of the failure to be able to report it.
        const open = t("Open the log");
        void vscode.window.showErrorMessage(t("Hivey Code: {0}", message), open).then((choice) => {
          if (choice === open) this.log.show(true);
        });
      }
    } finally {
      // Before anything else, and unconditionally: this is what the panel reads to decide whether
      // an answer is somebody else's to draw. Left set by a turn that threw, it would be an answer
      // nothing ever draws — a silent, permanent blank.
      this.streamingEntryId = undefined;
      this.checkpointFor = undefined;
      // Old checkpoints give up their file contents here rather than at write time: the cap is
      // about what is STORED, and this is the moment just before the conversation is stored.
      this.session.entries = trimCheckpoints(this.session.entries);
      this.persist();
      // Only when this turn is STILL the current one, and this guard is the whole bug behind "the
      // stop button does nothing".
      //
      // A turn that is stopped does not finish here immediately: the abort unwinds through a
      // provider, a tool, a sub-agent, and lands in this block some milliseconds later. If the user
      // has asked something else in between — which is exactly what someone does after pressing
      // stop — the new turn has already put ITS controller in `this.turn`, and this line used to
      // throw it away. From then on `stopTurn` had nothing to abort and the button was genuinely
      // dead, for the rest of the conversation, with nothing in any log to say why.
      //
      // Ending the panel's turn had the same defect from the other side: the dying turn announced
      // `turnEnd` over a turn that was still streaming.
      if (this.turn === ctl) {
        this.turn = undefined;
        this.settle();
    this.settle();
        this.post({ type: "turnEnd" });
        this.sendState();
      }
    }
  }

  /**
   * Ask, unless the permission book already answered. The book is consulted BEFORE the panel is
   * disturbed, which is what makes "toujours autoriser" worth anything.
   */
  /**
   * The same question, answered by several models, one after another.
   *
   * Three decisions, and each is a refusal to do the obvious thing.
   *
   * NO SIDE-BY-SIDE. The panel is 300 px wide docked. Two columns of prose in it is one column of
   * prose cut in half. The answers go into the conversation in sequence, each labelled with the
   * model that wrote it, which is also where answers belong.
   *
   * NO TOOLS. Comparison runs in chat mode whatever the panel is set to. Three agents editing the
   * same files to answer the same question is not a comparison, it is a collision — and the thing
   * being compared is how the models THINK, which the first answer shows.
   *
   * THE PRICE IS IN THE PICKER. Comparing four models costs four answers. A feature that spends
   * four times without saying so is a feature that gets used once and then distrusted, and the
   * whole argument of this extension is that nothing is spent by surprise.
   */
  private async compareAcrossModels(question: Entry, context: ContextItem[]): Promise<void> {
    if (this.turn) {
      void vscode.window.showInformationMessage(t("Wait for the current answer to finish first."));
      return;
    }
    const settings = readSettings();
    const models = this.models.length ? this.models : await listModels(settings, this.keys, settings.chat.model);
    const picked = await vscode.window.showQuickPick(
      models.slice(0, 200).map((model) => ({
        label: model.name || model.id,
        description: model.local ? t("on this machine") : t("{0} $/M in · {1} $/M out", model.inUsd, model.outUsd),
        detail: model.id,
        model,
      })),
      {
        canPickMany: true,
        placeHolder: t("Which models should answer this? Each one costs one answer."),
        matchOnDetail: true,
      },
    );
    if (!picked?.length) return;

    for (const choice of picked) {
      if (this.turn) break;
      // Announced before it is spent, one line per model, because a loop that bills four times
      // should say so four times rather than once at the start.
      this.post({ type: "status", text: t("Asking {0}…", choice.label) });
      // A preset is a routing, not a model id: sending `hivey/free` to a provider is a 400. The
      // model that answers an ordinary question is the one being compared.
      const id = isHivey(choice.model.id) ? hiveyModel(choice.model.id, "everyday") : choice.model.id;
      await this.answerWith(question, context, id, choice.model.provider as ProviderId);
    }
  }

  /**
   * One answer, from one named model, added to the conversation.
   *
   * Deliberately NOT `runTurn`: that one reads the settings to decide where a question goes, and the
   * whole point here is that the caller has already decided. It is also chat-shaped — no tools, one
   * request — which is what keeps a four-model comparison to four requests.
   */
  private async answerWith(question: Entry, context: ContextItem[], model: string, provider: ProviderId): Promise<void> {
    const settings = readSettings();
    const baseUrl = safeUrl(settings, provider);
    const isLocal = isLocalEndpoint(baseUrl);
    const vault = new Vault();
    const entry = this.session.add({ role: "assistant", text: "", model });
    this.sendState();
    try {
      // The question and its attachments, and NOTHING else — not the conversation around it.
      //
      // Two reasons, and they point the same way. A comparison in which one model is handed the
      // transcript and another is handed the transcript plus the first model's answer is not a
      // comparison. And the question being compared is already IN that transcript, so including it
      // would send it twice. Every model gets the same input, which is the only thing that makes
      // the answers comparable — and it is also the cheapest possible request.
      const nonce = randomNonce();
      const outgoing = [
        { role: "system" as const, content: promptForMode("chat"), cacheable: true },
        { role: "user" as const, content: renderEntry({ ...question, context } as Entry, nonce) },
      ];
      const prepared = isLocal
        ? { messages: outgoing }
        : await this.gate.prepare(outgoing, settings, { provider, model, baseUrl, isLocal }, vault);
      if (!prepared) {
        entry.error = t("Not sent.");
        return;
      }
      const result = await runTurn({
        provider: await providerFor(settings, this.keys, provider),
        model,
        messages: prepared.messages,
        maxTokens: 2048,
        afterResponse: (text) => vault.restore(text),
        restoreArgs: (text) => vault.restore(text),
        onUsage: (info) => this.noteUsage(info),
      });
      entry.text = result.text;
      if (!isLocal) {
        const cost = costOf(result.usage, this.priceLookup(model));
        entry.usdCost = cost.usd;
        entry.usage = {
          promptTokens: result.usage.promptTokens,
          completionTokens: result.usage.completionTokens,
          cachedTokens: result.usage.cachedTokens,
        };
      }
    } catch (err) {
      // One model failing must not take the comparison down with it: the others are the point.
      entry.error = (err as Error).message;
    } finally {
      this.persist();
      this.sendState();
    }
  }

  /** Consent to send, asked as a card in the conversation. */
  private askEgress(request: { description: string; detail: string[] }): Promise<"once" | "always" | "no"> {
    if (!this.view) return Promise.resolve("no");
    const id = randomNonce();
    return new Promise((resolve) => {
      this.askInPanel(
        {
          id,
          tool: "egress",
          description: request.description,
          detail: request.detail,
          // No "this session": consent to a destination is per destination, and a session is not one.
          choices: ["once", "always", "no"],
        },
        (answer) => resolve(answer === "no" ? "no" : answer === "always" ? "always" : "once"),
        () => resolve("no"),
      );
    });
  }

  /**
   * Has this action already been allowed — by a standing rule, or by the auto-approve scope?
   *
   * ⚠️⚠️ Extracted because the answer was computed in ONE place and needed in TWO, and the second
   * place did not ask. `confirmEdit` opened a diff and a notification on every single edit,
   * unconditionally, with no idea that the user had already said "Always". So the product had two
   * approval systems that did not know about each other: one that the Always button satisfied, and
   * one that asked again right behind it.
   *
   * That is both of Florian's reports at once — « le mode agent fait du compare au lieu de
   * modifier » and « il redemande les autorisations après si on clique sur toujours ». Neither was
   * a bug in the permission store, which was right all along; the second asker simply never
   * consulted it.
   */
  private alreadyAllowed(tool: string, args: Record<string, unknown>): boolean {
    const decision = this.permissions.decide(tool, args);
    if (decision === "never") return false;
    if (decision === "always" || decision === "session") return true;
    const settings = readSettings();
    const path = pathArgument(args);
    return autoApprove(
      {
        scope: settings.permissions.autoApprove,
        allowedPaths: settings.permissions.allowedPaths,
        allowedCommands: settings.permissions.allowedCommands,
        deniedPaths: settings.permissions.deniedPaths,
        deniedCommands: settings.permissions.deniedCommands,
        blockedGlobs: settings.privacy.blockedGlobs,
      },
      {
        tool,
        ...(path ? { path, insidePath: isInsideWorkspace(path) } : {}),
        ...(tool === "run_command" ? { command: String(args["command"] ?? "") } : {}),
      },
      matchGlob,
    ).allow;
  }

  /**
   * How big the change on this card is, in lines.
   *
   * ⚠️ `write_file` is here as well as `edit_file`, and it is the one that needed it more: it replaces
   * a file ENTIRELY, so "write src/guilde.js" on a card says nothing about whether four lines or four
   * thousand are about to go. It costs one read of the file being replaced, which is a file the tool
   * is about to overwrite anyway.
   *
   * Nothing for any other tool: a size on a card about running a command would be a number with no
   * referent.
   */
  private async changeSizeFor(req: { tool: string; args: Record<string, unknown> }): Promise<string> {
    if (req.tool === "edit_file") {
      return describeChangeSize(changeSize(String(req.args["old"] ?? ""), String(req.args["new"] ?? "")));
    }
    if (req.tool !== "write_file") return "";
    const path = pathArgument(req.args);
    if (!path) return "";
    try {
      const before = await readOrEmpty(vscode.Uri.file(path));
      return describeChangeSize(changeSize(before ?? "", String(req.args["content"] ?? "")));
    } catch {
      // A file that cannot be read is a file being created, and "+N" is still worth saying.
      return describeChangeSize(changeSize("", String(req.args["content"] ?? "")));
    }
  }

  private async askApproval(req: { tool: string; description: string; args: Record<string, unknown> }): Promise<boolean> {
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
    // ⚠️ The size of the change, on the card that decides it. The diff editor used to carry this and
    // no longer opens — so the one fact that separates a two-line fix from a four-hundred-line
    // rewrite has to be here, before the answer, rather than discovered afterwards.
    const edited = await this.changeSizeFor(req);
    return new Promise<boolean>((resolve) => {
      this.askInPanel(
        {
          id,
          tool: req.tool,
          description: req.description,
          ...(command ? { command } : {}),
          ...(edited ? { detail: [t("{0} lines", edited)] } : {}),
          // ⚠️ Three, not four. Florian: « il faudrait juste le bouton Accept, toujours ou deny, pas
          // toujours pour la conversation car par défaut toujours c'est uniquement sur la
          // conversation en cours ». He is describing a menu whose middle two entries were the same
          // promise worded differently — and the one that said "this conversation" was the one that
          // appeared not to work, because a SECOND asker ignored it. With that fixed, the remaining
          // honest distinction is "this time" against "from now on, everywhere, until you change it
          // in the settings".
          choices: ["once", "always", "no"],
        },
        (answer) => {
          if (answer === "session" || answer === "always") {
            this.permissions.remember(req.tool, req.args, answer);
          }
          resolve(answer !== "no");
        },
        () => resolve(false),
      );
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
  /**
   * The escalation that costs nothing when it is not needed.
   *
   * The router's own escalation is a bet placed before the work: a regular expression reads the
   * question, decides "architecture" is hard, and sends it to a paid model — which is wrong in both
   * directions. It pays for easy questions that contain a scary word, and it leaves genuinely hard
   * ones on a 7B model because they were phrased plainly. Worse, it never learns: the local attempt
   * could fail every time and the next identical question would still go local.
   *
   * This is the same decision made afterwards, on evidence. The local model tries, the tests or the
   * diagnostics say whether it worked, and only a PROVEN failure buys a remote call — which then
   * starts from the diff and the error rather than from the question. A user who never hits a
   * failure never pays anything, which is the whole argument of this extension applied to its own
   * escalation.
   */
  private async escalateOnFailure(
    steps: TurnStep[],
    verifierOutput: Map<string, string>,
    settings: Settings,
    usedModel: string,
    usedProvider: ProviderId,
  ): Promise<void> {
    if (settings.escalation.policy === "never") return;
    const verdict = verifyTurn(steps, this.plan);
    if (verdict.kind === "none") return;

    const target = escalationTarget(routerConfig(settings), { provider: usedProvider, model: usedModel });
    if (!target) return;

    // What the failed attempt left on disk. Without this the second model reads the ORIGINAL file
    // in the transcript, writes the change that is already there, and reports success — the exact
    // failure mode of handing a fresh model a stale conversation.
    const diffs = await this.turnDiffs();
    const detail = verdict.evidence.map((e) => verifierOutput.get(e.tool)).find((x) => x) ?? undefined;
    const note = handoverNote({ verdict, diffs, ...(detail ? { detail } : {}) });

    if (settings.escalation.policy === "ask") {
      const go = await vscode.window.showWarningMessage(
        t("The local model tried and it did not work: {0}. Hand it to {1}?", verdict.why, target.model),
        t("Hand it over"),
        t("Leave it"),
      );
      if (go !== t("Hand it over")) return;
    }

    this.post({ type: "status", text: t("Handing over to {0}: {1}", target.model, verdict.why) });
    // Captured BEFORE the second turn, because afterwards the local attempt's diff is indistinguishable
    // from the remote one's: both are on disk. The files are the checkpoint's `before` state, which is
    // exactly what a fixture needs to be a fixture.
    if (this.corpus?.enabled()) {
      const checkpoint = (this.checkpointFor ? this.session.get(this.checkpointFor) : undefined)?.checkpoint ?? [];
      const asked = [...this.session.entries].reverse().find((e) => e.role === "user")?.text ?? "";
      const failing = verdict.evidence.at(-1);
      this.pendingEpisode = {
        at: Date.now(),
        request: asked,
        files: checkpoint.map((snap) => ({ path: snap.path, before: snap.before ?? "" })),
        local: { model: usedModel, diff: diffs.join("\n"), error: detail ?? verdict.why },
        final: { model: "", diff: "" },
        // The command whose exit code decided it, when one did. A verdict from the diagnostics has no
        // command, and the export says so rather than inventing one.
        check: failing?.tool === "run_command" ? (failing.call ?? "") : "",
        omitted: 0,
      };
    }
    await this.runTurn({ ...target, note });
  }

  /**
   * Unified diffs of everything this turn changed, against the checkpoint taken before it.
   *
   * The checkpoint exists already, for the undo button — it holds every touched file as it stood
   * before the question. That makes the diff free: no watcher, no second copy, and it covers
   * exactly the files the turn is responsible for.
   */
  private async turnDiffs(): Promise<string[]> {
    const entry = this.checkpointFor ? this.session.get(this.checkpointFor) : undefined;
    const snapshots = entry?.checkpoint ?? [];
    const out: string[] = [];
    let budget = 12_000;
    for (const snap of snapshots) {
      if (budget <= 0) break;
      let now = "";
      try {
        const uri = vscode.Uri.joinPath(vscode.workspace.workspaceFolders![0]!.uri, snap.path);
        now = Buffer.from(await vscode.workspace.fs.readFile(uri)).toString("utf8");
      } catch {
        // Deleted by the turn. A diff against nothing still says what happened.
      }
      const diff = unifiedDiff(snap.path, snap.before ?? "", now, { maxChars: budget });
      if (!diff) continue;
      budget -= diff.length;
      out.push(diff);
    }
    return out;
  }

  /**
   * The repository map this conversation is using, held until something makes it worth paying to
   * rebuild. See where it is set for why a slightly stale map is cheaper than a fresh one.
   */
  private frozenMap: { text: string; files: number; omitted: number } | undefined;
  /** The workspace structure the frozen map describes. See `WorkspaceContext.structureVersion`. */
  private frozenMapAt = -1;

  /** What sub-agents spent during the turn in progress, to be added to the answer that ordered it. */
  private delegatedCostUsd = 0;

  /** The answer a turn is writing right now, which the panel leaves to the live turn to draw. */
  private streamingEntryId: string | undefined;

  /** Prompt tokens sent, and how many of them the provider served from its cache, this session. */
  private cacheSeen = { prompt: 0, cached: 0 };

  /**
   * Try the next endpoint down, and the one after that, until one answers or the chain runs out.
   *
   * The user is TOLD, every time. A silent fallback is the worst version of this feature: the
   * answer arrives from a smaller model, reads slightly worse, and nobody knows why — least of all
   * when they later compare it against what the model they chose actually does. So each hop posts a
   * line, and the entry records the model that really answered.
   *
   * When the whole chain fails, the FIRST error is what is thrown: it is the one about the endpoint
   * the user actually chose, and "this machine is not running a model either" is a confusing thing
   * to be told when the real problem is that OpenRouter is rate-limiting.
   */
  private async runFallback(
    chain: Route[],
    settings: Settings,
    from: Route,
    attempt: (provider: Provider, model: string) => Promise<Awaited<ReturnType<typeof runTurn>>>,
    ctl: AbortController,
  ): Promise<Awaited<ReturnType<typeof runTurn>>> {
    let first: unknown;
    for (const next of chain) {
      if (ctl.signal.aborted) break;
      this.post({ type: "status", text: describeFallback(from, next) });
      try {
        const provider = await providerFor(settings, this.keys, next.provider);
        const result = await attempt(provider, next.model);
        this.log.appendLine(`[fallback] ${from.model} → ${next.model} (${next.why})`);
        return result;
      } catch (err) {
        first ??= err;
        if (!isRetryable(err)) break;
      }
    }
    throw first ?? new Error(t("No endpoint answered."));
  }

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

  /**
   * Record the file's prior state, and let the edit through.
   *
   * ⚠️⚠️ THIS NO LONGER ASKS, and that is the fix Florian asked for three times: « le mode agent ne
   * devrait même pas faire de diff », « il continue de faire les diff au lieu de modifier ».
   *
   * The approval already happened. `askApproval` put a card in the panel, named the file, and took
   * the answer — Accept, Always or Deny. This function then opened a diff EDITOR TAB, stealing the
   * tab the user was working in, and asked the same question again in a notification. Two askers for
   * one decision, which is also why "Always" never seemed to take: it satisfied the first and the
   * second carried on asking.
   *
   * What replaces the diff is not nothing: the approval card now carries the change's size, the step
   * list names every file touched, the checkpoint puts them back, and the editor's own undo is
   * unaffected. What is gone is being shown a comparison instead of being given a change.
   *
   * The second reader survives, because it is not an approval: it answers "does this diff do
   * something the request did not ask for", and when it says yes about a dangerous file it still
   * stops the edit. See `core/review/second.ts`.
   */
  private async confirmEdit(uri: vscode.Uri, next: string): Promise<boolean> {
    const original = await readOrEmpty(uri);
    const second = await this.secondOpinion(relative(uri), original ?? "", next);
    if (second.blocking) {
      // Not a dialog: the turn is running and the model is the one that has to hear this.
      this.post({
        type: "status",
        text: [t("Refused by the reviewer: {0}", relative(uri)), ...second.lines].join(" — "),
        tool: "edit_file",
        ok: false,
      });
      return false;
    }
    // Objections that do not block are still worth saying, once, where the turn is being read.
    if (second.lines.length) {
      this.post({ type: "status", text: second.lines.join(" — "), tool: "edit_file", ok: true });
    }
    this.snapshot(uri, original);
    return true;
  }


  /**
   * What a second model says about this diff, when the diff is one of the dangerous ones.
   *
   * ⚠️ LOCAL BY DEFAULT, taken literally: if the second reader would be a model that bills, it is not
   * called at all and the card says so. A second opinion that quietly doubled the price of editing a
   * settings file would be a feature people turn off, and one that charged for it without saying so
   * would be worse than that.
   */
  private async secondOpinion(
    path: string,
    before: string,
    after: string,
  ): Promise<{ lines: string[]; blocking: boolean }> {
    const settings = readSettings();
    if (!vscode.workspace.getConfiguration(SECTION).get<boolean>("secondOpinion.enabled", true)) {
      return { lines: [], blocking: false };
    }
    const diff = unifiedDiff(path, before, after, { maxChars: 20_000 });
    const trigger = needsSecondOpinion({ paths: [path], diff }, DEFAULT_TRIGGERS, matchGlob);
    if (!trigger.needed) return { lines: [], blocking: false };

    const state = policyState();
    const blocking = state.kind !== "none" && state.policy.secondOpinion === "blocking";

    // The local endpoint's own model, or nothing. `endpointFor` throws for a provider with no address,
    // which is the ordinary case for somebody who only uses a paid one.
    let localUrl = "";
    try {
      localUrl = endpointFor(settings, "local");
    } catch {
      localUrl = "";
    }
    if (!localUrl || !isLocalEndpoint(localUrl)) {
      return {
        lines: [
          t(
            "This change is worth a second look ({0}), and no local model is configured to give one — a paid one is not called for this.",
            trigger.why,
          ),
        ],
        blocking: false,
      };
    }

    const model = settings.completion.model || settings.chat.model;
    try {
      const provider = await providerFor(settings, this.keys, "local");
      const result = await runTurn({
        provider,
        model,
        messages: [{ role: "user", content: secondOpinionPrompt(this.lastRequest(), diff) }],
        maxTokens: 1024,
      });
      const opinion = parseObjections(result.text);
      return {
        lines: [t("Worth a second look: {0}.", trigger.why), ...describeOpinion(opinion, model, blocking)],
        // Blocking only when the organisation asks AND there is something to resolve.
        blocking: blocking && opinion.objections.length > 0,
      };
    } catch (err) {
      this.log.appendLine(`[second] ${(err as Error).message}`);
      return {
        lines: [t("A second reader could not be reached ({0}), so nobody has checked this but you.", (err as Error).message.split("\n")[0] ?? "")],
        blocking: false,
      };
    }
  }

  /** The question this turn is answering, for the second reader. */
  private lastRequest(): string {
    return [...this.session.entries].reverse().find((e) => e.role === "user")?.text ?? "";
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
function dialectNote(attached: ContextItem[] = []): string {
  // The same switch the IBM i tools are behind. Without it the platform's rules arrived by file
  // name alone: any `.sql` file — Postgres, SQLite, a migration in a web project — was answered
  // with the Db2 for i dialect, on machines that have never seen a partition.
  const onIbmi = ibmiEnabled(readSettings().ibmi.integration);
  const sources: Array<{ path: string; text: string }> = [];

  const doc = vscode.window.activeTextEditor?.document;
  if (doc) sources.push({ path: doc.uri.path, text: doc.getText().slice(0, 20_000) });
  // What is ATTACHED counts too, and it took a question from the user to see why: the rules were
  // read off the focused tab alone, so attaching a source member and then reading the README — or
  // asking about three files at once, which is the normal way to ask about how they fit together —
  // sent the model into a dialect it had been told nothing about. The file on screen is a good
  // guess about the subject; the files deliberately put in the conversation are better than a guess.
  for (const item of attached) {
    if (item.kind !== "file" && item.kind !== "selection" && item.kind !== "member") continue;
    sources.push({ path: item.label.replace(/:\d+(?:-\d+)?$/, ""), text: item.body.slice(0, 20_000) });
  }

  const seen = new Set<string>();
  const notes: string[] = [];
  for (const source of sources) {
    const lang = detectIbmiLanguage(source.path, source.text, { onIbmi });
    if (!lang || seen.has(lang.id)) continue;
    seen.add(lang.id);
    notes.push(ibmiPrompt(lang));
    // Two at most. Each of these is a paragraph of rules and, for a fixed-format dialect, a column
    // ruler — the most expensive lines in the whole prompt. A conversation holding five dialects at
    // once is a conversation where none of them is the subject.
    if (notes.length === 2) break;
  }
  return notes.length ? `\n\n${notes.join("\n\n")}` : "";
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

/**
 * What the clipboard gave us, as an attachment.
 *
 * The transcript gets a SENTENCE about the image — its name and its size — and never the base64,
 * which would be unreadable in the record, counted as text by every budget, and written to disk
 * with the history. The bytes ride separately, on the message, and go no further than the request.
 */
function pastedContext(
  m: { name: string; text?: string; mediaType?: string; data?: string; width?: number; height?: number },
  maxTokens: number,
): ContextItem | undefined {
  if (m.data && m.mediaType?.startsWith("image/")) {
    const kb = Math.round((m.data.length * 3) / 4 / 1024);
    const size = m.width && m.height ? `${m.width}×${m.height}, ${kb} kB` : `${kb} kB`;
    return {
      kind: "image",
      label: m.name || t("pasted image"),
      body: `[${t("image")}: ${m.name || t("pasted image")} — ${size}]`,
      image: { mediaType: m.mediaType, data: m.data },
    };
  }
  const text = (m.text ?? "").trim();
  if (!text) return undefined;
  return {
    kind: "paste",
    label: m.name || t("pasted text"),
    body: headToTokens(text, maxTokens),
    // Pasted text was written by somebody else — a log, a page, a colleague's message — so it goes
    // behind the same fence as a file the agent read. The fence is the whole reason an attachment
    // cannot give the model instructions.
    untrusted: true,
  };
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
  const resolved = normalize(absolute);
  return resolved === root || resolved.startsWith(`${root}/`);
}

/** Collapse `.` and `..` without touching the filesystem — the path may not exist yet. */
function normalize(path: string): string {
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
