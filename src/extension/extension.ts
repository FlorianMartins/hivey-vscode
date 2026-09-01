// Activation. Everything the extension can do is registered here and nowhere else, so the list of
// its capabilities is one file long and a reviewer can read it in a minute.

import * as vscode from "vscode";
import { setLanguage, t } from "../shared/i18n.js";
import { Budget } from "../core/router/budget.js";
import { isLocalEndpoint } from "../core/redaction/index.js";
import { ChatViewProvider, PreviewProvider } from "./chat.js";
import { HiveyCodeActions } from "./codeActions.js";
import { InlineCompletionProvider } from "./completion.js";
import { Keys, endpointFor, providerFor, readSettings, SECTION, writeTarget } from "./config.js";
import { EgressGate, WorkspaceSpendStore, safeHost } from "./egress.js";
import { registerEditorCommands } from "./editorCommands.js";
import { showEgressReport, showCostReport } from "./reports.js";
import { WorkspaceContext } from "./workspace.js";
import { McpManager } from "./integrations/mcp.js";
import { watchInstructions } from "./instructions.js";
import { createDefinition, DefinitionStore } from "./definitions.js";

export function activate(context: vscode.ExtensionContext): void {
  // The editor knows which language the user reads, unless they said otherwise.
  const applyLanguage = () => {
    const choice = readSettings().language;
    setLanguage(choice === "auto" ? vscode.env.language : choice);
  };
  applyLanguage();
  const log = vscode.window.createOutputChannel("Hivey Code");
  const keys = new Keys(context.secrets);
  const disposables: vscode.Disposable[] = [];
  const workspace = new WorkspaceContext(disposables);
  watchInstructions(disposables);
  const budget = new Budget(new WorkspaceSpendStore(context.globalState), readSettings().budget);
  const gate = new EgressGate(context.globalState, budget);

  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  const completion = new InlineCompletionProvider(keys, status, log);
  completion.updateStatus(readSettings());

  // MCP servers are started after activation, never during it: a slow or hanging server must not
  // be able to delay the editor's startup, and a server nobody has trusted yet must not run at all.
  const mcp = new McpManager(context, context.extension.packageJSON.version as string);
  void mcp.startAll();
  // Awaited in `deactivate`, not fired and forgotten in a `dispose`. See the note there.
  pendingShutdown = () => mcp.stopAll();

  // Skills and sub-agents the repository defines. Watched, so an edit takes effect on the next
  // turn rather than on the next window.
  const definitions = new DefinitionStore(disposables);

  const chat = new ChatViewProvider(context, keys, workspace, gate, log, mcp, definitions);

  context.subscriptions.push(
    log,
    status,
    ...disposables,
    vscode.window.registerWebviewViewProvider(ChatViewProvider.viewId, chat, { webviewOptions: { retainContextWhenHidden: true } }),
    // The same provider serves the right-hand bar's copy. One state, two windows onto it.
    vscode.window.registerWebviewViewProvider(ChatViewProvider.sideViewId, chat, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
    vscode.languages.registerInlineCompletionItemProvider({ pattern: "**" }, completion),
    vscode.workspace.registerTextDocumentContentProvider("hivey-code-preview", new PreviewProvider()),

    vscode.workspace.onDidChangeConfiguration((e) => {
      if (!e.affectsConfiguration(SECTION)) return;
      if (e.affectsConfiguration(`${SECTION}.language`)) {
        applyLanguage();
        // The panel's strings were built in the old language; rebuilding its HTML reloads it.
        chat.reload();
      }
      // The width floor lives in a style attribute on <body>, which is written once when the HTML
      // is built. Without this the setting appears to do nothing until the window is reloaded.
      if (e.affectsConfiguration(`${SECTION}.panel.minWidth`)) chat.reload();
      const s = readSettings();
      budget.setLimits(s.budget);
      completion.invalidateProvider();
      completion.updateStatus(s);
    }),

    vscode.commands.registerCommand("hiveyCode.newSession", () => chat.newSession()),
    vscode.commands.registerCommand("hiveyCode.completionAccepted", () => completion.noteAccepted()),

    vscode.commands.registerCommand("hiveyCode.toggleCompletions", async () => {
      const config = vscode.workspace.getConfiguration(SECTION);
      const next = !config.get<boolean>("completion.enabled", true);
      await config.update("completion.enabled", next, vscode.ConfigurationTarget.Global);
      completion.updateStatus(readSettings());
    }),

    vscode.commands.registerCommand("hiveyCode.setApiKey", async () => {
      const provider = await vscode.window.showQuickPick(
        [
          { label: "openrouter", detail: t("Multi-model gateway") },
          { label: "anthropic", detail: t("Claude API") },
          { label: "openai-compatible", detail: t("Internal gateway, Azure, LiteLLM…") },
          { label: "local", detail: t("A local server that requires a key (rare)") },
        ],
        { placeHolder: t("Which provider?") },
      );
      if (!provider) return;
      const key = await vscode.window.showInputBox({
        prompt: t("Key for {0}. It is stored in the system keychain, never in the settings.", provider.label),
        password: true,
        ignoreFocusOut: true,
      });
      if (!key) return;
      await keys.store(provider.label as never, key);
      completion.invalidateProvider();
      void vscode.window.showInformationMessage(t("Hivey Code: {0} key stored in the keychain.", provider.label));
    }),

    vscode.commands.registerCommand("hiveyCode.exportSession", () => chat.exportSession()),
    vscode.commands.registerCommand("hiveyCode.moveToSecondarySideBar", async () => {
      // VS Code owns where a view container lives, and no API moves one. What exists is
      // `moveFocusedView`, which opens the editor's own destination picker — every placement it
      // supports, in its own words, in whatever language it is running in. Reimplementing that list
      // would mean maintaining a copy of it.
      //
      // The panel is declared in the activity bar, which is a DEFAULT rather than a restriction:
      // the editor remembers where it is put, so this is a one-time move, not a mode.
      await chat.reveal();
      await vscode.commands.executeCommand("workbench.action.moveFocusedView");
      void vscode.window.setStatusBarMessage(t("Pick where the panel should live — it stays there."), 6000);
    }),

    // The language, one command away rather than buried in a settings search. The setting existed
    // and followed the editor, which is right by default and wrong for the person whose editor is in
    // one language and who reads another — a common enough arrangement that hunting for it in the
    // settings page was a poor answer.
    vscode.commands.registerCommand("hiveyCode.setLanguage", async () => {
      const current = readSettings().language;
      const picked = await vscode.window.showQuickPick(
        [
          { label: t("Follow the editor"), detail: t("Whatever VS Code is displaying in"), id: "auto" },
          { label: "English", detail: t("Always English"), id: "en" },
          { label: "Français", detail: t("Always French"), id: "fr" },
        ].map((row) => ({ ...row, description: row.id === current ? t("current") : "" })),
        { placeHolder: t("Which language should Hivey Code use?") },
      );
      if (!picked) return;
      await vscode.workspace
        .getConfiguration(SECTION)
        .update("language", picked.id, vscode.ConfigurationTarget.Global);
      applyLanguage();
      chat.reload();
      void vscode.window.showInformationMessage(t("Language changed. Reopen a panel if a title still shows the old one."));
    }),

    vscode.commands.registerCommand("hiveyCode.openSettings", () =>
      vscode.commands.executeCommand("workbench.action.openSettings", SECTION),
    ),
    vscode.commands.registerCommand("hiveyCode.searchConversation", async () => {
      await chat.reveal();
      chat.openSearch();
    }),
    vscode.commands.registerCommand("hiveyCode.newSkill", () => createDefinition("skill")),
    vscode.commands.registerCommand("hiveyCode.newAgent", () => createDefinition("agent")),
    vscode.commands.registerCommand("hiveyCode.showDefinitions", async () => {
      const found = await definitions.load();
      const items = [
        ...found.skills.map((s) => ({ label: `$(sparkle) /${s.name}`, description: s.description, detail: s.source })),
        ...found.agents.map((a) => ({ label: `$(person) ${a.name}`, description: a.description, detail: a.source })),
        ...found.problems.map((p) => ({ label: `$(error) ${p.split(":")[0]}`, description: p, detail: p.split(":")[0] })),
      ];
      if (!items.length) {
        const make = t("Create a skill");
        const answer = await vscode.window.showInformationMessage(
          t("This repository defines no skills or sub-agents."),
          make,
        );
        if (answer === make) await createDefinition("skill");
        return;
      }
      const picked = await vscode.window.showQuickPick(items, {
        placeHolder: t("Skills and sub-agents defined in this repository. Pick one to open it."),
        matchOnDescription: true,
      });
      const folder = vscode.workspace.workspaceFolders?.[0];
      if (picked?.detail && folder) {
        await vscode.window.showTextDocument(vscode.Uri.joinPath(folder.uri, picked.detail));
      }
    }),

    vscode.commands.registerCommand("hiveyCode.setup", async () => {
      await chat.reveal();
      chat.openSetup();
    }),

    vscode.commands.registerCommand("hiveyCode.showMcp", async () => {
      const rows = await mcp.status();
      if (!rows.length) {
        const configure = t("Open the settings");
        const answer = await vscode.window.showInformationMessage(
          t("No MCP server is configured."),
          { detail: t("Declare one in hiveyCode.mcp.servers, or in a .vscode/mcp.json in this workspace."), modal: false },
          configure,
        );
        if (answer === configure) void vscode.commands.executeCommand("workbench.action.openSettings", "hiveyCode.mcp.servers");
        return;
      }
      const picked = await vscode.window.showQuickPick(
        rows.map((r) => ({
          label: `${r.running ? "$(pass-filled)" : r.error ? "$(error)" : "$(circle-outline)"} ${r.name}`,
          description: r.running ? t("{0} tools", r.toolCount) : r.trusted ? t("not started") : t("waiting for your approval"),
          detail: r.error ? `${r.target} — ${r.error}` : r.target,
          row: r,
        })),
        { placeHolder: t("MCP servers. Pick one to start it or restart it."), matchOnDetail: true },
      );
      if (!picked) return;
      await mcp.restart();
      void vscode.window.showInformationMessage(t("MCP servers restarted."));
    }),

    vscode.commands.registerCommand("hiveyCode.restartMcp", async () => {
      await mcp.restart();
      const running = (await mcp.status()).filter((r) => r.running).length;
      void vscode.window.showInformationMessage(t("{0} MCP server(s) connected.", running));
    }),

    vscode.commands.registerCommand("hiveyCode.setArcadCredentials", async () => {
      const user = await vscode.window.showInputBox({ prompt: t("IBM i user profile for the ARCAD Elias server") });
      if (!user) return;
      const password = await vscode.window.showInputBox({ prompt: t("Password"), password: true });
      if (!password) return;
      await keys.storeArcad(user, password);
      void vscode.window.showInformationMessage(t("ARCAD credentials stored in the system keychain."));
    }),

    vscode.commands.registerCommand("hiveyCode.clearArcadCredentials", async () => {
      await keys.clearArcad();
      void vscode.window.showInformationMessage(t("ARCAD credentials cleared."));
    }),

    vscode.commands.registerCommand("hiveyCode.clearApiKey", async () => {
      const provider = await vscode.window.showQuickPick(["openrouter", "anthropic", "openai-compatible", "local"], {
        placeHolder: t("Which key to clear?"),
      });
      if (!provider) return;
      await keys.delete(provider as never);
      completion.invalidateProvider();
      void vscode.window.showInformationMessage(t("{0} key cleared.", provider));
    }),

    // The chat model is chosen in the panel, where prices can be compared side by side; this
    // command survives for muscle memory and opens that screen.
    // Opens the picker in place rather than navigating to the comparison screen: from the command
    // palette the user wants to change model, not to read a table of four hundred of them.
    vscode.commands.registerCommand("hiveyCode.pickModel", async () => {
      await chat.reveal();
      chat.openModelPicker();
    }),

    // The completion model is a different decision — it is asked on every pause in typing — and a
    // quick pick over what the endpoint actually serves is the right shape for it.
    vscode.commands.registerCommand("hiveyCode.pickCompletionModel", async () => {
      const s = readSettings();
      const id = s.completion.provider === "off" ? "local" : s.completion.provider;
      let models: string[] = [];
      try {
        const provider = await providerFor(s, keys, id);
        models = await vscode.window.withProgress(
          { location: vscode.ProgressLocation.Notification, title: t("Hivey Code: models served by {0}…", id) },
          () => provider.listModels(),
        );
      } catch (err) {
        void vscode.window.showErrorMessage(t("Cannot list the models: {0}", (err as Error).message));
        return;
      }
      const picked = await vscode.window.showQuickPick(models, {
        placeHolder: t("Inline completion model — a code model that supports fill-in-the-middle"),
      });
      if (!picked) return;
      await vscode.workspace.getConfiguration(SECTION).update("completion.model", picked, writeTarget());
      completion.invalidateProvider();
      completion.updateStatus(readSettings());
    }),

    vscode.commands.registerCommand("hiveyCode.showHistory", () => chat.show("history")),
    vscode.commands.registerCommand("hiveyCode.showModels", () => chat.show("models")),
    vscode.commands.registerCommand("hiveyCode.showPermissions", () => chat.show("permissions")),
    vscode.commands.registerCommand("hiveyCode.showEgress", () => showEgressReport(gate, readSettings())),
    vscode.commands.registerCommand("hiveyCode.showCosts", () => showCostReport(gate, readSettings())),

    vscode.commands.registerCommand("hiveyCode.indexWorkspace", async () => {
      await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: t("Hivey Code: mapping the repository…") },
        async () => {
          workspace.invalidate();
          const map = await workspace.repoMap(readSettings().context.maxTokens, true);
          void vscode.window.showInformationMessage(
            map
              ? t("Repository map: {0} files, {1} omitted (token budget).", map.files, map.omitted)
              : t("No folder is open."),
          );
        },
      );
    }),
  );

  registerEditorCommands(context, { chat, keys, workspace, log, extensionUri: context.extensionUri });

  // Quick fixes are registered for every file: the diagnostics come from whichever language server
  // the user already has, so there is no list of supported languages to keep up to date.
  context.subscriptions.push(
    vscode.languages.registerCodeActionsProvider({ pattern: "**" }, new HiveyCodeActions(), {
      providedCodeActionKinds: HiveyCodeActions.kinds,
    }),
  );

  // Tell the user, once, where their data is going. An assistant that is quiet about this is
  // asking to be uninstalled by a security team.
  void announce(context, log);
}

