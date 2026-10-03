// What a submission would be rejected for, checked before anybody attempts one.
//
// Publishing an extension is the one operation in this project with no undo: a version number on the
// Marketplace cannot be reused, and a broken page is broken for everybody who looks at it before the
// next release. The failures are also dull — a missing field, an icon two pixels too small, a link
// that resolves in the repository and nowhere else — which is exactly the kind of thing that is
// noticed by a reviewer rather than by its author.
//
// So this reads the ARTIFACT, not the intention. `.vscodeignore` says what should ship; a `.vsix` is
// what does. Asking the second question is the only version worth asking, and it is how the two
// defects this was written for were found:
//
//   • `README.fr.md` ships, and `vsce` rewrites relative links in the ENGLISH readme only. Five image
//     links in the French one pointed at `docs/images/`, which is excluded from the package — so a
//     French reader of the installed extension saw five broken images, in the document that is
//     supposed to be the product's front page in their language.
//   • It also linked to `README.md`, and `vsce` publishes the readme as `readme.md`. That resolves on
//     a case-insensitive filesystem and 404s on Linux, which is where most people run a server.
//
// Neither is a crash, neither has a stack trace, and neither would ever have been caught by a test
// of this extension's behaviour. They are properties of the package.

/** Where a problem is, and why it is one. Ordered by nothing: a caller prints them all. */
export interface Problem {
  /** A short slug, so a caller can group or filter: `link`, `manifest`, `icon`, `changelog`, `bulk`. */
  kind: string;
  /** The file or field the problem is about. */
  where: string;
  /** What is wrong, in the words the person fixing it needs. */
  detail: string;
}

/** A Markdown document that ships inside the package, with its path as published. */
export interface PackagedDoc {
  path: string;
  text: string;
}

/** Only the fields a submission is judged on. Anything else in the manifest is not this module's business. */
export interface ManifestFields {
  name?: string;
  displayName?: string;
  description?: string;
  version?: string;
  publisher?: string;
  icon?: string;
  license?: string;
  repository?: { url?: string } | string;
  categories?: string[];
  engines?: { vscode?: string };
  badges?: Array<{ url?: string; href?: string; description?: string }>;
}

export interface PreflightInput {
  manifest: ManifestFields;
  /** Every path the package holds, exactly as the archive lists them. */
  files: string[];
  /** The Markdown documents among them, read. */
  docs: PackagedDoc[];
  /** The icon's bytes, when the manifest names one and the package holds it. */
  icon?: Buffer;
  /** The shipped changelog, when there is one. */
  changelog?: string;
}

/** The smallest icon the Marketplace accepts. Below this the listing is rejected, not scaled. */
export const MIN_ICON = 128;

/** Fields with no sensible default: a submission without one of these is refused or looks abandoned. */
const REQUIRED = ["name", "displayName", "description", "version", "publisher", "license"] as const;

/**
 * Links a Markdown document makes that the package cannot honour.
 *
 * Case-SENSITIVE, deliberately. `vsce` publishes the readme as `readme.md`, so a link written as
 * `README.md` resolves on macOS and Windows and fails on Linux — and a link that works on two
 * platforms out of three is a defect that gets reported by a user rather than by a build.
 */
export function brokenLinks(docs: PackagedDoc[], files: string[]): Problem[] {
  const present = new Set(files);
  const problems: Problem[] = [];
  for (const doc of docs) {
    const dir = doc.path.includes("/") ? doc.path.slice(0, doc.path.lastIndexOf("/") + 1) : "";
    for (const target of linkTargets(doc.text)) {
      const resolved = resolveAgainst(dir, target);
      if (present.has(resolved)) continue;
      problems.push({
        kind: "link",
        where: doc.path,
        detail: `links to \`${target}\`, which the package does not contain (looked for \`${resolved}\`) — make it an absolute URL or ship the file`,
      });
    }
  }
  return problems;
}

/**
 * Every link target in a Markdown document that is meant to be a path in this package.
 *
 * Absolute URLs, anchors, mail and protocol-relative links are somebody else's problem. A link into
 * the repository on the web is not a problem at all, which is the fix for most of what this finds.
 */
function linkTargets(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/!?\[[^\]]*\]\(([^)\s]+)/g)) {
    const target = (m[1] ?? "").replace(/^<|>$/g, "").split("#")[0] ?? "";
    if (!target) continue; // a bare anchor
    if (/^([a-z][a-z0-9+.-]*:|\/\/)/i.test(target)) continue; // http:, mailto:, //host
    out.push(target);
  }
  return out;
}

