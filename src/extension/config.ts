// Settings, keys, and the providers they produce.
//
// Two rules this file exists to enforce:
//   • an API key is never a setting. Settings sync to a Microsoft account, appear in
//     `settings.json`, and get committed by accident. Keys live in SecretStorage, which is the
//     OS keychain, and the only way to set one is the command that prompts for it.
//   • the endpoint decides what is local, not the setting name. Someone who points the "local"
//     provider at a public URL gets redaction and consent like any other remote provider.

import { SHIPPED_LIMITS } from "../core/router/budget.js";
import type { DictationSettings } from "../core/dictation/dictation.js";
import * as vscode from "vscode";
import { allowedEndpoint, applyPolicy, featureDisabled } from "../core/policy/policy.js";
import { policyState } from "./policy.js";
import { t } from "../shared/i18n.js";
import { DEFAULT_WHISPER_MODEL } from "../core/dictation/local.js";
import { DEFAULT_GROUPS, type SkillGroup, type SkillPolicy } from "../core/session/skills.js";
import { makeProvider, type Provider, type ProviderId } from "../core/providers/index.js";
import { defaultEndpoints, endpointSettingKey, REMOTE_VENDORS, vendor } from "../core/providers/vendors.js";
import { isLocalEndpoint } from "../core/redaction/index.js";
import { checkEndpoint, describeMissingEndpoint, describeUnusableEndpoint, looksLikeApiKey } from "../core/providers/endpoint.js";
import { ATTACHMENT_CEILING_TOKENS } from "../core/util/tokens.js";
import type { RedactionLevel, RedactionPolicy } from "../core/redaction/types.js";
import type { EscalationPolicy, RouterConfig } from "../core/router/route.js";

export const SECTION = "hiveyCode";

export interface Settings {
  /** `auto` follows the editor; a fixed tag lets someone read the editor in one language and this
   *  extension in another — which is more common than it sounds on shared machines. */
  language: "auto" | "en" | "fr";
  chat: {
    provider: ProviderId;
    model: string;
    /** How many tokens one answer may be. A thinking model spends this on its thinking too. */
    maxOutputTokens: number;
    /** Ask for Anthropic's prompt cache through OpenRouter. Off: it changes the request's shape. */
    promptCache: boolean;
  };
  /** Speaking instead of typing. Off until configured — see `core/dictation/dictation.ts`. */
  dictation: DictationSettings;
  /** Whether the panel takes the editor's colours or Hivey's own. See `media/style.css`. */
  appearance: "editor" | "hivey";
  completion: {
    provider: ProviderId | "off";
    model: string;
    enabled: boolean;
    debounceMs: number;
    maxTokens: number;
    multiline: boolean;
    /** Offer the edit that follows the one just made, elsewhere in the file. */
    nextEdit: boolean;
    /** Allow it on a paid endpoint. Off by default: it fires on every pause in typing. */
    nextEditRemote: boolean;
  };
  endpoints: Record<ProviderId, string>;
  /** Extra model servers, on this machine or on the operator's network. Probed, never assumed. */
  servers: Array<{ name: string; url: string }>;
  privacy: {
    redaction: RedactionLevel;
    allowUnredacted: boolean;
    blockedGlobs: string[];
    egressPolicy: "ask-once" | "ask-always" | "trust";
    /** Whether each question is previewed with its size and price before it is sent. */
    confirmSend: "always" | "never";
    auditLog: boolean;
    customTerms: string[];
  };
  budget: { perRequestUsd: number; dailyUsd: number; perRequestTokens: number };
  /** Whether an answer may carry a "To know" note. See `core/session/notices.ts`. */
  notices: { enabled: boolean };
  context: {
    /** The user's figure when they set one, `undefined` when the budget is derived from the model. */
    maxTokens: number | undefined;
    /** The most one attached file may take, whatever the budget. 0 = no ceiling. */
    attachmentTokens: number;
    repoMap: boolean;
  };
  knowledge: {
    enabled: boolean;
    /** Extra folders of documentation to READ, as absolute paths. Never written to. */
    folders: string[];
    scope: "project" | "personal" | "both";
    /** A base served over HTTP. Empty means the files on this machine. */
    endpoint: string;
    /** Ceiling for the list of titles that rides on every turn. */
    indexTokens: number;
  };
  /**
   * Whether the IBM i surface is offered at all.
   *
   * `auto` is a connection, not an installation: on a machine where nobody uses the platform there
   * is nothing to see, and on one where somebody does, the entries appear when they can actually
   * work. `on` is for the case `auto` cannot cover — wanting the rows visible while disconnected,
   * to be told to connect rather than to wonder where they went.
   */
  ibmi: {
    integration: "auto" | "on" | "off";
    /**
     * Libraries the agent may change. Empty means the gate is off.
     *
     * Not a default this ships with: a default would be one company's library names handed to
     * everybody else's. See `core/ibmi/guard.ts` for what it refuses and why it refuses an
     * unqualified command.
     */
    writableLibraries: string[];
  };
  /**
   * Which families are in play, which individual skills are off inside them, and whether the open
   * files are allowed to bring a family in by themselves.
   */
  skills: SkillPolicy & { auto: boolean };
  /** Which sub-agents the user has switched off, by name. */
  agents: { disabled: string[] };
  panel: { minWidth: number };
  permissions: {
    /** How much runs without asking. `off` is the default and the right one for a first session. */
    autoApprove: "off" | "workspace" | "all";
    allowedPaths: string[];
    allowedCommands: string[];
    deniedPaths: string[];
    deniedCommands: string[];
  };
  escalation: { policy: EscalationPolicy; provider: ProviderId; model: string };
}

