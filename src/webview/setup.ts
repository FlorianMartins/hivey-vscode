// The first screen, which exists because of a question nobody should be asked.
//
// A new user is confronted with `hiveyCode.endpoints.local` and asked for a base URL. Someone who
// installed Ollama an hour ago does not know it, has no reason to know it, and will guess — and the
// guess fails in a way that looks like the extension being broken rather than like a wrong address.
//
// So this screen does not ask, it reports. It knocks on the ports that local runtimes actually
// bind, on loopback only, and shows what answered. The user picks a model from a list of models
// that exist, or pastes an OpenRouter key, and is done. There is no field for a URL anywhere on it
// — the one place that still has one is the settings, for the people who need it.

import { button, el, icon, ICON } from "./dom.js";
import { t } from "../shared/i18n.js";
import type { ToExtension, UiRuntime, UiState } from "../shared/protocol.js";

/** Per-provider draft values. Never persisted, never sent anywhere but to the keychain. */
const drafts: Record<string, { key: string; url: string }> = {};
let expanded: string | undefined;
let openGateway: string | undefined;

/**
 * Open this screen already showing one provider's card.
 *
 * Called when someone picks a provider they have not set up: the point of sending them here is the
 * one field they are missing, and a screen that arrives with every card folded shut asks them to
 * find it again. For "on this machine" there is no card to expand — the local section is always
 * open — so nothing is expanded and the probe below it is what they came for.
 */
export function focusGateway(id: string | undefined): void {
  openGateway = id;
  showServerForm = false;
}
let showServerForm = false;
const serverDraft = { name: "", url: "" };

interface Gateway {
  id: string;
  label: string;
  /** What the key looks like, so a wrong paste is visible before it is stored. */
  placeholder: string;
  /** Where to get one. Must also be listed in the extension's link allow-list. */
  keysUrl?: string;
  /** True for a gateway whose address the user supplies: Azure, LiteLLM, a corporate proxy. */
  needsUrl?: boolean;
}

function draft(id: string): { key: string; url: string } {
  return (drafts[id] ??= { key: "", url: "" });
}

const GATEWAYS: Gateway[] = [
  { id: "openrouter", label: "OpenRouter", placeholder: "sk-or-v1-…", keysUrl: "https://openrouter.ai/keys" },
  { id: "anthropic", label: "Anthropic", placeholder: "sk-ant-…", keysUrl: "https://console.anthropic.com/settings/keys" },
  {
    id: "openai-compatible",
    label: "OpenAI-compatible",
    placeholder: "sk-…",
    keysUrl: "https://learn.microsoft.com/azure/ai-services/openai/quickstart",
    needsUrl: true,
  },
];

function gatewayHint(id: string): string {
  switch (id) {
    case "openrouter":
      return t("Four hundred models behind one key, billed per token. Use it for what a local model cannot do.");
    case "anthropic":
      return t("Claude, billed directly by Anthropic. Prompt caching is supported, which is most of the bill on a long conversation.");
    default:
      return t("Any server that speaks the OpenAI API: Azure OpenAI, LiteLLM, vLLM behind a gateway, your company's own proxy.");
  }
}

