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
// Usage: node scripts/screenshots.mjs [--locale fr] [--theme "Default Light Modern"]
//        [--suffix .light] [--out docs/images]

import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { argv, env, exit } from "node:process";

const args = new Map();
for (let i = 2; i < argv.length; i += 2) args.set(argv[i]?.replace(/^--/, ""), argv[i + 1]);

const locale = args.get("locale") ?? "en";
const outDir = args.get("out") ?? "docs/images";
const suffix = (args.get("suffix") ?? (locale === "en" ? "" : `.${locale}`));
const display = ":97";
const HOLD = Number(args.get("hold") ?? 20_000);
const STARTUP = Number(args.get("startup") ?? 16_000);
const marker = join(tmpdir(), `hivey-code-shot-${process.pid}`);
const CROP = Number(args.get("crop") ?? 1000);

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

/**
 * And what it answers the SECOND question.
 *
 * Short on purpose. The panel scrolls to the newest message, so whatever answers last is what
 * fills the frame — and with two long answers the thing the picture was taken for, the rule
 * between one exchange and the next, sat above the top of the viewport every time. A brief reply
 * leaves the boundary on screen. It is a fixture either way; only its length is a decision.
 */
const SHORT =
  locale === "fr"
    ? "Même règle, appliquée une seule fois : arrondissez la TVA au niveau de la facture, pas ligne par ligne — sinon les centimes dérivent."
    : "Same rule, applied once: round the VAT on the invoice, not line by line — otherwise the cents drift apart.";

/**
 * The answer for the frame taken WHILE it is being written.
 *
 * Long and streamed slowly on purpose, and neither is decoration: the shutter opens ten seconds
 * after the marker, so an answer that lands in half a second can only ever be photographed
 * finished — which is how "does the transcript follow the answer?" went unphotographed through two
 * releases and was reported twice by the person using it.
 */
const LONG =
  locale === "fr"
    ? [
        "Il y a trois endroits où l'arrondi peut se produire, et le choix entre eux est une décision comptable avant d'être une décision technique.",
        "",
        "**1. Ligne par ligne.** Chaque ligne est arrondie au centime avant d'être additionnée. C'est ce que fait la plupart des logiciels de caisse, parce que le client voit le prix de chaque article et doit pouvoir refaire l'addition à la main.",
        "",
        "**2. Au niveau de la facture.** Les lignes sont sommées en pleine précision et le total seul est arrondi. C'est ce que demande l'administration fiscale française pour la TVA, et c'est ce que votre fonction fait déjà — presque.",
        "",
        "**3. Au moment de l'affichage.** Rien n'est arrondi en mémoire ; seul le rendu l'est. C'est le plus propre et le plus difficile à tenir, parce qu'il suffit d'un `toFixed(2)` intermédiaire pour que la valeur arrondie reparte dans un calcul.",
        "",
        "Le défaut de votre code n'est aucun des trois : c'est que `Math.round` arrondit vers plus l'infini. Sur un avoir, donc sur un montant négatif, `-12,5` devient `-12` et non `-13`. Le client est remboursé d'un centime de moins que ce qui lui a été facturé, et tous vos tests passent parce qu'ils portent sur des montants positifs.",
      ].join("\n")
    : [
        "There are three places rounding can happen, and choosing between them is an accounting decision before it is a technical one.",
        "",
        "**1. Line by line.** Each line is rounded to the cent before being added up. This is what most point-of-sale software does, because the customer sees the price of each item and must be able to redo the addition by hand.",
        "",
        "**2. At the invoice level.** Lines are summed at full precision and only the total is rounded. This is what the French tax authority requires for VAT, and it is what your function already does — almost.",
        "",
        "**3. At display time.** Nothing is rounded in memory; only the rendering is. This is the cleanest and the hardest to hold, because one intermediate `toFixed(2)` is enough to send a rounded value back into a calculation.",
        "",
        "The defect in your code is none of the three: it is that `Math.round` rounds towards positive infinity. On a credit note, so on a negative amount, `-12.5` becomes `-12` rather than `-13`. The customer is refunded a cent less than they were charged, and all your tests pass because they are all on positive amounts.",
      ].join("\n");

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
  let body = "";
  req.on("data", (chunk) => (body += chunk));
  req.on("end", () => reply(body));

  function reply(sent) {
  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
  // Matched on the second question's own words, not on "VAT": the attached file is full of
  // `tauxTVA`, and it travels with EVERY request — so a match on the subject matched the first
  // question too, and both answers came back short. Which cost the frame its code block and its
  // scrollbar, and with them the two things the picture was taken to check.
  // Three fixtures, picked on the question's own words. The slow one exists for the frame taken
  // mid-answer; the short one keeps the boundary between two exchanges inside the conversation
  // frame. See each constant for why.
  const slow = /step by step|en détail/i.test(sent);
  const answer = slow ? LONG : /rounding of the VAT itself|arrondi de la TVA/i.test(sent) ? SHORT : ANSWER;
  const chunks = answer.match(/[\s\S]{1,24}/g) ?? [];
  console.log(`[stub] ${slow ? "slow" : "fast"} · ${chunks.length} chunks · ~${Math.round((chunks.length * (slow ? 900 : 12)) / 1000)}s`);
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
    // 12 ms is a real endpoint's pace and finishes in half a second. The slow fixture is paced so
    // that it is still arriving when the shutter opens, which is the whole point of that frame.
  }, slow ? 900 : 12);
  }
});

