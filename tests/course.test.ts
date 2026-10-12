// The course has to stay true, and a promise is not a mechanism.
//
// `README.fr.md` announced 284 unit tests and version 0.11.1 while the repository was at 0.61.0 with
// 700. Nobody lied — a number written in prose has no reason to follow the thing it describes. What
// worked was a gate, so the course gets one too.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import {
  chapterNumber,
  courseIndexProblems,
  courseParityProblems,
  courseProblems,
  courseVersionProblems,
  EDITIONS,
} from "../src/core/release/course.js";

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

test("a chapter one edition has and the other lacks is a problem", () => {
  // ⚠️ Judged on the chapter NUMBER, never the filename. The slugs are translated, so comparing
  // names would report every chapter as missing from both sides, which is the kind of guard that
  // gets switched off within a week.
  const problems = courseParityProblems([
    { dir: "docs/cours", files: ["README.md", "01-le-decor.md", "02-le-modele.md"] },
    { dir: "docs/course", files: ["README.md", "01-the-stage.md"] },
  ]);
  assert.equal(problems.length, 1);
  assert.equal(problems[0]!.where, "docs/cours/02-le-modele.md");
  assert.match(problems[0]!.detail, /no counterpart in docs\/course\//);
});

test("translated slugs with the same numbers are at parity", () => {
  assert.deepEqual(
    courseParityProblems([
      { dir: "docs/cours", files: ["README.md", "10-le-cout.md", "99-glossaire.md"] },
      { dir: "docs/course", files: ["README.md", "10-the-cost.md", "99-glossary.md"] },
    ]),
    [],
  );
});

test("a chapter number is read from the name, and only from a chapter", () => {
  assert.equal(chapterNumber("07-rag-and-memory.md"), "07");
  assert.equal(chapterNumber("99-glossary.md"), "99");
  assert.equal(chapterNumber("README.md"), undefined);
  assert.equal(chapterNumber("notes.md"), undefined);
});

test("both editions in this repository pass their own gate, and agree", () => {
  // The English edition is the one most likely to fall behind, and a translation that contradicts
  // the original is worse than no translation: a reader cannot tell which one is current.
  const version = JSON.parse(readFileSync("package.json", "utf8")).version as string;
  const editions = EDITIONS.map((e) => ({ dir: e.dir, files: readdirSync(e.dir) }));
  for (const edition of EDITIONS) {
    const found = editions.find((e) => e.dir === edition.dir)!;
    const problems = courseProblems(
      readFileSync(`${edition.dir}/README.md`, "utf8"),
      found.files,
      version,
      edition,
    );
    assert.deepEqual(problems, [], problems.map((p) => `${p.where}: ${p.detail}`).join("\n"));
  }
  const parity = courseParityProblems(editions);
  assert.deepEqual(parity, [], parity.map((p) => `${p.where}: ${p.detail}`).join("\n"));
});
