// An address a person typed, turned into one a request can be made to.
//
// The failure this exists for produced the least useful error message in the product. Someone
// pastes `api.openai.com/v1` — which is what a documentation page shows, and what a browser accepts
// — the field takes it without a word, and the next question comes back as:
//
//     chat to api.openai.com/v1/chat/completions failed: Invalid URL
//
// Which names no cause and suggests no action. `fetch` needs an absolute URL; a host on its own is
// a relative path, and every attempt after that fails the same way for the life of the setting. The
// key is fine, the account is fine, and the user has no way to know that.
//
// So an address is checked and repaired where it is ENTERED, not where it is used: the moment it is
// typed is the only moment the person who can fix it is looking.

import { REMOTE_VENDORS } from "./vendors.js";

/**
 * The credential prefixes the vendor table already advertises — `sk-or-v1-`, `sk-ant-`, `AIza`,
 * `gsk_`, `xai-`, `pplx-`.
 *
 * Read off the placeholders rather than listed again here, so a vendor that changes the shape of
 * its keys changes it in one place and this follows. A placeholder with nothing before the ellipsis
 * contributes nothing, which is correct: that vendor's keys have no recognisable prefix.
 */
const KEY_PREFIXES: string[] = [
  ...new Set(
    REMOTE_VENDORS.map((v) => v.placeholder.replace(/[….]+$/u, "").trim()).filter((p) => p.length >= 3),
  ),
];

/**
 * Whether what was typed is a credential rather than an address.
 *
 * This exists because of the worst message this product has produced. A key pasted into an endpoint
 * setting came back as:
 *
 *     The address configured for "openrouter" is missing its scheme: "sk-or-v1-…".
 *     It should be "https://sk-or-v1-…".
 *
 * Which is not merely unhelpful — it tells the user to make it worse, in a confident sentence, and
 * it is the last thing they read before giving up. A key has no scheme because a key is not an
 * address, and the repair that has "exactly one plausible reading" has none at all here.
 *
 * Deliberately conservative: anything containing a dot, a slash or a colon could be an address and
 * is left alone. What is left is a bare run of key characters — either carrying a prefix a vendor
 * publishes, or long enough that no hostname looks like it.
 */
export function looksLikeApiKey(text: string): boolean {
  const value = (text ?? "").trim();
  if (!value || value.includes("/") || value.includes(".") || value.includes(":")) return false;
  if (KEY_PREFIXES.some((prefix) => value.toLowerCase().startsWith(prefix.toLowerCase()))) return true;
  // No vendor prefix, no dots: `localhost` and `myproxy` are hosts, forty random characters are not.
  return value.length >= 24 && /^[A-Za-z0-9_-]+$/.test(value);
}

export interface EndpointCheck {
  /** The address to store. Present whenever the input can be made into a usable one. */
  url?: string;
  /** Why it cannot, in words that say what to do about it. */
  problem?: string;
  /** True when the input was changed to get there, so the interface can say so rather than surprise. */
  repaired?: boolean;
  /** True when the problem is that a credential was pasted here. The caller can offer to move it. */
  credential?: boolean;
}

/**
 * Check an address, and repair the one mistake that has a single obvious reading.
 *
 * That mistake is a missing scheme. `api.openai.com/v1` can only mean `https://api.openai.com/v1` —
 * nobody types a host meaning to speak plain HTTP to a public API — so it is completed rather than
 * refused. A loopback address is the exception and gets `http://`, because that is what every local
 * model server serves and none of them has a certificate.
 *
 * Everything else is refused with its reason. A scheme that is not http or https is not a typo this
 * code can fix: `htp://` might be `http` or `https`, and guessing which would sometimes send a key
 * in clear over a network.
 */
export function checkEndpoint(raw: string): EndpointCheck {
  const text = (raw ?? "").trim().replace(/\/+$/, "");
  if (!text) return { problem: "An address is needed. It looks like https://api.example.com/v1." };

  // Before anything else, because the repair below would otherwise turn a key into a URL-shaped
  // key and say so in a sentence that reads like advice.
  if (looksLikeApiKey(text)) {
    return {
      problem:
        "That is an API key, not an address. Keys are never kept in the settings — they go to the " +
        "editor's secret store, from the panel's setup screen or “Hivey Code: set the API key”. " +
        "Leave the address empty to use the provider's own.",
      credential: true,
    };
  }

  const hasScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(text);
  let candidate = text;
  let repaired = false;
  if (!hasScheme) {
    // Loopback and a bare port mean a model server on this machine, which speaks plain HTTP.
    const local = /^(?:localhost|127\.\d+\.\d+\.\d+|\[::1\]|0\.0\.0\.0)(?::\d+)?(?:\/|$)/i.test(text);
    candidate = `${local ? "http" : "https"}://${text}`;
    repaired = true;
  }

  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    return { problem: `“${raw}” is not an address. It looks like https://api.example.com/v1.` };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { problem: `“${parsed.protocol.replace(":", "")}” is not a scheme this can use. Write http:// or https://.` };
  }
  if (!parsed.hostname) return { problem: `“${raw}” has no host in it.` };

  const url = candidate.replace(/\/+$/, "");
  return repaired ? { url, repaired: true } : { url };
}

/**
 * A last line of defence, at the point of use.
 *
 * Settings can be edited in `settings.json`, synchronised from another machine, or written by a
 * team's configuration management — so an address can arrive without ever passing the field that
 * checks it. Saying what is wrong here costs one comparison per request and replaces "Invalid URL"
 * with a sentence naming the setting and the shape it wants.
 */
export function describeUnusableEndpoint(baseUrl: string, provider: string): string | undefined {
  const check = checkEndpoint(baseUrl);
  if (check.credential) {
    return `What is configured as the address for “${provider}” is an API key. ${check.problem}`;
  }
  if (check.problem) return `The address configured for “${provider}” is unusable: ${check.problem}`;
  // Only the missing scheme, which is the one that actually stops a request. A trailing slash is
  // repaired by the provider itself and reporting it would be crying wolf — and a warning that
  // fires on something harmless is a warning people learn to skip past.
  if (check.repaired) {
    return `The address configured for “${provider}” is missing its scheme: “${baseUrl}”. It should be “${check.url}”.`;
  }
  return undefined;
}
