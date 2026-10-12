// What the model is told about a codebase it cannot read.

import { test } from "node:test";
import assert from "node:assert/strict";
import { extractSymbols, extractImports } from "../src/core/context/symbols.js";
import { buildRepoMap, rankFiles, isMappable, type MapFile } from "../src/core/context/repomap.js";
import { Session } from "../src/core/session/session.js";

test("top-level symbols come out of TypeScript", () => {
  const src = `
import { z } from "zod";
export interface User { id: string }
export const MAX = 10;
export async function loadUser(id: string): Promise<User> {
  return { id };
}
export class Repo {
  find(id: string): User {
    return { id };
  }
}
export const handle = async (req: Request) => 1;
`;
  const names = extractSymbols("src/user.ts", src).map((s) => s.name);
  assert.deepEqual(new Set(names), new Set(["User", "MAX", "loadUser", "Repo", "find", "handle"]));
});

test("other languages are covered by their own rules", () => {
  assert.ok(extractSymbols("a.py", "class Repo:\n    def find(self):\n        pass\n").some((s) => s.name === "find"));
  assert.ok(extractSymbols("a.go", "func (r *Repo) Find(id string) error {\n").some((s) => s.name === "Find"));
  assert.ok(extractSymbols("a.rs", "pub async fn load(id: u32) -> Result<()> {\n").some((s) => s.name === "load"));
  assert.ok(extractSymbols("a.sql", "create table if not exists hivey.sortie (\n").some((s) => s.name === "sortie"));
});

test("generated and minified lines are skipped rather than mapped", () => {
  const long = `const a=${"x".repeat(500)};\nexport function real() {}\n`;
  const names = extractSymbols("a.js", long).map((s) => s.name);
  assert.deepEqual(names, ["real"]);
});

test("imports are found across the ecosystems the ranker cares about", () => {
  const ts = extractImports("a.ts", 'import { a } from "./lib/a";\nconst b = require("pkg");');
  assert.deepEqual(new Set(ts), new Set(["./lib/a", "pkg"]));
  assert.ok(extractImports("a.py", "from app.models import User").includes("app.models"));
});

test("build artefacts and binaries never enter the map", () => {
  assert.equal(isMappable("node_modules/lib/index.js"), false);
  assert.equal(isMappable("dist/main.js"), false);
  assert.equal(isMappable("assets/logo.png"), false);
  assert.equal(isMappable("src/main.ts"), true);
});

test("the file being edited, its neighbours and its imports rank first", () => {
  const files = [
    { path: "src/pay/checkout.ts", text: 'import { charge } from "./charge";\nexport function checkout() {}' },
    { path: "src/pay/charge.ts", text: "export function charge() {}" },
    { path: "src/unrelated/far.ts", text: "export function far() {}" },
    { path: "README.md", text: "# doc" },
  ];
  const ranked = rankFiles(files, { focusPath: "src/pay/checkout.ts", openPaths: ["src/unrelated/far.ts"] });
  assert.equal(ranked[0]!.path, "src/pay/checkout.ts");
  assert.equal(ranked[1]!.path, "src/pay/charge.ts", "an imported neighbour outranks an open stranger");
});

test("the map respects its token budget and says what it left out", () => {
  const files = Array.from({ length: 200 }, (_, i) => ({
    path: `src/mod${i}/service.ts`,
    text: `export function serviceFunction${i}(argument: string): void {}\nexport class Service${i} {}\n`,
  }));
  const map = buildRepoMap(files, 400, { focusPath: "src/mod3/service.ts" });
  assert.ok(map.tokens <= 400, `budget respected (${map.tokens})`);
  assert.ok(map.filesOmitted > 0);
  assert.ok(map.text.includes("src/mod3/service.ts"), "the focus file is in");
});

test("a map is far smaller than the code it describes", () => {
  const files = Array.from({ length: 40 }, (_, i) => ({
    path: `src/f${i}.ts`,
    text: `export function f${i}() {\n${"  const x = 1;\n".repeat(60)}}\n`,
  }));
  const map = buildRepoMap(files, 4000);
  const full = files.reduce((s, f) => s + f.text.length, 0);
  assert.ok(map.text.length < full / 10, "an order of magnitude smaller, at least");
  assert.equal(map.filesOmitted, 0);
});

// ── Ranking by what was actually asked ──────────────────────────────────────────────────────────
//
// The question is the strongest signal there is about which files matter, and it was not being
// used: the ranking answered "the invoice total is wrong" with whatever happened to be in the front
// tab. On a repository too big to map whole, that is the difference between the model reading the
// file it needs and the model asking for three it does not.

const shop: MapFile[] = [
  { path: "src/totals.ts", text: "export function totalCents(lines) { return 0; }\n" },
  { path: "src/render.ts", text: "export function render(x) { return String(x); }\n" },
  { path: "src/mailer.ts", text: "export function send(to) { return to; }\n" },
  { path: "docs/CHANGELOG.md", text: "# changes\n" },
];

