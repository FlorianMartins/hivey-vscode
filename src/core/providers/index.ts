// Where a configuration becomes a provider. Everything above this line is settings; everything
// below it is HTTP.

import { isLocalEndpoint } from "../redaction/index.js";
import { AnthropicProvider } from "./anthropic.js";
import { OpenAICompatibleProvider } from "./openai.js";
import type { Provider } from "./types.js";
import { vendor, type ProviderId } from "./vendors.js";

export * from "./types.js";
export * from "./vendors.js";
export { OpenAICompatibleProvider, isOllama } from "./openai.js";
export { AnthropicProvider } from "./anthropic.js";

export interface ProviderConfig {
  id: ProviderId;
  baseUrl: string;
  apiKey?: string;
}

export const ATTRIBUTION = {
  referer: "https://github.com/FlorianMartins/hivey-vscode",
  title: "Hivey Code",
};

export function makeProvider(cfg: ProviderConfig): Provider {
  // The dialect is a property of the vendor, not a special case in the caller: everything on the
  // list speaks OpenAI's wire format except Anthropic, and a new entry that does not would say so
  // in the table rather than here.
  if (vendor(cfg.id)?.wire === "anthropic") {
    return new AnthropicProvider({ baseUrl: cfg.baseUrl, apiKey: cfg.apiKey ?? "" });
  }
  return new OpenAICompatibleProvider({
    id: cfg.id,
    baseUrl: cfg.baseUrl,
    apiKey: cfg.apiKey,
    // "local" is a claim about the endpoint, not about the setting name: someone who points the
    // local provider at api.openai.com must still get redaction. The URL decides.
    isLocal: isLocalEndpoint(cfg.baseUrl),
    referer: ATTRIBUTION.referer,
    title: ATTRIBUTION.title,
  });
}
