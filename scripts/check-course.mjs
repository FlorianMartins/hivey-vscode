// Is the course still describing this version?
//
// `docs/cours/` is the only document in this repository written for somebody who does not code, and
// its failure mode is silent: it goes on describing a version that no longer exists. So it declares
// the version it was reviewed for, and this refuses the build when that is no longer true.
//
// Deliberately NOT `--fix`-able. Rewriting the number is the one part that must not be automatic —
// the point is to make somebody read what changed and decide what the course now has to say.

import { readdirSync, readFileSync, existsSync } from "node:fs";
import { exit } from "node:process";

const DIR = "docs/cours";
if (!existsSync(`${DIR}/README.md`)) {
  console.error(`${DIR}/README.md is missing — the course has no index.`);
  exit(2);
}
if (!existsSync("dist/eval-report.mjs")) {
  console.error("dist/eval-report.mjs is missing — run `npm run build` first.");
  exit(2);
}

const { courseProblems } = await import(new URL("../dist/eval-report.mjs", import.meta.url));
const version = JSON.parse(readFileSync("package.json", "utf8")).version;
const problems = courseProblems(readFileSync(`${DIR}/README.md`, "utf8"), readdirSync(DIR), version);

if (!problems.length) {
  const chapters = readdirSync(DIR).filter((f) => f.endsWith(".md") && f !== "README.md").length;
  console.log(`✓ ${DIR}: ${chapters} chapters, up to date for ${version}.`);
  exit(0);
}
for (const problem of problems) console.error(`✗ ${problem.where}\n    ${problem.detail}`);
console.error(`\n${problems.length} problem(s).`);
exit(1);