function readEndpoints(c: vscode.WorkspaceConfiguration): Record<ProviderId, string> {
  const defaults = defaultEndpoints();
  const out = { local: c.get<string>("endpoints.local", defaults.local) } as Record<ProviderId, string>;
  for (const v of REMOTE_VENDORS) out[v.id] = c.get<string>(endpointSettingKey(v.id), v.baseUrl);
  return out;
}

/**
 * A setting the user has actually set, as opposed to one the manifest supplies a default for.
 *
 * `inspect` is the only way to tell those apart, and the difference matters wherever the code wants
 * to compute a better answer than the manifest can: a manifest default is one number for everybody,
 * and it cannot depend on the model that happens to be selected.
 */
function explicit<T>(c: vscode.WorkspaceConfiguration, key: string): T | undefined {
  const found = c.inspect<T>(key);
  return found?.workspaceFolderValue ?? found?.workspaceValue ?? found?.globalValue;
}

/**
 * A key pasted where the address goes, put where it belongs — without asking.
 *
 * There is no setting for an API key, and that is the right decision: keys live in the editor's
 * secret store. It has one consequence nobody designed for. A person who opens the settings looking
 * for somewhere to put their key finds exactly one box carrying their provider's name, and it is
 * the address. They paste it there, nothing works, and until this release the explanation was a
 * sentence instructing them to write `https://` in front of their key.
 *
 * Done rather than offered, because the user's instruction was that entering a key should be the
 * whole of the work: "he only has to enter the API keys of the providers he wants to use". A
 * confirmation dialog here is a question with one answer, asked of somebody who has already told us
 * what they meant by typing a key into a box.
 *
 * It is also strictly safer. The value moves OUT of `settings.json` — plain text, synchronised
 * between machines, committed by anyone who versions their editor configuration — and into the
 * secret store. Nothing is lost and nothing is sent anywhere; the address returns to the vendor's
 * own, which is what somebody who never meant to set one should have. It is announced afterwards,
 * because a credential that moves silently is a credential the user cannot find again.
 */
