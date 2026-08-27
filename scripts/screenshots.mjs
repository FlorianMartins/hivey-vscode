// Capture the panel's screenshots from a real VS Code.
//
// The images in the README are not mock-ups and are not meant to become mock-ups: a screenshot
// drawn in a design tool stops being true the first time the code moves, and nobody notices,
// because nobody diffs a picture. So this launches the extension in a real editor on a virtual
// display, drives it through the integration harness, and photographs the window at each screen.
//
// The only thing faked is the model. A stub HTTP server answers the chat request with a fixed,
// sensible reply — because the alternative is either shipping a GPU with the build or publishing
// screenshots whose content changes every time a sampler rolls differently. The interface in the
// image is the real interface; the sentence inside it is a fixture.
//
// Usage: node scripts/screenshots.mjs [--locale fr] [--out docs/images]

import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { mkdirSync } from "node:fs";
import { argv, env, exit } from "node:process";

const args = new Map();
for (let i = 2; i < argv.length; i += 2) args.set(argv[i]?.replace(/^--/, ""), argv[i + 1]);

const locale = args.get("locale") ?? "en";
const outDir = args.get("out") ?? "docs/images";
const suffix = locale === "en" ? "" : `.${locale}`;
const display = ":97";
const HOLD = Number(args.get("hold") ?? 20_000);
const STARTUP = Number(args.get("startup") ?? 16_000);

mkdirSync(outDir, { recursive: true });

/** What the stub model answers. Written once, so every capture shows the same sentence. */
const ANSWER =
  locale === "fr"
    ? "Non : `ht * (1 + tauxTVA)` produit un flottant non arrondi, donc `19.999999999999996` pour une " +
      "facture à 20 €. Sur une facture le montant doit être arrondi **au centime**, et l'arrondi doit " +
      "porter sur le total TTC, pas sur chaque ligne.\n\n```ts\nexport function totalTTC(lignes: Ligne[], tauxTVA = 0.2): number {\n" +
      "  const ht = lignes.reduce((somme, l) => somme + l.prixUnitaire * l.quantite, 0);\n" +
      "  return Math.round(ht * (1 + tauxTVA) * 100) / 100;\n}\n```\n\n" +
      "Deux points à vérifier ensuite : la règle d'arrondi retenue (commercial ou bancaire) et le fait " +
      "que `prixUnitaire` soit bien stocké en centimes en base."
    : "No: `ht * (1 + tauxTVA)` returns an unrounded float, so a €20 invoice comes out as " +
      "`19.999999999999996`. On an invoice the amount has to be rounded **to the cent**, and the " +
      "rounding belongs on the gross total rather than on each line.\n\n```ts\nexport function totalTTC(lignes: Ligne[], tauxTVA = 0.2): number {\n" +
      "  const ht = lignes.reduce((somme, l) => somme + l.prixUnitaire * l.quantite, 0);\n" +
      "  return Math.round(ht * (1 + tauxTVA) * 100) / 100;\n}\n```\n\n" +
      "Two things worth settling next: which rounding rule applies (half-up or banker's), and whether " +
      "`prixUnitaire` is stored in cents in the database.";

const MODELS = [
  { id: "qwen2.5-coder:7b", name: "Qwen2.5 Coder 7B" },
  { id: "deepseek-coder-v2:16b", name: "DeepSeek Coder V2 16B" },
  { id: "codellama:13b", name: "Code Llama 13B" },
];

const server = createServer((req, res) => {
  if (req.url?.endsWith("/models")) {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ data: MODELS.map((m) => ({ id: m.id, name: m.name })) }));
    return;
  }
  if (req.url?.includes("/version")) {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ version: "0.5.7" }));
    return;
  }
  // Stream the fixture the way a real endpoint would, so the panel's streaming path is what is
  // photographed rather than a shortcut that only exists for screenshots.
  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
  const chunks = ANSWER.match(/[\s\S]{1,24}/g) ?? [];
  let i = 0;
  const timer = setInterval(() => {
    if (i >= chunks.length) {
      clearInterval(timer);
      res.write(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }] })}\n\n`);
      res.write("data: [DONE]\n\n");
      res.end();
      return;
    }
    res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: chunks[i++] } }] })}\n\n`);
  }, 12);
});

// Port 0 rather than a fixed one, and not out of tidiness: a stub left running from an earlier
// capture once survived, kept serving its own fixture, and quietly put French text into the
// English screenshots. A port the kernel picks cannot be occupied by yesterday's process.
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const endpoint = `http://127.0.0.1:${server.address().port}/v1`;
console.log(`stub model server on ${endpoint}`);

// One X server for the whole run: starting one per capture would race the editor's own startup.
const xvfb = spawn("Xvfb", [display, "-screen", "0", "1600x1000x24", "-nolisten", "tcp"], { stdio: "ignore" });
await new Promise((r) => setTimeout(r, 1500));

const editor = spawn("node", ["dist-integration/runTest.js"], {
  env: {
    ...env,
    DISPLAY: display,
    FORGE_SCREENSHOT: endpoint,
    FORGE_LOCALE: locale,
    FORGE_SCREENSHOT_HOLD: String(HOLD),
  },
  stdio: "inherit",
});

/** Photograph the whole screen, then trim the window's own black margin. */
function capture(name) {
  const path = `${outDir}/${name}${suffix}.png`;
  const shot = spawnSync("import", ["-display", display, "-window", "root", path], { stdio: "inherit" });
  if (shot.status !== 0) return false;
  spawnSync("convert", [path, "-trim", "+repage", path]);
  console.log(`captured ${path}`);
  return true;
}

// The harness holds each screen for HOLD ms in turn; we photograph the middle of each window, so
// neither clock has to know the other's exact offsets — only that the windows are equal.
const SCREENS = ["conversation", "historique", "modeles", "permissions"];

// The editor has to download nothing on a warm machine but still has to start, activate the
// extension and lay out the panel. STARTUP is that, generously.
await new Promise((r) => setTimeout(r, STARTUP + HOLD / 2));
capture(SCREENS[0]);
for (const name of SCREENS.slice(1)) {
  await new Promise((r) => setTimeout(r, HOLD));
  capture(name);
}

editor.kill();
xvfb.kill();
server.close();
console.log("done");
exit(0);
