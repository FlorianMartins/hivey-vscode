// The course has to stay true, and a promise is not a mechanism.
//
// `README.fr.md` announced 284 unit tests and version 0.11.1 while the repository was at 0.61.0 with
// 700. Nobody lied — a number written in prose has no reason to follow the thing it describes. What
// worked was a gate, so the course gets one too.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { courseIndexProblems, courseProblems, courseVersionProblems } from "../src/core/release/course.js";

const index = (version: string, links: string[] = []) =>
  `# Le cours\n\n**À jour pour la version ${version}.**\n\n` + links.map((l) => `| [x](${l}) |`).join("\n");

test("a course that describes a version the project has left is refused", () => {
  assert.deepEqual(courseVersionProblems(index("1.2.3"), "1.2.3"), []);
  const stale = courseVersionProblems(index("1.2.3"), "1.3.0");
  assert.equal(stale.length, 1);
  assert.match(stale[0]!.detail, /says 1\.2\.3, the project is at 1\.3\.0/);
  // And the message has to say that rewriting the number is not the work, or somebody will just
  // rewrite the number.
  assert.match(stale[0]!.detail, /not auto-fixed on purpose/);
});

test("a course that does not say which version it describes is refused too", () => {
  const [problem] = courseVersionProblems("# Le cours\n\nPas de ligne de version.", "1.0.0");
  assert.match(problem!.detail, /cannot say what it describes/);
});

test("a chapter nobody links, and a link to no chapter", () => {
  // Both are the same defect seen from two sides: the course was edited halfway.
  const orphan = courseIndexProblems(index("1.0.0", ["01-a.md"]), ["README.md", "01-a.md", "02-b.md"]);
  assert.equal(orphan.length, 1);
  assert.match(orphan[0]!.detail, /index does not link it/);

  const dead = courseIndexProblems(index("1.0.0", ["01-a.md", "02-b.md"]), ["README.md", "01-a.md"]);
  assert.equal(dead.length, 1);
  assert.match(dead[0]!.detail, /does not exist/);

  assert.deepEqual(courseIndexProblems(index("1.0.0", ["01-a.md"]), ["README.md", "01-a.md"]), []);
});

test("the course in this repository passes its own gate", () => {
  // The gate is worth nothing if the document it guards does not satisfy it, and a chapter added
  // without a line in the table of contents is exactly the edit somebody makes in a hurry.
  const version = JSON.parse(readFileSync("package.json", "utf8")).version as string;
  const problems = courseProblems(readFileSync("docs/cours/README.md", "utf8"), readdirSync("docs/cours"), version);
  assert.deepEqual(problems, [], problems.map((p) => `${p.where}: ${p.detail}`).join("\n"));
});
