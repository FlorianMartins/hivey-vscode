// What a submission would be refused for.
//
// These rules exist because of two defects in a package that had already been published: the French
// readme's image links pointed at a directory the package excludes, and it linked to `README.md`
// while `vsce` publishes the readme as `readme.md` — which resolves on macOS and fails on Linux.
// Neither is a crash. Both are properties of the artifact, so the artifact is what gets checked.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  brokenLinks,
  bulkProblems,
  changelogProblems,
  iconProblems,
  manifestProblems,
  preflight,
  MIN_ICON,
  type ManifestFields,
  type PackagedDoc,
} from "../src/core/release/preflight.js";

const SHIPPED = ["extension/package.json", "extension/readme.md", "extension/docs/PRIVACY.md", "extension/media/icon.png"];

function doc(text: string, path = "extension/README.fr.md"): PackagedDoc {
  return { path, text };
}

/** A PNG header of the given size. Only the first 24 bytes are read, so only those are built. */
function png(width: number, height: number): Buffer {
  const b = Buffer.alloc(24);
  b.writeUInt32BE(0x89504e47, 0);
  b.writeUInt32BE(width, 16);
  b.writeUInt32BE(height, 20);
  return b;
}

const GOOD: ManifestFields = {
  name: "hivey-code",
  displayName: "Hivey Code",
  description: "…",
  version: "1.2.3",
  publisher: "hivey",
  icon: "media/icon.png",
  license: "Apache-2.0",
  repository: { url: "https://github.com/x/y.git" },
  categories: ["AI"],
  engines: { vscode: "^1.93.0" },
};

test("a relative link to something the package does not contain is a problem", () => {
  const found = brokenLinks([doc("![x](docs/images/plan.fr.png)")], SHIPPED);
  assert.equal(found.length, 1);
  assert.match(found[0]!.detail, /docs\/images\/plan\.fr\.png/);
});

test("the readme's own casing counts, because Linux counts it", () => {
  // `vsce` publishes the readme as `readme.md`. A link spelled `README.md` resolves on a
  // case-insensitive filesystem and 404s on a case-sensitive one, which is the quietest kind of
  // broken link there is: it works for whoever wrote it.
  assert.equal(brokenLinks([doc("[en](README.md)")], SHIPPED).length, 1);
  assert.equal(brokenLinks([doc("[en](readme.md)")], SHIPPED).length, 0);
});

test("absolute, anchored and mailto links are nobody's problem here", () => {
  const text = [
    "[a](https://example.test/x.png)",
    "[b](http://example.test)",
    "[c](#install)",
    "[d](mailto:x@example.test)",
    "[e](//example.test/x)",
    "[f](docs/PRIVACY.md#secrets)",
  ].join("\n");
  assert.deepEqual(brokenLinks([doc(text)], SHIPPED), []);
});

test("a link climbing out of its own directory is resolved, not guessed at", () => {
  const nested = doc("[privacy](../docs/PRIVACY.md)", "extension/adr/0001.md");
  assert.deepEqual(brokenLinks([nested], SHIPPED), []);
  assert.equal(brokenLinks([doc("[gone](../docs/NOPE.md)", "extension/adr/0001.md")], SHIPPED).length, 1);
});

test("the manifest fields a submission is refused without", () => {
  assert.deepEqual(manifestProblems(GOOD), []);
  const kinds = (m: Partial<ManifestFields>) => manifestProblems({ ...GOOD, ...m }).map((p) => p.where);
  assert.deepEqual(kinds({ publisher: undefined }), ["publisher"]);
  assert.deepEqual(kinds({ icon: undefined }), ["icon"]);
  assert.deepEqual(kinds({ repository: undefined }), ["repository"]);
  assert.deepEqual(kinds({ categories: [] }), ["categories"]);
  // `*` is worse than a missing range: it claims compatibility with versions nobody has run.
  assert.deepEqual(kinds({ engines: { vscode: "*" } }), ["engines.vscode"]);
  assert.deepEqual(kinds({ badges: [{ url: "http://x.test/b.svg" }] }), ["badges"]);
  assert.deepEqual(kinds({ badges: [{ url: "https://x.test/b.svg" }] }), []);
});

test("a repository url is required because the readme's links depend on it", () => {
  // Not cosmetic: it is what `vsce` rewrites the readme's relative links against, so the whole
  // document breaks at once without it. The message has to say so or somebody will "fix" it by
  // deleting the field.
  const [problem] = manifestProblems({ ...GOOD, repository: undefined });
  assert.match(problem!.detail, /relative links/);
});

test("the icon is checked for what the Marketplace checks", () => {
  assert.deepEqual(iconProblems("media/icon.png", png(MIN_ICON, MIN_ICON)), []);
  assert.match(iconProblems("media/icon.png", png(64, 64))[0]!.detail, /64×64/);
  assert.match(iconProblems("media/icon.png", undefined)[0]!.detail, /absent from the package/);
  assert.match(iconProblems("media/icon.png", Buffer.alloc(40))[0]!.detail, /PNG only/);
  // No icon named is a manifest problem, not an icon problem — one complaint per defect.
  assert.deepEqual(iconProblems(undefined, undefined), []);
});

test("a changelog that stops one version short of the release", () => {
  assert.deepEqual(changelogProblems("0.85.0", "# Changelog\n\n## 0.85.0 — today\n"), []);
  assert.equal(changelogProblems("0.85.0", "# Changelog\n\n## 0.84.0 — yesterday\n").length, 1);
  // A version named in prose is not a heading: the entry is what has to exist.
  assert.equal(changelogProblems("0.85.0", "Coming in 0.85.0 one day.").length, 1);
  assert.deepEqual(changelogProblems("0.85.0", undefined), []);
});

test("source maps and source code have no business in the package", () => {
  const found = bulkProblems(["extension/dist/extension.js", "extension/media/webview.js.map", "extension/src/core/x.ts"]);
  assert.deepEqual(found.map((p) => p.where), ["extension/media/webview.js.map", "extension/src/core/x.ts"]);
});

test("every rule is wired into preflight", () => {
  // A rule that is written, tested and never called is the defect this project has already shipped
  // once. One input that violates all five, and all five kinds must come back.
  const problems = preflight({
    manifest: { ...GOOD, publisher: undefined, version: "9.9.9" },
    files: [...SHIPPED, "extension/media/webview.js.map"],
    docs: [doc("![x](docs/images/plan.png)")],
    icon: png(64, 64),
    changelog: "## 0.1.0 — long ago",
  });
  assert.deepEqual(
    [...new Set(problems.map((p) => p.kind))].sort(),
    ["bulk", "changelog", "icon", "link", "manifest"],
  );
});
