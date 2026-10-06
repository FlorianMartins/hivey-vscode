// Which mark stands for the house that made a model.
//
// ⚠️ A pure lookup, in `core`, for the same reason every other decision in this project is: the panel
// is the hardest place to test and the easiest place to get a mapping subtly wrong. Asked for by
// name — « rajoute une icone du fournisseur devant le nom du modele comme sur github copilot » — and
// the editor's own picker does exactly this, because a row of twenty model names all wearing the same
// glyph tells you nothing you could not already read.
//
// The keys are the vendor prefixes OpenRouter actually uses, which is where the catalogue comes from;
// the tilde-prefixed ones (`~openai`) are its own markers for a vendor's direct endpoint and must map
// to the same mark, or the same company would wear two faces in one list.

/** The icon names the panel draws. Kept as plain strings so `core` never imports the webview. */
export type VendorMark =
  | "vOpenai"
  | "vAnthropic"
  | "vGoogle"
  | "vMeta"
  | "vMistral"
  | "vDeepseek"
  | "vXai"
  | "vQwen"
  | "vCohere"
  | "vAmazon"
  | "chip";

const BY_VENDOR: Record<string, VendorMark> = {
  openai: "vOpenai",
  anthropic: "vAnthropic",
  google: "vGoogle",
  meta: "vMeta",
  "meta-llama": "vMeta",
  mistralai: "vMistral",
  mistral: "vMistral",
  deepseek: "vDeepseek",
  "x-ai": "vXai",
  xai: "vXai",
  qwen: "vQwen",
  alibaba: "vQwen",
  cohere: "vCohere",
  amazon: "vAmazon",
};

/**
 * The mark for a model id or a bare vendor name.
 *
 * `chip` is the answer for everything unrecognised, and it is a real answer rather than a failure:
 * it is the glyph this control wore before any of these existed, so an unknown vendor looks like a
 * model rather than like a missing image.
 */
export function vendorMark(idOrVendor: string): VendorMark {
  const raw = (idOrVendor.includes("/") ? idOrVendor.slice(0, idOrVendor.indexOf("/")) : idOrVendor)
    .trim()
    .toLowerCase()
    // `~openai` is the catalogue's marker for a vendor's own endpoint rather than a reseller's. The
    // company is the same one; the mark has to be too.
    .replace(/^~/, "");
  return BY_VENDOR[raw] ?? "chip";
}
