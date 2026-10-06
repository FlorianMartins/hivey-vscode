// The maker's marks, fetched once and committed.
//
// ⚠️ Run by hand, not at build time and never at runtime: this extension ships zero runtime
// dependencies and its panel's CSP forbids loading anything from the network, so an icon that is not
// in the bundle is an icon that does not exist. The output is committed, like the model catalogue,
// and this script is how it is regenerated rather than hand-edited.
//
// SOURCE: lobehub/lobe-icons, MIT licensed, which is what makes embedding the paths something this
// project may actually do. The trademarks remain their owners'; these marks identify whose model a
// row is about, which is the use the editor's own model picker makes of them.
//
// Each file is `fill="currentColor"` on a 24×24 box with a single path, so the panel can draw them
// the way it draws everything else: one element, inheriting the colour of the text beside it.

import { writeFile } from "node:fs/promises";

const BASE = "https://raw.githubusercontent.com/lobehub/lobe-icons/master/packages/static-svg/icons";

// The vendors the generated catalogue is actually made of, plus the two local servers. A mark for a
// vendor nobody can choose is weight in the bundle for nothing.
const WANTED = [
  "openai", "anthropic", "google", "qwen", "mistral", "deepseek", "meta", "xai",
  "cohere", "aws", "nvidia", "zhipu", "minimax", "moonshot", "perplexity", "ollama", "lmstudio",
];

const out = {};
for (const slug of WANTED) {
  const res = await fetch(`${BASE}/${slug}.svg`);
  if (!res.ok) {
    console.error(`${slug}: HTTP ${res.status} — skipped`);
    continue;
  }
  const svg = await res.text();
  const box = /viewBox="([^"]+)"/.exec(svg)?.[1];
  // ⚠️ Several paths are normal: Google's mark is its four-colour G flattened into four shapes, and
  // refusing it would mean dropping one of the three vendors people meet most. The box is still
  // asserted, because a mark drawn on a different grid lands somewhere else entirely.
  const paths = [...svg.matchAll(/<path[^>]*\sd="([^"]+)"/g)].map((m) => m[1]);
  if (box !== "0 0 24 24") throw new Error(`${slug}: unexpected viewBox ${box}`);
  if (!paths.length) throw new Error(`${slug}: no path at all`);
  out[slug] = paths;
  console.log(`${slug}: ${paths.length} path(s), ${paths.join("").length} chars`);
}

const body = `// GENERATED FILE — do not edit by hand.
// Written by \`node scripts/update-vendor-icons.mjs\`.
//
// The maker's marks, from lobehub/lobe-icons (MIT). The trademarks remain their owners'; these
// identify whose model a row is about, which is what the editor's own model picker uses them for.
//
// Every one is drawn on a 24×24 box and filled with \`currentColor\`, so it inherits the colour of the
// text beside it. The generator asserts the box, because a mark drawn on a different grid lands
// somewhere else entirely.

export const VENDOR_PATHS: Record<string, string[]> = ${JSON.stringify(out, null, 2)};
`;
await writeFile("src/webview/vendorPaths.generated.ts", body, "utf8");
console.log(`\nwritten: src/webview/vendorPaths.generated.ts (${Object.keys(out).length} marks)`);
