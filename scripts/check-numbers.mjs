// The numbers a document claims, checked against the repository.
//
// `README.md` announced 562 unit tests and version 0.39.0 while the repository was at 0.61.0 with
// 699; the French one still said 284 tests and 0.11.1. Nobody lied — a number written in prose has
// no reason to follow the thing it describes, and a figure that has to be remembered will be wrong
// by the next release. So it is checked, and `--fix` rewrites it.
//
// What counts as truth is deliberately cheap to compute: a test is a top-level `test(` in a test
// file, which is what `node:test` reports, and a task is a directory under `eval/tasks`. Running the
// suite to count it would make this a slow gate that nobody puts in CI.

import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { argv, exit } from "node:process";

const fix = argv.includes("--fix");

/** Top-level tests in a directory of test files. Nested ones are subtests and are not counted. */
function countTests(dir, prefix) {
  let total = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      total += countTests(join(dir, entry.name), prefix);
      continue;
    }
    if (!entry.name.endsWith(".ts")) continue;
    total += (readFileSync(join(dir, entry.name), "utf8").match(new RegExp(`^${prefix}test\\(`, "gm")) ?? []).length;
  }
  return total;
}

const truth = {
  version: JSON.parse(readFileSync("package.json", "utf8")).version,
  unit: countTests("tests", ""),
  // The integration suite nests its tests inside one `suite(...)`, so they are indented.
  integration: countTests("src/test/suite", "  "),
  tasks: readdirSync("eval/tasks", { withFileTypes: true }).filter((e) => e.isDirectory()).length,
};

/**
 * Where a number is claimed, and which one it is.
 *
 * Listed rather than guessed: a regular expression loose enough to find every phrasing is also
 * loose enough to rewrite a number that was never a claim about this. A new claim is added here,
 * which is the moment somebody decides it is a claim.
 */
const CLAIMS = [
  { file: "README.md", pattern: /(\d+) tests \(node:test\)/g, of: "unit" },
  { file: "README.md", pattern: /\((\d+) tests, headless\)/g, of: "integration" },
  { file: "README.md", pattern: /`(\d+\.\d+\.\d+)` — used every day/g, of: "version" },
  { file: "README.fr.md", pattern: /(\d+) tests \(node:test\)/g, of: "unit" },
  { file: "README.fr.md", pattern: /\((\d+) tests, headless\)/g, of: "integration" },
  { file: "README.fr.md", pattern: /`(\d+\.\d+\.\d+)` — utilisable au quotidien/g, of: "version" },
  { file: "docs/ROADMAP.md", pattern: /état à la version \*\*(\d+\.\d+\.\d+)\*\*/g, of: "version" },
  { file: "docs/ROADMAP.md", pattern: /\*\*(\d+) tests unitaires\*\*/g, of: "unit" },
  { file: "docs/ROADMAP.md", pattern: /\*\*(\d+) tests d'intégration/g, of: "integration" },
];

const wrong = [];
const touched = new Map();

for (const claim of CLAIMS) {
  const current = touched.get(claim.file) ?? readFileSync(claim.file, "utf8");
  const expected = String(truth[claim.of]);
  let found = false;
  const next = current.replace(claim.pattern, (whole, said) => {
    found = true;
    if (said === expected) return whole;
    wrong.push(`${claim.file}: says ${said} ${claim.of}, repository has ${expected}`);
    return whole.replace(said, expected);
  });
  if (!found) wrong.push(`${claim.file}: the ${claim.of} claim this checks for is no longer there`);
  touched.set(claim.file, next);
}

if (fix) {
  for (const [file, text] of touched) writeFileSync(file, text, "utf8");
  console.log(`Updated: version ${truth.version}, ${truth.unit} unit, ${truth.integration} integration, ${truth.tasks} eval tasks.`);
  exit(0);
}

if (wrong.length) {
  console.error("Numbers in the documentation no longer match the repository:\n");
  for (const line of wrong) console.error(`  ✗ ${line}`);
  console.error("\nRun `npm run check:numbers -- --fix`.");
  exit(1);
}
console.log(`✓ version ${truth.version}, ${truth.unit} unit tests, ${truth.integration} integration tests, ${truth.tasks} eval tasks.`);
