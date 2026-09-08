// Which remote services this extension can speak to, and where each of them lives.
//
// One table, because the alternative is what it replaced: the list of providers existed five times
// — in the manifest's three enums, in the settings reader, on the setup screen, in the composer's
// menu, and in two command-palette pickers — and adding one meant finding all five. A provider
// that is in four of them is a provider that half works, which is worse than one that is absent.
//
// Everything below except Anthropic speaks the OpenAI wire format, which is why adding them is a
// table and not a driver: the protocol was already implemented. What each entry contributes is the
// three facts no code can derive — the address, where the key is bought, and what a key looks like
// so a wrong paste is visible before it is stored.
//
// These are API keys, billed per token by the vendor. They are NOT the consumer subscription: a
// ChatGPT or Claude plan does not carry an API key, and the hints say so where it matters.

import { t } from "../../shared/i18n.js";

export type ProviderId =
  | "local"
  | "openrouter"
  | "anthropic"
  | "openai"
  | "google"
  | "deepseek"
  | "qwen"
  | "mistral"
  | "xai"
  | "groq"
  | "perplexity"
  | "openai-compatible";

/** Which HTTP dialect the endpoint speaks. Anthropic is the only one that is not OpenAI's. */
export type Wire = "openai" | "anthropic";

export interface Vendor {
  id: ProviderId;
  /** What the menus call it. */
  label: string;
  /** What fits on the composer's button, which is 280 px wide with two other controls on it. */
  short: string;
  /** Default address. Overridable in the settings — a proxy, a region, a private deployment. */
  baseUrl: string;
  /** The settings key segment: `hiveyCode.endpoints.<settingKey>`. */
  settingKey: string;
  /** What the key looks like. */
  placeholder: string;
  /** Where to buy one. Also the extension's link allow-list — see `ALLOWED_LINKS`. */
  keysUrl?: string;
  wire: Wire;
  /** True when the address is the user's to supply: Azure, LiteLLM, a corporate proxy. */
  needsUrl?: boolean;
  /** One line, in the menu where the choice is made. */
  hint: string;
}

/**
 * Every provider that is not this machine, in the order the menus show them.
 *
 * OpenRouter first because one key buys every model on the list below; then the vendors someone
 * pays directly; the shape-only gateway last, because it is the entry for a case rather than for a
 * company.
 */
export const REMOTE_VENDORS: Vendor[] = [
  {
    id: "openrouter",
    label: "OpenRouter",
    short: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1",
    settingKey: "openrouter",
    placeholder: "sk-or-v1-…",
    keysUrl: "https://openrouter.ai/keys",
    wire: "openai",
    hint: t("Four hundred models behind one key, billed per token."),
  },
  {
    id: "anthropic",
    label: "Anthropic",
    short: "Anthropic",
    baseUrl: "https://api.anthropic.com/v1",
    settingKey: "anthropic",
    placeholder: "sk-ant-…",
    keysUrl: "https://console.anthropic.com/settings/keys",
    wire: "anthropic",
    hint: t("Claude, billed directly, with prompt caching."),
  },
  {
    id: "openai",
    label: "OpenAI",
    short: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    settingKey: "openai",
    placeholder: "sk-…",
    keysUrl: "https://platform.openai.com/api-keys",
    wire: "openai",
    hint: t("GPT, billed on your OpenAI account. An API key, not a ChatGPT subscription."),
  },
  {
    id: "google",
    label: "Google Gemini",
    short: "Gemini",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    settingKey: "google",
    placeholder: "AIza…",
    keysUrl: "https://aistudio.google.com/apikey",
    wire: "openai",
    hint: t("Gemini, through Google AI Studio. The free tier is generous and needs no card."),
  },
  {
    id: "deepseek",
    label: "DeepSeek",
    short: "DeepSeek",
    baseUrl: "https://api.deepseek.com/v1",
    settingKey: "deepseek",
    placeholder: "sk-…",
    keysUrl: "https://platform.deepseek.com/api_keys",
    wire: "openai",
    hint: t("Cheap, strong at code, and it shows its reasoning."),
  },
  {
    id: "qwen",
    label: "Qwen",
    short: "Qwen",
    baseUrl: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
    settingKey: "qwen",
    placeholder: "sk-…",
    keysUrl: "https://bailian.console.alibabacloud.com",
    wire: "openai",
    hint: t("Alibaba's models, on the international DashScope endpoint."),
  },
  {
    id: "mistral",
    label: "Mistral",
    short: "Mistral",
    baseUrl: "https://api.mistral.ai/v1",
    settingKey: "mistral",
    placeholder: "…",
    keysUrl: "https://console.mistral.ai/api-keys",
    wire: "openai",
    hint: t("European, hosted in the EU, with a free tier for experimenting."),
  },
  {
    id: "xai",
    label: "xAI",
    short: "xAI",
    baseUrl: "https://api.x.ai/v1",
    settingKey: "xai",
    placeholder: "xai-…",
    keysUrl: "https://console.x.ai",
    wire: "openai",
    hint: t("Grok, billed on your xAI account."),
  },
  {
    id: "groq",
    label: "Groq",
    short: "Groq",
    baseUrl: "https://api.groq.com/openai/v1",
    settingKey: "groq",
    placeholder: "gsk_…",
    keysUrl: "https://console.groq.com/keys",
    wire: "openai",
    hint: t("Open models, answered faster than anything else. Not the maker of Grok."),
  },
  {
    id: "perplexity",
    label: "Perplexity",
    short: "Perplexity",
    baseUrl: "https://api.perplexity.ai",
    settingKey: "perplexity",
    placeholder: "pplx-…",
    keysUrl: "https://www.perplexity.ai/account/api/keys",
    wire: "openai",
    hint: t("Answers with sources, searched on the web as it writes."),
  },
  {
    id: "openai-compatible",
    label: t("Your own gateway"),
    short: t("Gateway"),
    baseUrl: "",
    settingKey: "openaiCompatible",
    placeholder: "sk-…",
    keysUrl: "https://learn.microsoft.com/azure/ai-services/openai/quickstart",
    wire: "openai",
    needsUrl: true,
    hint: t("Azure, LiteLLM, a company proxy — any OpenAI API."),
  },
];

/** Every provider, this machine included, in menu order. */
export const PROVIDER_IDS: ProviderId[] = ["local", ...REMOTE_VENDORS.map((v) => v.id)];

/**
 * The vendors a user pays directly, as opposed to a router, their own gateway, or their own
 * machine. What they have in common is that the models they serve are theirs and are not in the
 * generated catalogue's naming, so the picker lists what each one actually answers with.
 */
export const DIRECT_VENDORS: Vendor[] = REMOTE_VENDORS.filter((v) => v.id !== "openrouter" && !v.needsUrl);

export function vendor(id: string): Vendor | undefined {
  return REMOTE_VENDORS.find((v) => v.id === id);
}

export function isDirectVendor(id: string): boolean {
  return DIRECT_VENDORS.some((v) => v.id === id);
}

/** What the settings call this provider's address. */
export function endpointSettingKey(id: ProviderId): string {
  return `endpoints.${vendor(id)?.settingKey ?? id}`;
}

/** Default addresses, keyed the way the settings reader wants them. */
export function defaultEndpoints(): Record<ProviderId, string> {
  const out = { local: "http://127.0.0.1:11434/v1" } as Record<ProviderId, string>;
  for (const v of REMOTE_VENDORS) out[v.id] = v.baseUrl;
  return out;
}
