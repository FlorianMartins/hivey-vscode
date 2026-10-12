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
//
// ⚠️ The third rule exists because the course now has TWO editions, French and English, and a
// translation is the most reliable thing in a repository to fall behind. The failure is worse than
// staleness: the two editions disagree, and a reader has no way to know which one is current. So
// neither edition is allowed to have a chapter the other lacks, and both must declare the SAME
// version — which means a change to one is not finishable without the other. The chapter SLUGS are
// translated (`10-le-cout` ↔ `10-the-cost`), so parity is judged on the chapter NUMBER, which is the
// only part of a filename that means the same thing in both languages.

export interface CourseProblem {
  where: string;
  detail: string;
}

/** The line the index carries. Written out so the index and this file cannot drift apart. */
export const VERSION_LINE = /\*\*À jour pour la version ([0-9]+\.[0-9]+\.[0-9]+)\.\*\*/;

/** The same line, in the English edition. */
export const VERSION_LINE_EN = /\*\*Up to date for version ([0-9]+\.[0-9]+\.[0-9]+)\.\*\*/;

/** One edition of the course: where it lives, and how its index states its version. */
export interface CourseEdition {
  dir: string;
  line: RegExp;
  /** What the missing line should look like, quoted in the error. */
  expected: string;
}

/** The editions that must both exist and must both say the same thing. */
export const EDITIONS: readonly CourseEdition[] = [
  { dir: "docs/cours", line: VERSION_LINE, expected: "**À jour pour la version X.Y.Z.**" },
  { dir: "docs/course", line: VERSION_LINE_EN, expected: "**Up to date for version X.Y.Z.**" },
];

/**
 * Does the course still claim the version the project is at?
 *
 * @param index the text of `docs/cours/README.md`.
 * @param version the version in `package.json`.
 */
export function courseVersionProblems(
  index: string,
  version: string,
  edition: CourseEdition = EDITIONS[0]!,
): CourseProblem[] {
  const found = edition.line.exec(index);
  if (!found) {
    return [
      {
        where: `${edition.dir}/README.md`,
        detail: `no \`${edition.expected}\` line: the course cannot say what it describes`,
      },
    ];
  }
  if (found[1] === version) return [];
  return [
    {
      where: `${edition.dir}/README.md`,
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
export function courseIndexProblems(
  index: string,
  files: string[],
  dir = EDITIONS[0]!.dir,
): CourseProblem[] {
  const chapters = files.filter((f) => f.endsWith(".md") && f !== "README.md");
  const linked = new Set([...index.matchAll(/\]\(([0-9]{2}-[a-z0-9-]+\.md)\)/g)].map((m) => m[1]!));
  const problems: CourseProblem[] = [];
  for (const chapter of chapters) {
    if (!linked.has(chapter)) {
      problems.push({ where: `${dir}/${chapter}`, detail: "exists and the index does not link it" });
    }
  }
  for (const link of linked) {
    if (!chapters.includes(link)) {
      problems.push({ where: `${dir}/README.md`, detail: `links \`${link}\`, which does not exist` });
    }
  }
  return problems;
}

export function courseProblems(
  index: string,
  files: string[],
  version: string,
  edition: CourseEdition = EDITIONS[0]!,
): CourseProblem[] {
  return [
    ...courseVersionProblems(index, version, edition),
    ...courseIndexProblems(index, files, edition.dir),
  ];
}

/** The chapter number a course filename carries, or nothing for a file that is not a chapter. */
export function chapterNumber(file: string): string | undefined {
  const found = /^([0-9]{2})-[a-z0-9-]+\.md$/.exec(file);
  return found?.[1];
}

/**
 * Chapters one edition has and the other does not.
 *
 * ⚠️ Judged on the chapter NUMBER, never the filename: the slugs are translated, so
 * `10-le-cout.md` and `10-the-cost.md` are the same chapter and comparing names would call every
 * chapter missing. The number is the only part of the name that survives translation.
 *
 * @param editions each edition's directory and the names of the files in it.
 */
export function courseParityProblems(
  editions: readonly { dir: string; files: string[] }[],
): CourseProblem[] {
  const numbers = editions.map((e) => ({
    dir: e.dir,
    have: new Map(
      e.files.flatMap((f) => {
        const n = chapterNumber(f);
        return n ? ([[n, f]] as [string, string][]) : [];
      }),
    ),
  }));
  const problems: CourseProblem[] = [];
  for (const mine of numbers) {
    for (const other of numbers) {
      if (other.dir === mine.dir) continue;
      for (const [number, file] of mine.have) {
        if (!other.have.has(number)) {
          problems.push({
            where: `${mine.dir}/${file}`,
            detail:
              `has no counterpart in ${other.dir}/ — the two editions of the course must carry the ` +
              `same chapters, or a reader cannot tell which one is current`,
          });
        }
      }
    }
  }
  return problems;
}
