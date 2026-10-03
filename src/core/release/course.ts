// Is the course still true?
//
// `docs/cours/` explains the whole product to somebody who does not code, and a document like that
// has one failure mode: it describes a version that no longer exists. Nothing breaks, nobody
// notices, and six months later it is actively misleading — which is worse than not existing,
// because a reader trusts it.
//
// This project has been here before. `README.fr.md` announced 284 unit tests and version 0.11.1
// while the repository was at 0.61.0 with 700 of them. Nobody lied: a number written in prose has no
// reason to follow the thing it describes. The answer that worked was `check:numbers` — a gate.
//
// So the course declares, on its first page, the version it was last reviewed for, and this refuses
// the build when that is no longer the current version. Deliberately NOT auto-fixable: rewriting the
// number is exactly the thing that must not be automatic, because the point is to force somebody to
// read the CHANGELOG entries since then and decide what the course now has to say.
//
// The second rule is smaller and catches the other kind of rot: a chapter that exists and is listed
// nowhere, or is listed and does not exist. Either one means the course was edited halfway.

export interface CourseProblem {
  where: string;
  detail: string;
}

/** The line the index carries. Written out so the index and this file cannot drift apart. */
export const VERSION_LINE = /\*\*À jour pour la version ([0-9]+\.[0-9]+\.[0-9]+)\.\*\*/;

/**
 * Does the course still claim the version the project is at?
 *
 * @param index the text of `docs/cours/README.md`.
 * @param version the version in `package.json`.
 */
export function courseVersionProblems(index: string, version: string): CourseProblem[] {
  const found = VERSION_LINE.exec(index);
  if (!found) {
    return [
      {
        where: "docs/cours/README.md",
        detail: "no `**À jour pour la version X.Y.Z.**` line: the course cannot say what it describes",
      },
    ];
  }
  if (found[1] === version) return [];
  return [
    {
      where: "docs/cours/README.md",
      detail:
        `says ${found[1]}, the project is at ${version} — read the CHANGELOG entries since then and ` +
        `update the course, then the line. This is not auto-fixed on purpose: the number is not the work.`,
    },
  ];
}

/**
 * Chapters that exist and are not listed, or are listed and do not exist.
 *
 * @param index the text of the index.
 * @param files the names of the files in `docs/cours/`, the index itself included.
 */
export function courseIndexProblems(index: string, files: string[]): CourseProblem[] {
  const chapters = files.filter((f) => f.endsWith(".md") && f !== "README.md");
  const linked = new Set([...index.matchAll(/\]\(([0-9]{2}-[a-z0-9-]+\.md)\)/g)].map((m) => m[1]!));
  const problems: CourseProblem[] = [];
  for (const chapter of chapters) {
    if (!linked.has(chapter)) {
      problems.push({ where: `docs/cours/${chapter}`, detail: "exists and the index does not link it" });
    }
  }
  for (const link of linked) {
    if (!chapters.includes(link)) {
      problems.push({ where: "docs/cours/README.md", detail: `links \`${link}\`, which does not exist` });
    }
  }
  return problems;
}

export function courseProblems(index: string, files: string[], version: string): CourseProblem[] {
  return [...courseVersionProblems(index, version), ...courseIndexProblems(index, files)];
}
