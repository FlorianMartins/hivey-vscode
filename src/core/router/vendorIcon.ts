// Which house made a model, as a slug the panel can draw.
//
// ⚠️ A pure lookup, in `core`, for the same reason every other decision in this project is: the panel
// is the hardest place to test and the easiest place to get a mapping subtly wrong — a model wearing
// the wrong maker's mark looks like a working feature. Asked for by name: « rajoute une icone du
// fournisseur devant le nom du modele comme sur github copilot », then « est ce que tu peux prendre
// les vraies icones ». The marks themselves are generated into `webview/vendorPaths.generated.ts`.
//
// The keys are the vendor prefixes OpenRouter actually uses, which is where the catalogue comes from;
// the tilde-prefixed ones (`~openai`) are its own markers for a vendor's direct endpoint and map to
// the same slug, or one company would wear two faces in a single list.

const BY_VENDOR: Record<string, string> = {
  openai: "openai",
  anthropic: "anthropic",
  google: "google",
  qwen: "qwen",
  alibaba: "qwen",
  mistralai: "mistral",
  mistral: "mistral",
  deepseek: "deepseek",
  meta: "meta",
  "meta-llama": "meta",
  "x-ai": "xai",
  xai: "xai",
  cohere: "cohere",
  amazon: "aws",
  aws: "aws",
  nvidia: "nvidia",
  "z-ai": "zhipu",
  zhipu: "zhipu",
  zhipuai: "zhipu",
  minimax: "minimax",
  moonshotai: "moonshot",
  moonshot: "moonshot",
  perplexity: "perplexity",
  // The two local servers. A model served from this machine has no vendor prefix to read, so the
  // slug comes from whoever is serving it — which is the honest answer to "whose model is this?"
  // when the answer is "yours".
  ollama: "ollama",
  lmstudio: "lmstudio",
  "lm studio": "lmstudio",
};

/**
 * The mark for a model id, a bare vendor name, or a local server's name.
 *
 * `undefined` for everything unrecognised, and the caller draws the chip it drew before any of these
 * existed — so an unknown vendor looks like a model rather than like a missing image.
 */
export function vendorSlug(idOrVendor: string): string | undefined {
  const raw = (idOrVendor.includes("/") ? idOrVendor.slice(0, idOrVendor.indexOf("/")) : idOrVendor)
    .trim()
    .toLowerCase()
    // `~openai` is the catalogue's marker for a vendor's own endpoint rather than a reseller's. The
    // company is the same one; the mark has to be too.
    .replace(/^~/, "");
  return BY_VENDOR[raw];
}
