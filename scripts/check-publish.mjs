// Would a submission be rejected? Asked of the artifact, before anybody tries.
//
// It reads `hivey-code.vsix` — the file that would actually be uploaded — rather than the repository
// and the ignore file, because the gap between those two is where the defects live. The rules are in
// `src/core/release/preflight.ts` with the rest of the core, so they have tests; this only finds the
// inputs and prints the answer.
//
//   node scripts/check-publish.mjs [path-to-vsix]

import { existsSync, readFileSync } from "node:fs";
import { argv, exit } from "node:process";

const file = argv[2] ?? "hivey-code.vsix";
const bundle = new URL("../dist/eval-report.mjs", import.meta.url);

if (!existsSync(file)) {
  console.error(`${file} is missing — package it first:\n  npx @vscode/vsce package --no-dependencies -o ${file}`);
  exit(2);
}
if (!existsSync(new URL(bundle))) {
  console.error("dist/eval-report.mjs is missing — run `npm run build` first.");
  exit(2);
}

const { listZipEntries, readZipEntry, preflight } = await import(bundle);

const data = readFileSync(file);
const files = listZipEntries(data);
const read = (name) => readZipEntry(data, name)?.toString("utf8");

// The manifest inside the package, not the one on disk: they are the same file until somebody edits
// one after packaging, and that is precisely the moment this check is for.
const manifestText = read("extension/package.json");
if (!manifestText) {
  console.error(`${file} has no extension/package.json — that is not a .vsix.`);
  exit(2);
}
const manifest = JSON.parse(manifestText);

const docs = files
  .filter((name) => name.endsWith(".md"))
  .map((name) => ({ path: name, text: read(name) ?? "" }));

const problems = preflight({
  manifest,
  files,
  docs,
  icon: manifest.icon ? readZipEntry(data, `extension/${manifest.icon}`) : undefined,
  changelog: read("extension/changelog.md") ?? read("extension/CHANGELOG.md"),
});

if (!problems.length) {
  console.log(`✓ ${file}: ${files.length} files, ${docs.length} documents, nothing a submission would be refused for.`);
  exit(0);
}

const byKind = new Map();
for (const problem of problems) byKind.set(problem.kind, [...(byKind.get(problem.kind) ?? []), problem]);
for (const [kind, list] of byKind) {
  console.error(`\n${kind} (${list.length}):`);
  for (const problem of list) console.error(`  ${problem.where}\n    ${problem.detail}`);
}
console.error(`\n${problems.length} problem(s). Nothing was published.`);
exit(1);
