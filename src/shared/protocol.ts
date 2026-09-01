// The only vocabulary the panel and the extension share. Imported by both sides, so a message one
// sends and the other does not understand is a compile error rather than a silent no-op.

export type Mode = "chat" | "plan" | "agent";
export type Reasoning = "none" | "low" | "medium" | "high";
export type Screen = "chat" | "history" | "models" | "permissions" | "setup";

export interface UiContextItem {
  kind: string;
  label: string;
  /** Tokens the item costs, so the user can see what their context is worth before sending. */
  tokens: number;
}

export interface UiStep {
  tool: string;
  summary: string;
  ok: boolean;
}

export interface UiEntry {
  id: string;
  role: "user" | "assistant";
  text: string;
  at: number;
  included: boolean;
  pinned?: boolean;
  error?: string;
  model?: string;
  usdCost?: number;
  /** Number of files this question's checkpoint can put back. Zero means there is nothing to restore. */
  checkpointFiles?: number;
  /** True when the checkpoint could not hold everything the turn changed. */
  checkpointPartial?: boolean;
  /** The to-do list the agent kept while answering this turn. */
  plan?: Plan;
  /** What the model thought before answering, when a reasoning effort was asked for. */
  reasoning?: string;
  context?: UiContextItem[];
  steps?: UiStep[];
}

export interface UiSession {
  id: string;
  title: string;
  mode: Mode;
  entries: UiEntry[];
}

export interface UiHistoryRow {
  id: string;
  title: string;
  updatedAt: number;
  createdAt: number;
  messages: number;
  usdCost: number;
  mode: Mode;
  excerpt?: string;
}

export interface UiHistoryFilter {
  query: string;
  period: "all" | "today" | "week" | "month";
  mode: Mode | "all";
  paidOnly: boolean;
  sort: "updated" | "created" | "messages" | "cost";
}

export interface UiModel {
  id: string;
  name: string;
  vendor: string;
  /** Context window in tokens, 0 when unknown. */
  context: number;
  /** USD per million tokens. Both zero means free — or local, which is the same thing here. */
  inUsd: number;
  outUsd: number;
  cachedInUsd: number;
  provider: string;
  /** True when this endpoint runs on the user's own machine or network. */
  local: boolean;
  /**
   * True only for this machine. `local` covers the office GPU box too, and the picker separates
   * them: one works on a train, the other is somebody else's to switch off.
   */
  loopback?: boolean;
  /** Which server serves it — "Ollama", "LM Studio", the name the user gave their own. */
  server?: string;
  /** The address that serves it, so choosing the model can also point the extension at it. */
  baseUrl?: string;
  /** True when the model is currently selected for the chat role. */
  current?: boolean;
}

export interface UiPermissionRule {
  tool: string;
  prefix?: string;
  level: "always" | "never";
  /** Session grants are listed too, marked as temporary. */
  session?: boolean;
}

/** A model server found running on this machine. */
import type { Plan } from "../core/agent/plan.js";

/** A skill in the panel's own terms: what to call it, and whether it is on. */
export interface UiSkill {
  /** The invocation, `/` included — the join key between the toggle, the setting and the prompt. */
  name: string;
  description: string;
  enabled: boolean;
  /** False for one the repository defines, which is also the one that can be opened and shared. */
  builtin: boolean;
  /** Where a repository skill lives, relative to the workspace. */
  source?: string;
  /** True for a control that cannot be switched off, such as compacting. */
  required?: boolean;
}

export interface UiRuntime {
  name: string;
  baseUrl: string;
  models: string[];
  /** The command that would install a sensible model, when the server is running but empty. */
  suggestion?: string;
}

export interface UiSetup {
  probing: boolean;
  /** Empty after a probe means nothing is listening — which is information, not a failure. */
  runtimes: UiRuntime[];
  /** Which providers already have a key in the OS keychain. Never the keys themselves. */
  hasKey: Record<string, boolean>;
  /** The configured base URL per provider, so a gateway shows the address it will actually use. */
  endpoints: Record<string, string>;
  /** What the extension is configured to use right now, so the screen can show it as done. */
  configured?: { provider: string; model: string; baseUrl: string };
}

/** The standing policy: how much runs without asking, and what was listed by hand. */
export interface UiApprovalPolicy {
  scope: "off" | "workspace" | "all";
  allowedPaths: string[];
  allowedCommands: string[];
  deniedPaths: string[];
  deniedCommands: string[];
}

/** What the editor is showing right now, so the context menu can name it rather than guess. */
export interface UiActiveEditor {
  path: string;
  /** True when text is selected — which is what makes "the file" and "the selection" two things. */
  hasSelection: boolean;
  /** Lines the selection covers, for the label. */
  selectedLines: number;
}

export interface UiOpenFile {
  path: string;
  active: boolean;
  language: string;
  dirty: boolean;
}

