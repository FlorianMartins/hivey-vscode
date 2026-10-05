// Adding a provider, in one pass instead of two.
//
// Florian: « l'ajout d'une nouvelle clé API qui est bug et pas user friendly par exemple pour le
// gateway qui demande de stocker l'adresse et ensuite de stocker la clé API plutôt que de remplir les
// deux champs et valider ».
//
// He is describing two separate faults in the same flow:
//
//   • THE ADDRESS WAS NEVER ASKED FOR. `setApiKey` asked which provider, then for the key, and
//     stopped. For the one provider whose address is the user's to supply — a gateway, Azure,
//     LiteLLM, a corporate proxy — the address had to be found in the settings page afterwards, in a
//     different part of the product, with nothing saying so. A flow that collects half of what it
//     needs is worse than one that collects none: it reports success.
//
//   • NOTHING WAS CHECKED. The vendor table carries a `placeholder` for every provider, and its own
//     comment says it is there "so a wrong paste is visible before it is stored" — and no code ever
//     read it. A mistyped key was accepted in silence and surfaced later as `401 Unauthorized` on a
//     question that had nothing to do with it.
//
// So: both fields, checked as they are typed, and the pair stored together or not at all.

import type { Vendor } from "./vendors.js";

export interface CredentialProblem {
  message: string;
  /** True when it cannot be stored. False when it is worth saying and the user may know better. */
  fatal: boolean;
}

/**
 * The prefix a placeholder promises, if it promises one.
 *
 * `"sk-or-v1-…"` promises `sk-or-v1-`; `"…"` promises nothing, which is the honest answer for a
 * vendor whose keys have no published shape.
 */
export function expectedPrefix(placeholder: string): string | undefined {
  const prefix = placeholder.replace(/[……].*$/, "").trim();
  return prefix.length >= 3 ? prefix : undefined;
}

/**
 * What is wrong with this key, before it is stored.
 *
 * A prefix mismatch is NOT fatal, deliberately. A vendor can change its key format next quarter, and
 * a check that refuses a valid key is worse than one that waves a wrong key through: the first makes
 * the product unusable for someone who is holding the right thing. So it warns and lets them decide.
 *
 * Everything else here is fatal, because each one is a key that cannot work: a URL pasted into the
 * wrong box, the placeholder copied verbatim out of the prompt, or a value with whitespace in it —
 * which is a selection that caught a newline, the single most common bad paste.
 */
export function keyProblem(vendor: Pick<Vendor, "label" | "placeholder">, raw: string): CredentialProblem | undefined {
  const key = raw;
  if (!key.trim()) return { message: "A key is needed.", fatal: true };
  if (/\s/.test(key)) {
    return {
      message: "That key has a space or a line break in it — the selection probably caught one. Paste it again.",
      fatal: true,
    };
  }
  if (/^https?:\/\//i.test(key)) {
    return { message: "That is an address, not a key. The address is the previous step.", fatal: true };
  }
  // The prompt shows the placeholder; some people copy it.
  if (/[……]/.test(key)) {
    return { message: "That is the example, not a key.", fatal: true };
  }
  const prefix = expectedPrefix(vendor.placeholder);
  if (prefix && !key.startsWith(prefix)) {
    return {
      message: `${vendor.label} keys usually start with “${prefix}”. Store it anyway if you know it is right.`,
      fatal: false,
    };
  }
  return undefined;
}

/**
 * The address, in the shape the providers expect.
 *
 * Three fixes, each from a real way people type an address: a bare host with no scheme, a trailing
 * slash (which turns `/v1/chat/completions` into `/v1//chat/completions` on strict servers), and
 * whitespace from a copy.
 */
export function normalizeBaseUrl(raw: string): string {
  let url = raw.trim();
  if (!url) return "";
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(url)) url = `http${/^(localhost|127\.|0\.0\.0\.0|\[::1\])/.test(url) ? "" : "s"}://${url}`;
  return url.replace(/\/+$/, "");
}

/**
 * What is wrong with this address.
 *
 * ⚠️ The missing `/v1` is a WARNING and not a refusal, and that asymmetry is the point: most
 * OpenAI-compatible gateways are mounted at `/v1`, and the most common mistake is leaving it off — but
 * some are not, and refusing those would make the gateway entry useless for exactly the people it
 * exists for.
 */
export function urlProblem(raw: string, opts: { required: boolean }): CredentialProblem | undefined {
  const trimmed = raw.trim();
  if (!trimmed) {
    return opts.required ? { message: "This provider needs an address.", fatal: true } : undefined;
  }
  const url = normalizeBaseUrl(trimmed);
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { message: "That is not an address.", fatal: true };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { message: "Only http and https addresses work here.", fatal: true };
  }
  // A key sent over plain HTTP to somewhere that is not this machine travels in clear text.
  const local = /^(localhost|127\.|0\.0\.0\.0|\[::1\]|::1$)/.test(parsed.hostname) || parsed.hostname.endsWith(".local");
  if (parsed.protocol === "http:" && !local) {
    return { message: "http to a remote host sends the key in clear text. Use https unless this is your own network.", fatal: false };
  }
  if (/\/chat\/completions$|\/messages$/.test(parsed.pathname)) {
    return { message: "Give the base address, without /chat/completions — the client adds the path.", fatal: true };
  }
  if (!/\/v\d/.test(parsed.pathname)) {
    return { message: "Most gateways are mounted at /v1. Add it unless yours is not.", fatal: false };
  }
  return undefined;
}

/** Where a key check ends up. */
export type KeyCheck =
  | { ok: true; models?: number }
  | { ok: false; why: string; retryable: boolean };

/**
 * Does this pair actually work?
 *
 * One GET to the endpoint's model list, which every OpenAI-compatible server and Anthropic both
 * serve, and which costs nothing — no tokens, no completion. It is the difference between storing a
 * credential and knowing it works, and it is cheap enough that there is no reason not to.
 *
 * @param fetchImpl injected so this is testable without a network.
 */
export async function checkCredentials(
  vendor: Pick<Vendor, "wire" | "label">,
  baseUrl: string,
  key: string,
  fetchImpl: typeof fetch,
  signal?: AbortSignal,
): Promise<KeyCheck> {
  const url = `${normalizeBaseUrl(baseUrl)}/models`;
  const headers: Record<string, string> =
    vendor.wire === "anthropic"
      ? { "x-api-key": key, "anthropic-version": "2023-06-01" }
      : { authorization: `Bearer ${key}` };
  let res: Response;
  try {
    res = await fetchImpl(url, { headers, ...(signal ? { signal } : {}) });
  } catch (err) {
    // Unreachable is not the same as rejected, and saying so saves somebody checking the key when the
    // address is what is wrong.
    return { ok: false, why: `Could not reach ${url}: ${(err as Error).message}`, retryable: true };
  }
  if (res.status === 401 || res.status === 403) {
    return { ok: false, why: `${vendor.label} rejected the key (HTTP ${res.status}).`, retryable: false };
  }
  if (res.status === 404) {
    // The key may be perfectly good; this server simply does not list models.
    return { ok: true };
  }
  if (!res.ok) {
    return { ok: false, why: `${vendor.label} answered HTTP ${res.status}.`, retryable: true };
  }
  try {
    const body = (await res.json()) as { data?: unknown[] };
    return { ok: true, ...(Array.isArray(body.data) ? { models: body.data.length } : {}) };
  } catch {
    return { ok: true };
  }
}