test("a file the question names by symbol outranks one it does not", () => {
  const ranked = rankFiles(shop, { question: "totalCents is off by a cent on refunds" });
  assert.equal(ranked[0]!.path, "src/totals.ts", ranked.map((r) => r.path).join(", "));
});

test("a file the question names by path is found too", () => {
  const ranked = rankFiles(shop, { question: "have a look at src/mailer.ts" });
  assert.equal(ranked[0]!.path, "src/mailer.ts");
});

test("ordinary words in a question rank nothing", () => {
  // Without a stop list, "can you please fix the test error in this file" promotes every file that
  // contains the word "test" — which is all of them — and the question signal becomes noise.
  const flat = rankFiles(shop, { question: "can you please fix the error in this code" });
  const none = rankFiles(shop, {});
  assert.deepEqual(flat.map((r) => r.path), none.map((r) => r.path));
});

test("ordinary words rank nothing in French either", () => {
  // The same assertion in the other language the product speaks. The stop list was English only,
  // so "peux-tu corriger l'erreur dans ce fichier" contributed "corriger", "erreur" and "fichier" as
  // if they named something, and the ranking that decides what the model reads FIRST was partly
  // decided by French prose. Ranking is answer quality: it is what the model sees before it runs out
  // of budget.
  const flat = rankFiles(shop, { question: "peux tu corriger erreur dans ce fichier" });
  const none = rankFiles(shop, {});
  assert.deepEqual(flat.map((r) => r.path), none.map((r) => r.path));
});

test("a symbol named in a French question still ranks its file first", () => {
  // The other half: filtering prose must not filter the identifier the question is about.
  const ranked = rankFiles(shop, { question: "pourquoi totalCents est faux sur les remboursements ?" });
  assert.equal(ranked[0]!.path, "src/totals.ts", ranked.map((r) => r.path).join(", "));
});

test("what the focus file imports, and what THOSE import, both outrank a stranger", () => {
  const files: MapFile[] = [
    { path: "src/app.ts", text: "import { helper } from './helper.js';\nexport const app = 1;\n" },
    { path: "src/helper.ts", text: "import { deep } from './deep.js';\nexport function helper() {}\n" },
    { path: "src/deep.ts", text: "export function deep() {}\n" },
    { path: "src/unrelated.ts", text: "export function unrelated() {}\n" },
  ];
  const ranked = rankFiles(files, { focusPath: "src/app.ts" });
  const at = (p: string) => ranked.findIndex((r) => r.path === p);
  assert.equal(ranked[0]!.path, "src/app.ts");
  assert.ok(at("src/helper.ts") < at("src/deep.ts"), "a direct import should beat a second-degree one");
  assert.ok(at("src/deep.ts") < at("src/unrelated.ts"), "a second-degree import should beat a stranger");
});

test("an import that names a file with its .js extension still finds the .ts on disk", () => {
  // The defect this exists against was silent and total: in a TypeScript ESM project every import
  // ends in `.js` and every file ends in `.ts`, so the whole import-graph half of the ranking never
  // fired — on exactly the kind of repository this extension is written in.
  const files: MapFile[] = [
    { path: "src/app.ts", text: "import { helper } from './helper.js';\n" },
    { path: "src/helper.ts", text: "export function helper() {}\n" },
    { path: "src/stranger.ts", text: "export function stranger() {}\n" },
  ];
  const ranked = rankFiles(files, { focusPath: "src/app.ts" });
  const at = (p: string) => ranked.findIndex((r) => r.path === p);
  assert.ok(at("src/helper.ts") < at("src/stranger.ts"), ranked.map((r) => `${r.path}:${r.score}`).join(" "));
});

test("a partial name does not claim a longer one", () => {
  // `./helper` must not also match `src/otherhelper.ts`, or the graph promotes files at random.
  const files: MapFile[] = [
    { path: "src/app.ts", text: "import { helper } from './helper.js';\n" },
    { path: "src/helper.ts", text: "export function helper() {}\n" },
    { path: "src/otherhelper.ts", text: "export function otherHelper() {}\n" },
  ];
  const ranked = rankFiles(files, { focusPath: "src/app.ts" });
  const score = (p: string) => ranked.find((r) => r.path === p)!.score;
  assert.ok(score("src/helper.ts") > score("src/otherhelper.ts"), "otherhelper was treated as the import");
});

test("the question being asked is never dropped, however big what it carries", () => {
  // It used to be. An entry larger than the whole budget failed the same test as an old one and was
  // trimmed away — so a question with one oversized file attached was removed from the request it
  // had just been typed into, and the model answered whatever was left of the conversation.
  const session = new Session();
  session.add({
    role: "user",
    text: "Why does this crash?",
    context: [{ kind: "file", label: "huge.ts", body: "const x = 1;\n".repeat(60_000) }],
  });
  const built = session.build({ systemPrompt: "rules", maxTokens: 8_000, nonce: "n" });
  const sent = built.messages.map((m) => m.content).join("\n");
  assert.match(sent, /Why does this crash\?/, "the question itself was dropped from the request");
  assert.ok(built.estimatedTokens < 20_000, `the budget was ignored (${built.estimatedTokens})`);
});