export async function recoverMisplacedKeys(keys: Keys, log?: { appendLine(line: string): void }): Promise<void> {
  const config = vscode.workspace.getConfiguration(SECTION);
  for (const v of REMOTE_VENDORS) {
    const setting = endpointSettingKey(v.id);
    const current = config.get<string>(setting, "");
    if (!looksLikeApiKey(current)) continue;

    // Never logged, even in part: this is a credential, and the log is a file people paste into
    // issues. The setting is named, which is the only part anyone needs in order to understand.
    log?.appendLine(`[setup] ${setting} held a key rather than an address; moved to the secret store`);
    await keys.store(v.id, current);
    // Cleared wherever it was written, and back to nothing — which means the vendor's own address.
    for (const target of [vscode.ConfigurationTarget.Global, vscode.ConfigurationTarget.Workspace, vscode.ConfigurationTarget.WorkspaceFolder]) {
      await config.update(setting, undefined, target).then(undefined, () => undefined);
    }
    void vscode.window.showInformationMessage(
      t("Hivey Code: your {0} key was in the address setting. It has been moved to the secret store — ask your question again.", v.label),
    );
  }
}

/**
 * Put back a gateway address this extension mistook for a key and took away.
 *
 * The repair above used to decide "this is a credential" partly by guessing — no dots, no slashes,
 * long enough. An internal hostname is exactly that, so `llm-gateway-internal-prod-01` was moved
 * into the secret store and erased from the settings, automatically, at every configuration change.
 * The user was then unable to choose their gateway or see its models, and nothing on screen
 * connected either symptom to an address they had typed days earlier.
 *
 * The detector is prefix-only now, so it cannot happen again. This undoes the installations it
 * already happened to, and it is deliberately narrow: only the gateway, which is the only vendor
 * whose address has no default and can therefore be empty, and only when what is stored as its key
 * is a usable address that carries no vendor's prefix. Announced rather than silent — a value
 * moving back is as surprising as a value moving away, and this extension has now done both.
 */
export async function restoreMisplacedGatewayAddress(
  keys: Keys,
  log?: { appendLine(line: string): void },
): Promise<void> {
  const id: ProviderId = "openai-compatible";
  const setting = endpointSettingKey(id);
  const config = vscode.workspace.getConfiguration(SECTION);
  if (config.get<string>(setting, "")) return; // An address is set: nothing was lost.

  const stored = (await keys.get(id))?.trim();
  if (!stored || looksLikeApiKey(stored)) return; // A real key, left where it belongs.
  const check = checkEndpoint(stored);
  if (!check.url) return;

  log?.appendLine(`[setup] ${setting} was empty and its key held an address; putting it back`);
  await config.update(setting, check.url, vscode.ConfigurationTarget.Global);
  await keys.delete(id);
  void vscode.window.showInformationMessage(
    t(
      "Hivey Code: your gateway address had been mistaken for a key and moved to the secret store. It is back in the settings ({0}). If it also needs a key, add it from the setup screen.",
      check.url,
    ),
  );
}

/**
 * The settings, as every feature in this extension reads them.
 *
 * ONE CHOKE POINT. Restricting here is what makes the organisation's policy actually bind, rather
 * than each feature remembering to ask — and "returning the raw settings and checking the policy at
 * the point of use" is the version of this that has a hole in it the first time somebody adds a
 * feature.
 */
export function readSettings(scope?: vscode.Uri): Settings {
  return restrict(readSettingsRaw(scope));
}