// Port 0 rather than a fixed one, and not out of tidiness: a stub left running from an earlier
// capture once survived, kept serving its own fixture, and quietly put French text into the
// English screenshots. A port the kernel picks cannot be occupied by yesterday's process.
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const endpoint = `http://127.0.0.1:${server.address().port}/v1`;
console.log(`stub model server on ${endpoint}`);

// One X server for the whole run: starting one per capture would race the editor's own startup.
// Build first. The harness used to run whatever `dist-integration/` happened to contain, so a change
// to the capture sequence was silently ignored and the run replayed the previous one — identical
// timings, identical missing screens, and no way to tell from the output that the new code had never
// executed. Twenty seconds of build against an hour of that.
for (const step of [[], ["--integration"]]) {
  const built = spawnSync("node", ["esbuild.mjs", ...step], { stdio: "inherit" });
  if (built.status !== 0) {
    console.error("build failed; not capturing against a stale bundle");
    exit(1);
  }
}

const xvfb = spawn("Xvfb", [display, "-screen", "0", "1600x1000x24", "-nolisten", "tcp"], { stdio: "ignore" });
await new Promise((r) => setTimeout(r, 1500));

const editor = spawn("node", ["dist-integration/runTest.js"], {
  env: {
    ...env,
    DISPLAY: display,
    HIVEY_CODE_SCREENSHOT: endpoint,
    HIVEY_CODE_LOCALE: locale,
    // The editor's own default, unless a capture asks for another. Named in full — "Dark Modern"
    // is not an identifier VS Code resolves, and an unresolvable theme name does not fall back to
    // the default: it leaves whatever the profile had, which is how the README ended up showing a
    // deep-navy theme nobody chose. The name is verified by sampling a pixel, not by reading it.
    HIVEY_CODE_THEME: args.get("theme") ?? "Default Dark Modern",
    HIVEY_CODE_SCREENSHOT_HOLD: String(HOLD),
    HIVEY_CODE_SCREENSHOT_MARKER: marker,
  },
  stdio: "inherit",
});

/** Photograph the whole screen, then trim the window's own black margin. */
function capture(name) {
  const path = `${outDir}/${name}${suffix}.png`;
  const shot = spawnSync("import", ["-display", display, "-window", "root", path], { stdio: "inherit" });
  if (shot.status !== 0) return false;
  // Trim the window's own black margin, then crop away most of the empty editor. The subject of
  // these images is the panel; a reader looking at a README does not need to see 700 px of unused
  // background to understand where it lives.
  spawnSync("convert", [path, "-trim", "+repage", "-crop", `${CROP}x0+0+0`, "+repage", path]);
  console.log(`captured ${path}`);
  return true;
}

/** What the harness says is on screen right now, or undefined before it has said anything. */
function announced() {
  try {
    return readFileSync(marker, "utf8").trim();
  } catch {
    return undefined;
  }
}

// Wait for the harness to name a screen, photograph it once it has settled, and move on. There is
// no clock here beyond a timeout: the editor decides when it is ready, and says so.
const SCREENS = ["conversation", "pendant", "contexte", "setup", "picker", "historique", "modeles", "permissions"];
// One hold per screen is not the budget: the fixture drives a real conversation between them, and
// the frame taken mid-answer waits for a deliberately slow one to finish. Two screens' worth of
// slack plus a flat minute covers the talking; a deadline that expires mid-run reports every
// remaining screen as "the editor never announced it", which reads like a product fault.
const deadline = Date.now() + STARTUP + HOLD * (SCREENS.length + 4) + 90_000;
for (const name of SCREENS) {
  let seen = false;
  while (Date.now() < deadline) {
    if (announced() === name) {
      // Half the hold in, so the panel has finished laying out and the window has repainted.
      await new Promise((r) => setTimeout(r, HOLD / 2));
      seen = capture(name);
      break;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  if (!seen) console.error(`missed ${name}: the editor never announced it`);
  // Let the harness move on before looking for the next name.
  while (announced() === name && Date.now() < deadline) await new Promise((r) => setTimeout(r, 400));
}

rmSync(marker, { force: true });
editor.kill();
xvfb.kill();
server.close();
console.log("done");
exit(0);
