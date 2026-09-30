// Whether a provider can be switched to, as opposed to being switched to and then failing.
//
// The composer's provider menu refuses to select something that is not set up: it opens that
// provider's card instead, because selecting a vendor with no key leaves the panel configured to
// fail — the composer says "Anthropic", the next question says 401, and the setting has to be put
// back by hand.
//
// The check that decides this asked for a key FIRST and looked at the address afterwards, so a
// gateway with an address and no key was never ready and the menu never switched to it. The user
// chose "Your own gateway", the composer went on saying "Local", and nothing said why — three
// times in a row, in three different places, because the rule lived in a webview file where nothing
// could test it. It lives here now.
//
// A key is genuinely optional for a gateway: `providerFor` says so in as many words, because a
// proxy on somebody's own network usually has none.

export interface ProviderState {
  /** A key is stored for it. */
  hasKey: boolean;
  /** An address is configured for it, when it is the kind of provider that needs one. */
  hasEndpoint: boolean;
  /** This provider is defined by an API shape rather than by a company, so it needs an address. */
  needsUrl: boolean;
  /** For the local provider only: a runtime was found, or we are still looking. */
  localFound: boolean;
}

export function providerIsReady(id: string, state: ProviderState): boolean {
  if (id === "local") return state.localFound;
  // The address IS the configuration. Asking for a key as well is what made a gateway unselectable.
  if (state.needsUrl) return state.hasEndpoint;
  return state.hasKey;
}

/** What is missing, said where the choice is made rather than one question later. */
export function whatIsMissing(id: string, state: ProviderState): "runtime" | "endpoint" | "key" {
  if (id === "local") return "runtime";
  if (state.needsUrl && !state.hasEndpoint) return "endpoint";
  return "key";
}
