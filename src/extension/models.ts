// The model list the picker shows.
//
// Two sources, merged: the generated catalogue (411 models with prices and context windows, no
// network) and whatever the configured endpoint actually serves. The second matters more than it
// sounds — a team running vLLM has three models with names nobody outside knows, and a catalogue
// that cannot show them is a catalogue nobody uses.

import * as vscode from "vscode";
import { t } from "../shared/i18n.js";
import { GENERATED_MODELS } from "../core/router/catalog.generated.js";
import { isLocalEndpoint, isLoopbackEndpoint } from "../core/redaction/index.js";
import { discoverLocal, rankModels } from "../core/providers/discover.js";
import { request } from "../core/util/http.js";
import type { UiModel } from "../shared/protocol.js";
import { endpointFor, providerFor, type Keys, type Settings } from "./config.js";
import { shortModelName } from "../core/models/names.js";

/** Models a provider is currently serving, or an empty list when it cannot be reached. */
async function served(settings: Settings, keys: Keys, provider: Settings["chat"]["provider"]): Promise<string[]> {
  try {
    const p = await providerFor(settings, keys, provider);
    return await p.listModels();
  } catch {
    return [];
  }
}

/**
 * Every model server that answers, on this machine and on this network.
 *
 * The picker used to show what ONE endpoint served — the address in `endpoints.local` — which made
 * "On your machine" a list of one runtime's models rather than a list of the machine's. Someone
 * running Ollama for chat and LM Studio for a bigger model saw half of what they had, with no
 * indication the other half existed. And a team whose model lives on a GPU box down the corridor
 * had nowhere to say so at all: the setting was singular, so the case was unrepresentable.
 *
 * So this probes all of them — the well-known loopback ports, plus whatever the user declared in
 * `endpoints.servers` — and each model remembers which server serves it, so choosing one can point
 * the extension at the right address rather than hoping it is already there.
 *
 * The probe is the same one the setup screen uses, on the same terms: loopback and declared
 * addresses only, never a scan, and nothing is sent but the question "what do you serve".
 */
async function localServers(settings: Settings): Promise<Array<{ name: string; baseUrl: string; models: string[] }>> {
  const extra = [
    ...(settings.endpoints.local ? [{ name: t("Configured endpoint"), baseUrl: settings.endpoints.local }] : []),
    ...settings.servers.map((x) => ({ name: x.name, baseUrl: x.url })),
  ];
  try {
    const found = await discoverLocal({
      extra,
      // Shorter than the setup screen's probe. There the user is watching a spinner and waiting for
      // an answer; here the model list is being refreshed behind a panel that is already usable, so
      // a server that has not replied in half a second can be missing from this pass and present in
      // the next one.
      timeoutMs: 600,
      fetchJson: async (url, timeoutMs) => {
        const res = await request(url, { timeoutMs, label: "discovery" });
        if (!res.ok) throw new Error(String(res.status));
        return res.json();
      },
    });
    return found.map((r) => ({ name: r.name, baseUrl: r.baseUrl, models: rankModels(r.models) }));
  } catch {
    return [];
  }
}

export async function listModels(settings: Settings, keys: Keys, current: string): Promise<UiModel[]> {
  const out: UiModel[] = [];
  const seen = new Set<string>();

  // 1. Everything running on this machine or this network. Always first: it is the free tier, and
  //    the argument this extension exists to make.
  for (const server of await localServers(settings)) {
    const loopback = isLoopbackEndpoint(server.baseUrl);
    for (const id of server.models) {
      // The same model served by two runtimes is one row. The first server wins, and the probe
      // returns them in the order the discovery list defines, so that is the better-known one.
      const key = `${id}@${server.baseUrl}`;
      if (seen.has(key) || seen.has(id)) continue;
      seen.add(key);
      seen.add(id);
      out.push({
        id,
        name: id,
        vendor: loopback ? "local" : "network",
        context: 0,
        inUsd: 0,
        outUsd: 0,
        cachedInUsd: 0,
        provider: "local",
        local: true,
        loopback,
        server: server.name,
        baseUrl: server.baseUrl,
        current: id === current,
      });
    }
  }

  // 2. An internal gateway, if one is configured — same idea, someone else's hardware, possibly
  //    behind a key. Local only if its address says so.
  const gatewayUrl = safe(() => endpointFor(settings, "openai-compatible"));
  if (gatewayUrl) {
    for (const id of await served(settings, keys, "openai-compatible")) {
      if (seen.has(id)) continue;
      seen.add(id);
      const local = isLocalEndpoint(gatewayUrl);
      out.push({
        id,
        name: id,
        vendor: local ? "network" : t("gateway"),
        context: 0,
        inUsd: 0,
        outUsd: 0,
        cachedInUsd: 0,
        provider: "openai-compatible",
        local,
        loopback: isLoopbackEndpoint(gatewayUrl),
        server: t("gateway"),
        baseUrl: gatewayUrl,
        current: id === current,
      });
    }
  }

  // 3. The priced catalogue. No request: it ships with the extension and refreshes by workflow.
  for (const [id, name, vendor, context, inUsd, outUsd, cachedInUsd] of GENERATED_MODELS) {
    if (seen.has(id)) continue;
    out.push({
      id,
      name,
      vendor: vendor || "divers",
      context,
      inUsd,
      outUsd,
      cachedInUsd,
      provider: "openrouter",
      local: false,
      loopback: false,
      current: id === current,
    });
  }

  return out;
}