/** The settings as the user wrote them, before the organisation's policy narrows them. */
function readSettingsRaw(scope?: vscode.Uri): Settings {
  const c = vscode.workspace.getConfiguration(SECTION, scope);
  const level = c.get<RedactionLevel>("privacy.redaction", "strict");
  const allowUnredacted = c.get<boolean>("privacy.allowUnredacted", false);
  const raw: Settings = {
    // On by default: it sends nothing, it changes nothing, and the things it says are things somebody
    // would want to know. Off is a preference, not a safeguard.
    notices: { enabled: c.get<boolean>("notices.enabled", true) },
    language: c.get<"auto" | "en" | "fr">("language", "auto"),
    chat: {
      provider: c.get<ProviderId>("chat.provider", "local"),
      model: c.get<string>("chat.model", "qwen2.5-coder:7b"),
      promptCache: c.get<boolean>("chat.promptCache", false),
      maxOutputTokens: c.get<number>("chat.maxOutputTokens", 8192),
    },
    appearance: c.get<"editor" | "hivey">("appearance", "editor"),
    dictation: {
      command: c.get<string>("dictation.command", ""),
      endpoint: c.get<string>("dictation.endpoint", ""),
      model: c.get<string>("dictation.model", ""),
      language: c.get<string>("dictation.language", ""),
      localModel: c.get<string>("dictation.localModel", DEFAULT_WHISPER_MODEL),
      recordCommand: c.get<string>("dictation.recordCommand", ""),
    },
    completion: {
      provider: c.get<ProviderId | "off">("completion.provider", "local"),
      model: c.get<string>("completion.model", "qwen2.5-coder:7b"),
      enabled: c.get<boolean>("completion.enabled", true),
      debounceMs: c.get<number>("completion.debounceMs", 220),
      maxTokens: c.get<number>("completion.maxTokens", 128),
      multiline: c.get<boolean>("completion.multiline", true),
      nextEdit: c.get<boolean>("completion.nextEdit", true),
      nextEditRemote: c.get<boolean>("completion.nextEditRemote", false),
    },
    // Read from the vendor table rather than listed here: a provider whose address this function
    // forgot is a provider that silently cannot answer, and the manifest already declares them all.
    // The gateway is the one whose default is empty — its address is the thing the user supplies.
    endpoints: readEndpoints(c),
    // Filtered here rather than at the point of use: a half-written entry in the settings must not
    // become a probe of an empty URL, and every consumer would otherwise have to remember that.
    servers: c
      .get<Array<{ name?: string; url?: string }>>("endpoints.servers", [])
      .filter((x): x is { name: string; url: string } => Boolean(x && typeof x.url === "string" && x.url.trim()))
      .map((x) => ({ name: (x.name || "").trim() || x.url, url: x.url.trim() })),
    privacy: {
      // "off" is only honoured when the user also ticked the box that says they mean it.
      redaction: level === "off" && !allowUnredacted ? "balanced" : level,
      allowUnredacted,
      blockedGlobs: c.get<string[]>("privacy.blockedGlobs", []),
      egressPolicy: c.get<"ask-once" | "ask-always" | "trust">("privacy.egressPolicy", "ask-once"),
      // Distinct from `egressPolicy`, which is about privacy. This is about size and price, applies
      // to a local model too, and is switched off by the card's own "Always" button.
      confirmSend: c.get<"always" | "never">("privacy.confirmSend", "always"),
      auditLog: c.get<boolean>("privacy.auditLog", true),
      customTerms: c.get<string[]>("privacy.customTerms", []),
    },
    budget: {
      // The fallbacks come from the one place that holds the shipped limits, so the panel and the
      // terminal cannot drift apart again — see `SHIPPED_LIMITS`.
      perRequestUsd: c.get<number>("budget.perRequestUsd", SHIPPED_LIMITS.perRequestUsd),
      perRequestTokens: c.get<number>("budget.perRequestTokens", SHIPPED_LIMITS.perRequestTokens),
      dailyUsd: c.get<number>("budget.dailyUsd", SHIPPED_LIMITS.dailyUsd),
    },
    context: {
      // Deliberately NOT `c.get(..., default)`. A default returned as a value cannot be told apart
      // from the same value typed by the user, and the whole point is to derive the budget from the
      // model's window unless someone has actually chosen a figure. See `core/context/budget.ts`.
      maxTokens: explicit<number>(c, "context.maxTokens"),
      attachmentTokens: c.get<number>("context.attachmentTokens", ATTACHMENT_CEILING_TOKENS),
      repoMap: c.get<boolean>("context.repoMap", true),
    },
    knowledge: {
      enabled: c.get<boolean>("knowledge.enabled", false),
      scope: c.get<"project" | "personal" | "both">("knowledge.scope", "both"),
      endpoint: c.get<string>("knowledge.endpoint", ""),
      indexTokens: c.get<number>("knowledge.indexTokens", 1200),
      folders: c.get<string[]>("knowledge.folders", []),
    },
    ibmi: {
      integration: c.get<"auto" | "on" | "off">("ibmi.integration", "auto"),
      writableLibraries: c.get<string[]>("ibmi.writableLibraries", []),
    },
    skills: {
      // What was CHOSEN. What is in play is this plus what the open files imply — `familiesInPlay`,
      // once per conversation. Until it existed this comment claimed families "default to the ones
      // that apply whatever is open", which described the intention and not the code: the default
      // was `general` alone no matter what was on screen. Individual skills inside an active family
      // stay opt-OUT — see `SkillPolicy`.
      groups: c.get<SkillGroup[]>("skills.groups", DEFAULT_GROUPS),
      disabled: c.get<string[]>("skills.disabled", []),
      auto: c.get<boolean>("skills.auto", true),
    },
    agents: { disabled: c.get<string[]>("agents.disabled", []) },
    /**
     * ⚠️⚠️ 320 — and the previous 470 was ALSO measured, which is the lesson.
     *
     * It was derived from the composer row's extent in a 540-pixel capture, and the arithmetic was
     * right. The premise was not: it assumed the row must always have its natural width. The row now
     * drops its labels below 430 px, so it needs far less, and a floor set at 470 did something much
     * worse than being generous — it pushed the page wider than the panel on a normally sized side
     * bar, so EVERY screen was drawn with its right-hand side off the edge. Sentences cut mid-word is
     * what « la page Permissions […] vraiment incomprehensible » actually was.
     *
     * So the floor is no longer about the composer, which now looks after itself. It is about the
     * reading surface: below roughly 320 px a line of prose is too short to read and a code block is
     * nothing but its own scrollbar. It is comfortably under any ordinary side bar width, which is
     * the property the 470 lacked: a floor you can reach by accident is not a floor, it is a bug.
     *
     * Read as a floor on the CONTENT. Nothing here can stop the side bar being dragged narrower — see
     * the integration test that proves the editor offers no way, and `applyMinWidth` in the webview.
     */
    panel: { minWidth: c.get<number>("panel.minWidth", 320) },
    permissions: {
      autoApprove: c.get<"off" | "workspace" | "all">("permissions.autoApprove", "off"),
      allowedPaths: c.get<string[]>("permissions.allowedPaths", []),
      allowedCommands: c.get<string[]>("permissions.allowedCommands", []),
      deniedPaths: c.get<string[]>("permissions.deniedPaths", []),
      deniedCommands: c.get<string[]>("permissions.deniedCommands", []),
    },
    escalation: {
      policy: c.get<EscalationPolicy>("escalation.policy", "ask"),
      provider: c.get<ProviderId>("escalation.provider", "openrouter"),
      model: c.get<string>("escalation.model", ""),
    },
  };
  return raw;
}