async function announce(context: vscode.ExtensionContext, log: vscode.OutputChannel): Promise<void> {
  const s = readSettings();
  let chatUrl = "";
  try {
    chatUrl = endpointFor(s, s.chat.provider);
  } catch {
    /* not configured yet */
  }
  const local = chatUrl ? isLocalEndpoint(chatUrl) : true;
  log.appendLine(
    `[activation] chat=${s.chat.provider} (${chatUrl || "not configured"}, ${local ? "local" : "remote"}) ` +
      `completion=${s.completion.provider} redaction=${s.privacy.redaction} language=${vscode.env.language}`,
  );
  const KEY = "hiveyCode.announced";
  if (context.globalState.get<boolean>(KEY)) return;
  await context.globalState.update(KEY, true);
  const choice = await vscode.window.showInformationMessage(
    local
      ? t("Hivey Code is active. Everything stays on your machine: completion and chat talk to your local server.")
      : t(
          "Hivey Code is active. Chat uses {0}; what leaves is pseudonymised and will be shown to you before the first request.",
          safeHost(chatUrl),
        ),
    t("Open the settings"),
    t("Got it"),
  );
  if (choice === t("Open the settings")) {
    await vscode.commands.executeCommand("workbench.action.openSettings", SECTION);
  }
}

/**
 * What activation started and a `dispose()` cannot finish.
 *
 * `vscode.Disposable.dispose()` is synchronous: the editor calls it and moves on. Stopping an MCP
 * server is not — it is a child process that has to be signalled and waited for. Registering it as
 * a disposable, which is what this did, meant the editor tore the extension down while stdio
 * children were still alive, and an extension host with live children does not finish unloading —
 * which is what "I uninstalled it and the panel is still there until I restart" looks like from the
 * outside.
 *
 * `deactivate` may return a promise, and the editor awaits it. That is the hook for anything with a
 * real shutdown, so that is where this belongs.
 */
let pendingShutdown: (() => Promise<void>) | undefined;

export async function deactivate(): Promise<void> {
  await pendingShutdown?.();
  pendingShutdown = undefined;
}
