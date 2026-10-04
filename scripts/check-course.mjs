// Is the course still describing this version — in both languages?
//
// `docs/cours/` (French) and `docs/course/` (English) are the only documents in this repository
// written for somebody who does not code, and their failure mode is silent: they go on describing a
// version that no longer exists. So each declares the version it was reviewed for, and this refuses
// the build when that is no longer true.
//
// ⚠️ And they must agree. A translation is the most reliable thing in a repository to fall behind,
// and the result is worse than staleness — two editions that contradict each other, with no way for
// a reader to tell which is current. So both must carry the same chapters and declare the same
// version, which makes a change to one unfinishable without the other.
//
// Deliberately NOT `--fix`-able. Rewriting the number is the one part that must not be automatic —
// the point is to make somebody read what changed and decide what the course now has to say.

import { readdirSync, readFileSync, existsSync } from "node:fs";
import { exit } from "node:process";

if (!existsSync("dist/eval-report.mjs")) {
  console.error("dist/eval-report.mjs is missing — run `npm run build` first.");
  exit(2);
}
const { courseProblems, courseParityProblems, EDITIONS } = await import(
  new URL("../dist/eval-report.mjs", import.meta.url)
);

const version = JSON.parse(readFileSync("package.json", "utf8")).version;
const problems = [];
const editions = [];

for (const edition of EDITIONS) {
  if (!existsSync(`${edition.dir}/README.md`)) {
    problems.push({ where: `${edition.dir}/README.md`, detail: "is missing — this edition has no index" });
    continue;
  }
  const files = readdirSync(edition.dir);
  editions.push({ dir: edition.dir, files });
  problems.push(...courseProblems(readFileSync(`${edition.dir}/README.md`, "utf8"), files, version, edition));
}
if (editions.length === EDITIONS.length) problems.push(...courseParityProblems(editions));

if (!problems.length) {
  const counts = editions
    .map((e) => `${e.dir}: ${e.files.filter((f) => f.endsWith(".md") && f !== "README.md").length}`)
    .join(", ");
  console.log(`✓ course up to date for ${version} in both editions (${counts} chapters).`);
  exit(0);
}
for (const problem of problems) console.error(`✗ ${problem.where}\n    ${problem.detail}`);
console.error(`\n${problems.length} problem(s).`);
exit(1);
