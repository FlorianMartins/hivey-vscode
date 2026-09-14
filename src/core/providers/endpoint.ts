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

export interface EndpointCheck {
  /** The address to store. Present whenever the input can be made into a usable one. */
  url?: string;
  /** Why it cannot, in words that say what to do about it. */
  problem?: string;
  /** True when the input was changed to get there, so the interface can say so rather than surprise. */
  repaired?: boolean;
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
  if (check.problem) return `The address configured for “${provider}” is unusable: ${check.problem}`;
  // Only the missing scheme, which is the one that actually stops a request. A trailing slash is
  // repaired by the provider itself and reporting it would be crying wolf — and a warning that
  // fires on something harmless is a warning people learn to skip past.
  if (check.repaired) {
    return `The address configured for “${provider}” is missing its scheme: “${baseUrl}”. It should be “${check.url}”.`;
  }
  return undefined;
}