/**
 * The user's settings, narrowed by the organisation's policy.
 *
 * `applyPolicy` in `core/policy/` decides WHAT narrows; this maps the result back onto the shape the
 * rest of the extension reads. The mapping is the boring half and it is also where a field gets
 * forgotten, so `managedSettings()` below reports what was decided and the interface shows it.
 */
function restrict(raw: Settings): Settings {
  const state = policyState();
  if (state.kind === "none") return raw;

  const { settings: narrowed } = applyPolicy(
    {
      provider: raw.chat.provider,
      endpoint: raw.endpoints[raw.chat.provider] ?? "",
      escalation: raw.escalation.policy,
      redaction: raw.privacy.redaction,
      allowUnredacted: raw.privacy.allowUnredacted,
      blockedGlobs: raw.privacy.blockedGlobs,
      deniedCommands: raw.permissions.deniedCommands,
      deniedPaths: raw.permissions.deniedPaths,
      autoApprove: raw.permissions.autoApprove,
      writableLibraries: raw.ibmi.writableLibraries,
      budget: raw.budget,
    },
    state,
  );

  const allowed = state.policy.endpoints;
  const endpoints = { ...raw.endpoints };
  if (allowed?.length) {
    // Every address, not only the selected one: a provider the user switches to a minute from now
    // must not reach somewhere the policy forbids.
    for (const id of Object.keys(endpoints) as ProviderId[]) {
      if (endpoints[id] && !allowedEndpoint(endpoints[id], allowed)) endpoints[id] = "";
    }
  }

  return {
    ...raw,
    chat: { ...raw.chat, provider: narrowed.provider as ProviderId },
    endpoints,
    // An extra server is an address like any other, and the policy's list bounds it too.
    servers: allowed?.length ? raw.servers.filter((x) => allowedEndpoint(x.url, allowed)) : raw.servers,
    completion: {
      ...raw.completion,
      enabled: raw.completion.enabled && !featureDisabled(state, "completion"),
    },
    privacy: {
      ...raw.privacy,
      redaction: narrowed.redaction,
      allowUnredacted: narrowed.allowUnredacted,
      blockedGlobs: narrowed.blockedGlobs,
    },
    budget: narrowed.budget,
    notices: raw.notices,
    knowledge: { ...raw.knowledge, enabled: raw.knowledge.enabled && !featureDisabled(state, "knowledge") },
    ibmi: { ...raw.ibmi, writableLibraries: narrowed.writableLibraries },
    permissions: {
      ...raw.permissions,
      autoApprove: narrowed.autoApprove,
      deniedCommands: narrowed.deniedCommands,
      deniedPaths: narrowed.deniedPaths,
    },
    escalation: { ...raw.escalation, policy: narrowed.escalation as EscalationPolicy },
  };
}

