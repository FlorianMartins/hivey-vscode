// Settings, keys, and the providers they produce.
//
// Two rules this file exists to enforce:
//   • an API key is never a setting. Settings sync to a Microsoft account, appear in
//     `settings.json`, and get committed by accident. Keys live in SecretStorage, which is the
//     OS keychain, and the only way to set one is the command that prompts for it.
//   • the endpoint decides what is local, not the setting name. Someone who points the "local"
//     provider at a public URL gets redaction and consent like any other remote provider.

import * as vscode from "vscode";
import { t } from "../shared/i18n.js";
import { makeProvider, type Provider, type ProviderId } from "../core/providers/index.js";
import { isLocalEndpoint } from "../core/redaction/index.js";
import type { RedactionLevel, RedactionPolicy } from "../core/redaction/types.js";
import type { EscalationPolicy, RouterConfig } from "../core/router/route.js";

export const SECTION = "hiveyCode";

export interface Settings {
  /** `auto` follows the editor; a fixed tag lets someone read the editor in one language and this
   *  extension in another — which is more common than it sounds on shared machines. */
  language: "auto" | "en" | "fr";
  chat: { provider: ProviderId; model: string };
  completion: { provider: ProviderId | "off"; model: string; enabled: boolean; debounceMs: number; maxTokens: number; multiline: boolean };
  endpoints: Record<ProviderId, string>;
  /** Extra model servers, on this machine or on the operator's network. Probed, never assumed. */
  servers: Array<{ name: string; url: string }>;
  privacy: {
    redaction: RedactionLevel;
    allowUnredacted: boolean;
    blockedGlobs: string[];
    egressPolicy: "ask-once" | "ask-always" | "trust";
    auditLog: boolean;
    customTerms: string[];
  };
  budget: { perRequestUsd: number; dailyUsd: number };
  context: { maxTokens: number; repoMap: boolean };
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

export function readSettings(scope?: vscode.Uri): Settings {
  const c = vscode.workspace.getConfiguration(SECTION, scope);
  const level = c.get<RedactionLevel>("privacy.redaction", "strict");
  const allowUnredacted = c.get<boolean>("privacy.allowUnredacted", false);
  return {
    language: c.get<"auto" | "en" | "fr">("language", "auto"),
    chat: {
      provider: c.get<ProviderId>("chat.provider", "local"),
      model: c.get<string>("chat.model", "qwen2.5-coder:7b"),
    },
    completion: {
      provider: c.get<ProviderId | "off">("completion.provider", "local"),
      model: c.get<string>("completion.model", "qwen2.5-coder:7b"),
      enabled: c.get<boolean>("completion.enabled", true),
      debounceMs: c.get<number>("completion.debounceMs", 220),
      maxTokens: c.get<number>("completion.maxTokens", 128),
      multiline: c.get<boolean>("completion.multiline", true),
    },
    endpoints: {
      local: c.get<string>("endpoints.local", "http://127.0.0.1:11434/v1"),
      "openai-compatible": c.get<string>("endpoints.openaiCompatible", ""),
      openrouter: c.get<string>("endpoints.openrouter", "https://openrouter.ai/api/v1"),
      anthropic: c.get<string>("endpoints.anthropic", "https://api.anthropic.com/v1"),
    },
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
      auditLog: c.get<boolean>("privacy.auditLog", true),
      customTerms: c.get<string[]>("privacy.customTerms", []),
    },
    budget: {
      perRequestUsd: c.get<number>("budget.perRequestUsd", 0.25),
      dailyUsd: c.get<number>("budget.dailyUsd", 2),
    },
    context: {
      maxTokens: c.get<number>("context.maxTokens", 8000),
      repoMap: c.get<boolean>("context.repoMap", true),
    },
    panel: { minWidth: c.get<number>("panel.minWidth", 260) },
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
  throw new Error(t("No endpoint configured for “{0}”. Set {1}.endpoints in the settings.", id, SECTION));
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
  const local = isLocalEndpoint(baseUrl);
  const apiKey = local && id === "local" ? undefined : await keys.get(id);
  if (!local && !apiKey && id !== "openai-compatible") {
    throw new Error(t("No API key stored for “{0}”. Run “Hivey Code: Store a provider key”.", id));
  }
  return makeProvider({ id, baseUrl, apiKey });
}

/** True when this role would send data off the machine — the question consent depends on. */
export function isRemote(s: Settings, id: ProviderId): boolean {
  try {
    return !isLocalEndpoint(endpointFor(s, id));
  } catch {
    return false;
  }
}