/** `a/b/` + `../c` → `a/c`. No `path` module: this is archive arithmetic, not filesystem arithmetic. */
function resolveAgainst(dir: string, target: string): string {
  const parts = target.startsWith("/") ? target.slice(1).split("/") : (dir + target).split("/");
  const stack: string[] = [];
  for (const part of parts) {
    if (!part || part === ".") continue;
    if (part === "..") stack.pop();
    else stack.push(part);
  }
  return stack.join("/");
}

/** Fields a submission needs, and the shapes it needs them in. */
export function manifestProblems(manifest: ManifestFields): Problem[] {
  const problems: Problem[] = [];
  for (const field of REQUIRED) {
    if (!manifest[field]) problems.push({ kind: "manifest", where: field, detail: "missing, and the Marketplace requires it" });
  }
  if (!manifest.icon) {
    problems.push({ kind: "manifest", where: "icon", detail: "no icon: the listing renders a grey placeholder" });
  }
  const repo = typeof manifest.repository === "string" ? manifest.repository : manifest.repository?.url;
  if (!repo) {
    // Not merely cosmetic: it is what `vsce` rewrites the readme's relative links against, so without
    // it every link in the published readme breaks at once.
    problems.push({ kind: "manifest", where: "repository", detail: "absent, so relative links in the readme are not rewritten and all of them break" });
  }
  if (!manifest.categories?.length) {
    problems.push({ kind: "manifest", where: "categories", detail: "absent: the extension appears under no category anybody browses" });
  }
  const vscode = manifest.engines?.vscode;
  if (!vscode || vscode === "*") {
    problems.push({ kind: "manifest", where: "engines.vscode", detail: "a range is required, and `*` claims compatibility with versions nobody has tested" });
  }
  for (const badge of manifest.badges ?? []) {
    // The Marketplace serves badges itself and refuses anything not fetched over TLS from an
    // allow-listed host; an http badge fails the submission rather than rendering unverified.
    if (badge.url && !badge.url.startsWith("https://")) {
      problems.push({ kind: "manifest", where: "badges", detail: `\`${badge.url}\` is not https, which the Marketplace refuses` });
    }
  }
  return problems;
}

/** The icon, read as a PNG header. A size the Marketplace refuses is refused here first. */
export function iconProblems(named: string | undefined, bytes: Buffer | undefined): Problem[] {
  if (!named) return [];
  if (!bytes) return [{ kind: "icon", where: named, detail: "named by the manifest and absent from the package" }];
  // 24 bytes is exactly enough: the signature is 8, the IHDR length and type are 8, and the width
  // and height are the next 8. `> 24` rejected a header that was precisely long enough, and reported
  // a valid PNG as not being one — found by the test that passes the smallest legal header.
  const png = bytes.length >= 24 && bytes.readUInt32BE(0) === 0x89504e47;
  if (!png) return [{ kind: "icon", where: named, detail: "not a PNG — the Marketplace accepts PNG only" }];
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  if (width < MIN_ICON || height < MIN_ICON) {
    return [{ kind: "icon", where: named, detail: `${width}×${height}, and at least ${MIN_ICON}×${MIN_ICON} is required` }];
  }
  return [];
}

/**
 * Does the shipped changelog mention the version being shipped?
 *
 * The quietest release defect there is: the package is correct, the code is correct, and the document
 * that tells people what changed stops one version short. Nothing fails, and nobody notices until
 * somebody asks what is in it.
 */
export function changelogProblems(version: string | undefined, changelog: string | undefined): Problem[] {
  if (!version || changelog === undefined) return [];
  const mentioned = new RegExp(`^#{1,3}\\s.*\\b${version.replace(/\./g, "\\.")}\\b`, "m").test(changelog);
  return mentioned
    ? []
    : [{ kind: "changelog", where: "changelog", detail: `no heading mentions ${version}: the shipped changelog stops short of the version being shipped` }];
}

/** Paths that have no business in a published package, whatever the ignore file says. */
export function bulkProblems(files: string[]): Problem[] {
  const problems: Problem[] = [];
  for (const file of files) {
    if (file.endsWith(".map")) {
      problems.push({ kind: "bulk", where: file, detail: "a source map, which is weight in every download" });
    }
    if (/^extension\/(src|tests|dist-tests|dist-integration)\//.test(file)) {
      problems.push({ kind: "bulk", where: file, detail: "source or test code: shipping it lets what is read drift from what runs" });
    }
  }
  return problems;
}

/** Everything, in one list. An empty list is the only result that means "submit it". */
export function preflight(input: PreflightInput): Problem[] {
  return [
    ...manifestProblems(input.manifest),
    ...iconProblems(input.manifest.icon, input.icon),
    ...brokenLinks(input.docs, input.files),
    ...changelogProblems(input.manifest.version, input.changelog),
    ...bulkProblems(input.files),
  ];
}