export function setupScreen(state: UiState, send: (m: ToExtension) => void, rerender: () => void): HTMLElement {
  const wrap = el("div", "screen setup");
  const { setup } = state;

  const head = el("div", "setup-head");
  head.append(el("h1", "setup-title", t("Let's find a model")));
  head.append(
    el(
      "p",
      "setup-lede",
      t("Hivey Code runs on a model you choose. On your machine it costs nothing and sends nothing; through a gateway it is billed, and what leaves is pseudonymised first."),
    ),
  );
  wrap.append(head);

  // ── On this machine ─────────────────────────────────────────────────────────────────────────

  const local = el("section", "setup-card");
  const localHead = el("div", "setup-card-head");
  localHead.append(el("h2", "setup-card-title", t("On your machine")));
  localHead.append(el("span", "setup-badge recommended", t("recommended")));
  local.append(localHead);
  local.append(el("p", "setup-card-hint", t("Nothing leaves, nothing is billed, and it works offline.")));

  if (setup.probing) {
    local.append(el("p", "setup-status pulse", t("Looking for a model server on this machine…")));
  } else if (!setup.runtimes.length) {
    local.append(nothingFound(send));
  } else {
    for (const runtime of setup.runtimes) local.append(runtimeCard(runtime, state, send, rerender));
  }

  const localFoot = el("div", "setup-card-foot");
  localFoot.append(
    button({
      label: setup.probing ? t("Searching…") : t("Search again"),
      className: "btn tiny ghost",
      disabled: setup.probing,
      onClick: () => send({ type: "probeLocal" }),
    }),
  );
  localFoot.append(el("div", "spacer"));
  localFoot.append(
    button({
      label: t("A server on your network…"),
      className: "btn tiny ghost",
      title: t("A machine on your own network — the team's GPU box, a vLLM server"),
      onClick: () => {
        showServerForm = !showServerForm;
        rerender();
      },
    }),
  );
  local.append(localFoot);
  // The case the probe cannot find, because finding it would mean scanning a network this
  // extension has no business scanning. Plenty of teams run one shared GPU machine; the address is
  // something they know and nothing can discover for them, so it is asked for rather than guessed
  // at. Once declared it is probed like any other, and what it serves appears in the picker beside
  // the models running on the laptop.
  if (showServerForm) local.append(serverForm(send, rerender));
  wrap.append(local);

  // ── Through a gateway ───────────────────────────────────────────────────────────────────────
  //
  // One card per provider rather than one card for OpenRouter. The first version offered only
  // OpenRouter, which told anyone with an Anthropic account that this extension did not support
  // them — while the code supported them all along. An affordance that exists in the code and not
  // on the screen does not exist.

  for (const gateway of GATEWAYS) {
    wrap.append(gatewayCard(gateway, state, send, rerender));
  }

  // ── Out ─────────────────────────────────────────────────────────────────────────────────────

  const foot = el("div", "setup-foot");
  if (setup.configured) {
    foot.append(el("span", "setup-ready", t("Ready: {0}", setup.configured.model)));
  }
  foot.append(el("div", "spacer"));
  foot.append(
    button({
      label: t("All settings"),
      className: "btn tiny ghost",
      onClick: () => send({ type: "openSettings" }),
    }),
  );
  foot.append(
    button({
      // Never "skip". Someone who has not configured anything can still read the screen, and
      // pretending the step was optional would leave them at a chat that cannot answer.
      label: setup.configured ? t("Start") : t("I'll do this later"),
      className: setup.configured ? "btn tiny primary" : "btn tiny ghost",
      onClick: () => send({ type: "finishSetup" }),
    }),
  );
  wrap.append(foot);
  return wrap;
}

/**
 * Declaring a model server that is not on this machine.
 *
 * Two fields and no explanation of what a base URL is, because the placeholder is the explanation:
 * someone who runs a model server knows their address, and someone who does not is not on this
 * card. What the note under it says is the part that is NOT obvious — that an address on your own
 * network is treated exactly like localhost, so nothing is pseudonymised and nothing is billed.
 */
function serverForm(send: (m: ToExtension) => void, rerender: () => void): HTMLElement {
  const box = el("div", "setup-server-form");

  const name = el("input", "setup-input");
  name.placeholder = t("Name — “Team GPU”");
  name.value = serverDraft.name;
  name.addEventListener("input", () => (serverDraft.name = name.value));

  const url = el("input", "setup-input");
  url.placeholder = "http://192.168.1.50:11434/v1";
  url.value = serverDraft.url;
  url.addEventListener("input", () => (serverDraft.url = url.value));

  const submit = () => {
    const address = serverDraft.url.trim();
    if (!address) return;
    send({ type: "addServer", name: serverDraft.name.trim(), url: address });
    serverDraft.name = "";
    serverDraft.url = "";
    showServerForm = false;
    rerender();
  };
  url.addEventListener("keydown", (ev) => {
    if ((ev as KeyboardEvent).key === "Enter") submit();
  });

  box.append(name, url);
  const row = el("div", "setup-server-actions");
  row.append(el("div", "spacer"));
  row.append(button({ label: t("Add and search"), className: "btn tiny primary", onClick: submit }));
  box.append(row);
  box.append(
    el(
      "p",
      "setup-note",
      t("An address on your own network counts as local: nothing is pseudonymised, nothing is billed, nothing leaves it."),
    ),
  );
  return box;
}