export interface UiState {
  screen: Screen;
  session: UiSession;
  mode: Mode;
  reasoning: Reasoning;
  /** True when the selected chat model can think — drives whether the control is offered. */
  reasoningAvailable: boolean;
  model: string;
  modelLabel: string;
  provider: string;
  remote: boolean;
  contextTokens: number;
  budget: { spentTodayUsd: number; dailyUsd: number };
  /** What THIS conversation has cost so far. Distinct from the day's spend, which spans all of them. */
  sessionCostUsd: number;
  /** Every skill the panel may offer, and whether the user has left it switched on. */
  skills: UiSkill[];
  /**
   * The most recent conversations, unfiltered.
   *
   * Distinct from `history`, which the history screen's own filters narrow. A menu elsewhere in
   * the panel that quietly inherited those filters would show a short list with no explanation of
   * why the conversation being looked for is missing.
   */
  recent: Array<{ id: string; title: string; messages: number }>;
  attachments: UiContextItem[];
  openFiles: UiOpenFile[];
  activeEditor?: UiActiveEditor;
  history: UiHistoryRow[];
  historyFilter: UiHistoryFilter;
  models: UiModel[];
  modelsLoading: boolean;
  permissions: UiPermissionRule[];
  policy: UiApprovalPolicy;
  /** Entry ids matching the in-conversation search, in document order. */
  matches: string[];
  searchQuery: string;
  setup: UiSetup;
  /**
   * True when the conversation is long enough that summarising it is worth offering.
   *
   * Computed by the extension, which is the only side that knows the model's context window. The
   * panel drawing this from its own token count would be guessing at a number it does not have.
   */
  suggestCompact: boolean;
  /** How much of the model's context the conversation currently occupies, 0–1, for the meter. */
  contextFill: number;
}

/** Panel → extension. */
export type ToExtension =
  | { type: "ready" }
  | { type: "send"; text: string }
  | { type: "stop" }
  | { type: "newSession" }
  | { type: "renameSession"; title: string }
  | { type: "openScreen"; screen: Screen }
  | { type: "openSession"; id: string }
  /** Attach an earlier conversation to the current one instead of leaving for it. */
  | { type: "useSessionAsContext"; id: string }
  | { type: "deleteSession"; id: string }
  /** Replace the conversation so far with a summary the model writes. */
  | { type: "compact" }
  | { type: "setSkillEnabled"; name: string; enabled: boolean }
  /** Put the repository's skills where a colleague can be given them. */
  | { type: "shareSkills" }
  | { type: "openSkill"; source: string }
  | { type: "newSkill" }
  /** Open the editor's own picker for adding context — a native quick pick, not a webview menu. */
  | { type: "openContextPicker" }
  /** Open the editor's own picker for switching skills on and off. */
  | { type: "openToolsPicker" }
  | { type: "setProvider"; provider: string }
  /** Put the files back as they were before this question, and rewind the conversation to it. */
  | { type: "restoreCheckpoint"; id: string }
  | { type: "setMode"; mode: Mode }
  | { type: "setReasoning"; reasoning: Reasoning }
  /** `baseUrl` accompanies a model served by a machine other than the configured one. */
  | { type: "setModel"; model: string; provider: string; baseUrl?: string }
  | { type: "refreshModels" }
  | { type: "setHistoryFilter"; filter: Partial<UiHistoryFilter> }
  | { type: "search"; query: string }
  | { type: "setIncluded"; id: string; included: boolean }
  | { type: "setPinned"; id: string; pinned: boolean }
  | { type: "dropEntry"; id: string }
  | { type: "editEntry"; id: string; text: string }
  | { type: "retry" }
  | { type: "attach"; what: "active" | "editor" | "selection" | "browse" | "openFiles" | "mention" }
  | { type: "attachPath"; path: string }
  | { type: "removeAttachment"; label: string }
  | { type: "setPermission"; tool: string; prefix?: string; level: "always" | "never" }
  | { type: "forgetPermission"; tool: string; prefix?: string }
  | { type: "clearSessionPermissions" }
  | { type: "setApprovalScope"; scope: "off" | "workspace" | "all" }
  | { type: "openEgress" }
  | { type: "openCosts" }
  | { type: "openSettings" }
  | { type: "approve"; id: string; answer: "once" | "session" | "always" | "no" }
  /** `atCursor` inserts at the caret; without it the selection is replaced. */
  | { type: "insertCode"; code: string; atCursor?: boolean }
  | { type: "applyCode"; code: string; language: string }
  | { type: "copy"; text: string }
  // ── First run ──────────────────────────────────────────────────────────────────────────────
  | { type: "probeLocal" }
  /** The key never travels back to the panel; it goes straight to the OS keychain. */
  | { type: "saveKey"; provider: string; key: string }
  | { type: "clearKey"; provider: string }
  | { type: "setEndpoint"; provider: string; url: string }
  /** Declare a model server on this machine or this network, and probe it. */
  | { type: "addServer"; name: string; url: string }
  | { type: "useLocal"; baseUrl: string; model: string }
  | { type: "finishSetup" }
  | { type: "openExternal"; url: string };

/** Extension → panel. */
export type ToPanel =
  | { type: "state"; state: UiState }
  | { type: "delta"; text: string }
  | { type: "reasoning"; text: string }
  | { type: "status"; text: string; tool?: string; ok?: boolean }
  | { type: "turnStart" }
  | { type: "turnEnd" }
  | {
      type: "approval";
      id: string;
      tool: string;
      description: string;
      command?: string;
      /** Which answers to offer. Defaults to all four; egress consent has no "this session". */
      choices?: Array<"once" | "session" | "always" | "no">;
      /** Extra lines under the question — what was pseudonymised, what it will cost. */
      detail?: string[];
    }
  | { type: "error"; message: string }
  /** Opens the model picker from outside the panel — the command palette, a keybinding. */
  | { type: "openModelPicker" }
  /** Opens the in-conversation search from outside the panel — the title bar, a keybinding. */
  | { type: "openSearch" }
  /** Put text back into the composer — a restored question, ready to be asked differently. */
  | { type: "restoreDraft"; text: string }
  /** The agent's plan, as it is written. Redrawn in place rather than appended. */
  | { type: "plan"; plan: Plan };