/**
 * Which settings the organisation decided, and who it is.
 *
 * The interface needs both: a value the user cannot change has to say WHY, and "managed" with no
 * name attached reads as the product being broken rather than as a policy being in force.
 */
export function managedSettings(): { organisation?: string; keys: string[]; refused?: string } {
  const state = policyState();
  if (state.kind === "none") return { keys: [] };
  const raw = readSettingsRaw();
  const { managed } = applyPolicy(
    {
      provider: raw.chat.provider,
      endpoint: raw.endpoints[raw.chat.provider] ?? "",
      escalation: raw.escalation.policy,
      redaction: raw.privacy.redaction,
      allowUnredacted: raw.privacy.allowUnredacted,
      blockedGlobs: raw.privacy.blockedGlobs,
      deniedCommands: raw.permissions.deniedCommands,
      deniedPaths: raw.permissions.deniedPaths,
      autoApprove: raw.permissions.autoApprove,
      writableLibraries: raw.ibmi.writableLibraries,
      budget: raw.budget,
    },
    state,
  );
  return {
    ...(state.policy.organisation ? { organisation: state.policy.organisation } : {}),
    keys: managed,
    ...(state.kind === "refused" ? { refused: state.why } : {}),
  };
}

export function redactionPolicy(s: Settings): RedactionPolicy {
  return { level: s.privacy.redaction, customTerms: s.privacy.customTerms, blockOnSecret: true };
}

export function routerConfig(s: Settings): RouterConfig {
  return {
    chat: s.chat,
    completion: { provider: s.completion.provider, model: s.completion.model },
    escalateTo: s.escalation.model ? { provider: s.escalation.provider, model: s.escalation.model } : undefined,
    escalation: s.escalation.policy,
    // A 7B model served by Ollama defaults to a 4k window and rarely exceeds 32k in practice.
    localContextTokens: 32000,
  };
}

export function endpointFor(s: Settings, id: ProviderId): string {
  const url = s.endpoints[id];
  if (url) return url;
  // Naming the exact setting, and the screen that fills it in.
  //
  // "Set hiveyCode.endpoints in the settings" named a prefix rather than a key, and said nothing
  // about the panel's own setup screen, which has a field for precisely this. Every other vendor
  // has a default address; this one cannot — it is somebody's own gateway, and nobody can guess
  // where it lives — so it is the one provider where this message is the whole of the instruction
  // somebody gets.
  throw new Error(describeMissingEndpoint(id, SECTION, endpointSettingKey(id)));
}