function runtimeCard(runtime: UiRuntime, state: UiState, send: (m: ToExtension) => void, rerender: () => void): HTMLElement {
  const card = el("div", "runtime");
  const head = el("div", "runtime-head");
  head.append(icon("check", "runtime-tick"));
  head.append(el("span", "runtime-name", runtime.name));
  // `http://127.0.0.1:11434/v1` truncates to "http://127.0.0.1:…", which throws away the only part
  // that identifies the server. The scheme is always http and the host is always loopback — the
  // port is the information.
  head.append(el("span", "runtime-url", runtime.baseUrl.replace(/^https?:\/\//, "").replace(/\/v1\/?$/, "")));
  card.append(head);

  if (!runtime.models.length) {
    card.append(el("p", "setup-status", t("{0} is running but has no model loaded.", runtime.name)));
    if (runtime.suggestion) {
      const cmd = el("div", "setup-command");
      cmd.append(el("code", "", runtime.suggestion));
      cmd.append(
        button({
          icon: ICON.copy,
          title: t("Copy"),
          className: "btn icon-only",
          onClick: () => send({ type: "copy", text: runtime.suggestion! }),
        }),
      );
      card.append(cmd);
      card.append(el("p", "setup-note", t("Run that in a terminal, then search again.")));
    }
    return card;
  }

  // Long lists collapse: someone with thirty models pulled does not want them all on the first
  // screen they ever see, and the ranked first few are the ones worth writing code with.
  const shown = expanded === runtime.baseUrl ? runtime.models : runtime.models.slice(0, 4);
  const list = el("div", "runtime-models");
  for (const model of shown) {
    // A model is in use on THIS server, not merely somewhere. Two runtimes commonly serve a model
    // of the same name — the same one, pulled twice — and marking both was telling the user that
    // clicking either would change nothing, which is false.
    const current = state.setup.configured?.model === model && state.setup.configured?.baseUrl === runtime.baseUrl;
    const row = el("button", `runtime-model${current ? " current" : ""}`);
    row.append(el("span", "runtime-model-name", model));
    if (current) row.append(el("span", "setup-badge done", t("in use")));
    else row.append(el("span", "runtime-model-action", t("Use this one")));
    row.addEventListener("click", () => send({ type: "useLocal", baseUrl: runtime.baseUrl, model }));
    list.append(row);
  }
  card.append(list);

  if (runtime.models.length > shown.length) {
    card.append(
      button({
        label: t("Show the other {0}", runtime.models.length - shown.length),
        className: "btn tiny ghost",
        onClick: () => {
          expanded = runtime.baseUrl;
          rerender();
        },
      }),
    );
  }
  return card;
}

/**
 * Which model to pull, when the answer is "I do not know, what have you got?"
 *
 * Three, not thirty. The point of this list is to end the decision, not to open it: someone who has
 * just learned they need a model server does not also want to compare quantisations. They are
 * ordered by what the machine can take, because that is the only question the user can actually
 * answer about themselves, and the sizes are the download — the number that decides whether this
 * happens now or "later".
 */
const LOCAL_MODELS: Array<{ id: string; size: string; hint: string }> = [
  { id: "qwen2.5-coder:1.5b", size: "~1 GB", hint: t("A laptop with no discrete GPU. Completions and short answers.") },
  { id: "qwen2.5-coder:7b", size: "~4.7 GB", hint: t("The one to take if the machine allows it. Good at code, runs on 8 GB of VRAM.") },
  { id: "deepseek-coder-v2:16b", size: "~9 GB", hint: t("A workstation or a GPU box. Closer to what a gateway gives you.") },
];

function nothingFound(send: (m: ToExtension) => void): HTMLElement {
  const box = el("div", "runtime empty");
  box.append(el("p", "setup-status", t("Nothing is listening on this machine yet.")));
  box.append(
    el(
      "p",
      "setup-note",
      t("Two steps: install Ollama, then pull a model. Nothing else to configure — it is found the moment it is running."),
    ),
  );
  box.append(
    button({
      label: t("1. Get Ollama"),
      className: "btn tiny",
      onClick: () => send({ type: "openExternal", url: "https://ollama.com/download" }),
    }),
  );
  box.append(el("p", "setup-note", t("2. Then pull one of these, in a terminal:")));

  for (const model of LOCAL_MODELS) {
    const row = el("div", "setup-model");
    const head = el("div", "setup-model-head");
    head.append(el("code", "setup-model-id", model.id));
    head.append(el("span", "setup-model-size", model.size));
    head.append(el("div", "spacer"));
    head.append(
      button({
        icon: ICON.copy,
        title: t("Copy the command"),
        className: "btn icon-only",
        onClick: () => send({ type: "copy", text: `ollama pull ${model.id}` }),
      }),
    );
    row.append(head);
    row.append(el("p", "setup-model-hint", model.hint));
    box.append(row);
  }

  box.append(
    el("p", "setup-note", t("Then press “Search again”. Nothing leaves the machine, and none of it is billed.")),
  );
  return box;
}

function gatewayCard(gateway: Gateway, state: UiState, send: (m: ToExtension) => void, rerender: () => void): HTMLElement {
  const card = el("section", "setup-card");
  const stored = Boolean(state.setup.hasKey[gateway.id]);
  const open = openGateway === gateway.id;

  const head = el("button", "setup-card-head as-button");
  head.append(el("h2", "setup-card-title", gateway.label));
  if (stored) head.append(el("span", "setup-badge done", t("key stored")));
  head.append(el("div", "spacer"));
  head.append(icon(open ? "chevron" : "chevronLeft", "ico"));
  head.addEventListener("click", () => {
    openGateway = open ? undefined : gateway.id;
    rerender();
  });
  card.append(head);

  if (!open) return card;

  card.append(el("p", "setup-card-hint", gatewayHint(gateway.id)));

  if (gateway.needsUrl) {
    const urlField = el("div", "setup-field");
    const url = el("input", "setup-input");
    url.type = "text";
    url.placeholder = "https://…/v1";
    url.value = draft(gateway.id).url || state.setup.endpoints?.[gateway.id] || "";
    url.spellcheck = false;
    url.addEventListener("input", () => (draft(gateway.id).url = url.value));
    urlField.append(url);
    urlField.append(
      button({
        label: t("Save the address"),
        className: "btn tiny",
        onClick: () => {
          send({ type: "setEndpoint", provider: gateway.id, url: url.value.trim() });
          rerender();
        },
      }),
    );
    card.append(urlField);
  }

  const field = el("div", "setup-field");
  const input = el("input", "setup-input");
  input.type = "password";
  input.placeholder = stored ? t("A key is already stored — paste one to replace it") : gateway.placeholder;
  input.value = draft(gateway.id).key;
  input.autocomplete = "off";
  input.spellcheck = false;
  const submit = () => {
    const value = draft(gateway.id).key.trim();
    if (!value) return;
    send({ type: "saveKey", provider: gateway.id, key: value });
    // Cleared on both sides: the panel has no reason to go on holding a credential.
    draft(gateway.id).key = "";
    input.value = "";
    rerender();
  };
  input.addEventListener("input", () => {
    draft(gateway.id).key = input.value;
    save.disabled = !input.value.trim();
  });
  input.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") submit();
  });
  const save = button({ label: t("Save the key"), className: "btn tiny primary", disabled: !input.value.trim(), onClick: submit });
  field.append(input, save);
  card.append(field);

  const foot = el("div", "setup-links");
  if (gateway.keysUrl) {
    foot.append(
      button({
        label: t("Get a key"),
        className: "btn tiny ghost",
        onClick: () => send({ type: "openExternal", url: gateway.keysUrl! }),
      }),
    );
  }
  if (stored) {
    foot.append(
      button({
        label: t("Forget this key"),
        className: "btn tiny ghost",
        onClick: () => send({ type: "clearKey", provider: gateway.id }),
      }),
    );
    foot.append(el("div", "spacer"));
    foot.append(
      button({
        label: t("Choose a model"),
        className: "btn tiny",
        onClick: () => send({ type: "openScreen", screen: "models" }),
      }),
    );
  }
  card.append(foot);
  card.append(
    el("p", "setup-note", t("The key goes straight to your operating system's keychain. It is never written to settings.json, which syncs between machines and gets committed by accident.")),
  );
  return card;
}