/** A short label for the composer button: the name without the vendor, plus a price hint. */
export function labelFor(models: UiModel[], id: string): string {
  const found = models.find((m) => m.id === id);
  return shortModelName(found?.name ?? id);
}


/** Reasoning is only worth offering on models that actually do it. */
export function supportsReasoning(id: string): boolean {
  return /o[134]|gpt-5|claude|sonnet|opus|haiku|fable|deepseek|qwen3|reason|think|magistral|grok-[34]|gemini-[23]/i.test(id);
}

function safe<T>(fn: () => T): T | undefined {
  try {
    return fn();
  } catch {
    return undefined;
  }
}

/**
 * The files open in tabs.
 *
 * From `window.tabGroups`, not from `workspace.textDocuments`, and the difference is the reason
 * "Open editors" appeared empty for people with a dozen tabs. `textDocuments` holds the documents
 * the editor has LOADED — a tab that has not been focused since the window opened is not among
 * them, and neither is one restored from the previous session and never clicked. `tabGroups` is
 * what the Open Editors view itself reads, so it is what "open editors" has to mean here.
 */
export function openFileUris(): vscode.Uri[] {
  const out: vscode.Uri[] = [];
  const seen = new Set<string>();
  for (const group of vscode.window.tabGroups.all) {
    for (const tab of group.tabs) {
      const uri = textTabUri(tab);
      if (!uri) continue;
      const key = uri.toString();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(uri);
    }
  }
  return out;
}

/**
 * The document a tab is showing, when it is showing one.
 *
 * `TabInputText` is the test, not the URI's scheme. Requiring `file:` was the fourth and last thing
 * standing between "attach all open editors" and the people reporting it as broken, and it was
 * invisible from here: it works perfectly on a laptop with local files, and attaches NOTHING over
 * SSH, in WSL, in a dev container, or on an IBM i — where every member and stream file a user of
 * this extension has open arrives under a scheme Code for IBM i registered. Reading them was never
 * the problem: `openTextDocument` resolves any scheme with a provider, which is exactly what those
 * are. The filter was refusing files the editor could have handed over.
 *
 * The type is what excludes a diff, a notebook, a settings editor and a webview — all of them tabs,
 * none of them a document to hand a model. That is a question about the KIND of tab, which is what
 * `TabInputText` answers, and never a question about where the bytes live.
 */
function textTabUri(tab: vscode.Tab): vscode.Uri | undefined {
  if (!(tab.input instanceof vscode.TabInputText)) return undefined;
  const uri = tab.input.uri;
  if (!isDocumentUri(uri)) return undefined;
  return uri;
}

/**
 * Is this something a person would call a file they are working on?
 *
 * Named by what it is NOT, and that direction is the whole point. An allow-list of schemes answers
 * "is it on this machine", which is a question nobody asked: over SSH, in WSL, in a container, and
 * on an IBM i the files are all somewhere else and all perfectly real. What actually has to be kept
 * out is a short, known set of documents the editor synthesises — an output channel, the release
 * notes, a settings editor, a git revision — and those can be listed, because the editor is the one
 * that makes them.
 *
 * The cost of the two mistakes is not symmetric. A deny-list that misses something attaches an odd
 * document once; an allow-list that misses something makes the feature not exist for a whole class
 * of user, silently, which is what happened here three times over.
 */
export function isDocumentUri(uri: vscode.Uri): boolean {
  const SYNTHETIC = new Set([
    "output",
    "extension-output",
    "vscode-settings",
    "vscode-release-notes",
    "vscode-userdata",
    "walkThrough",
    "walkThroughSnippet",
    "search-editor",
    "comment",
    "debug",
    "git",
    "gitlens",
    "review",
    "pr",
  ]);
  if (SYNTHETIC.has(uri.scheme)) return false;
  return !uri.path.endsWith(".git");
}

export function openFiles(): Array<{ path: string; active: boolean; language: string; dirty: boolean }> {
  const activeUri = vscode.window.activeTextEditor?.document.uri.toString();
  const loaded = new Map(vscode.workspace.textDocuments.map((d) => [d.uri.toString(), d]));
  const out: Array<{ path: string; active: boolean; language: string; dirty: boolean }> = [];
  const seen = new Set<string>();

  for (const group of vscode.window.tabGroups.all) {
    for (const tab of group.tabs) {
      // Only plain text tabs, whatever scheme they are served from — see `textTabUri`.
      const uri = textTabUri(tab);
      if (!uri) continue;
      const key = uri.toString();
      if (seen.has(key)) continue;
      seen.add(key);
      const doc = loaded.get(key);
      out.push({
        path: vscode.workspace.asRelativePath(uri, false),
        active: key === activeUri,
        // A tab that is not loaded has no language id yet; the extension is what it has.
        language: doc?.languageId ?? uri.path.split(".").pop() ?? "",
        dirty: tab.isDirty,
      });
    }
  }
  return out;
}