/**
 * Where a preference should be written.
 *
 * Writing the model choice to the workspace is the right default when there is one: a sensitive
 * repository should be able to pin itself to a local model without imposing that on every other
 * project. But `ConfigurationTarget.Workspace` THROWS when no folder is open — VS Code answers
 * "Unable to write to workspace settings because no workspace is opened" — and a user who launched
 * the editor on a single file, or on nothing at all, then finds that changing model does nothing
 * except raise an error. Which is most of a first try.
 *
 * So the target follows reality rather than intent: the workspace when there is one, the user's own
 * settings when there is not.
 */
export function writeTarget(): vscode.ConfigurationTarget {
  const hasWorkspace = Boolean(vscode.workspace.workspaceFolders?.length || vscode.workspace.workspaceFile);
  return hasWorkspace ? vscode.ConfigurationTarget.Workspace : vscode.ConfigurationTarget.Global;
}

export class Keys {
  constructor(private readonly secrets: vscode.SecretStorage) {}

  private static id(provider: ProviderId): string {
    return `${SECTION}.key.${provider}`;
  }

  get(provider: ProviderId): Thenable<string | undefined> {
    return this.secrets.get(Keys.id(provider));
  }

  store(provider: ProviderId, key: string): Thenable<void> {
    return this.secrets.store(Keys.id(provider), key.trim());
  }

  delete(provider: ProviderId): Thenable<void> {
    return this.secrets.delete(Keys.id(provider));
  }

  /**
   * The ARCAD Elias credentials.
   *
   * Kept here rather than under `arcad.*` in settings.json for the reason every credential in this
   * extension is: settings.json is synchronised between machines and committed by accident, and a
   * password to a change-management server governs what reaches production.
   */
  async arcad(): Promise<{ user: string; password: string } | undefined> {
    const raw = await this.secrets.get(`${SECTION}.arcad`);
    if (!raw) return undefined;
    try {
      return JSON.parse(raw) as { user: string; password: string };
    } catch {
      return undefined;
    }
  }

  storeArcad(user: string, password: string): Thenable<void> {
    return this.secrets.store(`${SECTION}.arcad`, JSON.stringify({ user, password }));
  }

  clearArcad(): Thenable<void> {
    return this.secrets.delete(`${SECTION}.arcad`);
  }
}

/** Build the provider for a role, resolving its endpoint and (if remote) its key. */
export async function providerFor(s: Settings, keys: Keys, id: ProviderId): Promise<Provider> {
  const baseUrl = endpointFor(s, id);
  // Checked here rather than discovered at the socket. An address without a scheme is a relative
  // path to `fetch`, which answers "Invalid URL" — a message that names no cause and suggests no
  // action, on every request, for the life of the setting. Settings arrive from `settings.json`,
  // from synchronisation and from a team's configuration, so they do not all pass the field that
  // validates them.
  const unusable = describeUnusableEndpoint(baseUrl, id);
  if (unusable) throw new Error(unusable);
  const local = isLocalEndpoint(baseUrl);
  const apiKey = local && id === "local" ? undefined : await keys.get(id);
  // A gateway whose address the user supplied may well be an unauthenticated one on their own
  // network, so a missing key there is not an error. Everywhere else it is, and saying so now is
  // better than an HTTP 401 one question later.
  if (!local && !apiKey && !vendor(id)?.needsUrl) {
    throw new Error(t("No API key stored for “{0}”. Run “Hivey Code: Store a provider key”.", id));
  }
  return makeProvider({ id, baseUrl, apiKey, ...(s.chat.promptCache ? { promptCache: true } : {}) });
}

/** True when this role would send data off the machine — the question consent depends on. */
export function isRemote(s: Settings, id: ProviderId): boolean {
  try {
    return !isLocalEndpoint(endpointFor(s, id));
  } catch {
    return false;
  }
}
