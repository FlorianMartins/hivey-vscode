// The rule that decides whether a path the model named is inside the workspace.
//
// Written before the fix and failing against it, because the defect it describes was invisible for
// weeks: agent mode refused every absolute path with "leaves the workspace" — the one sentence a
// user reads as "the agent cannot edit anything".

import { test } from "node:test";
import assert from "node:assert/strict";
import { collapsePath, isAbsolutePath, tidyPath, underRoot } from "../src/core/fs/within.js";
import { isBlockedPath } from "../src/core/util/glob.js";

test("an absolute path is recognized in both spellings", () => {
  assert.equal(isAbsolutePath("/home/me/proj/src/a.ts"), true);
  assert.equal(isAbsolutePath("C:\\Users\\me\\proj\\a.ts"), true);
  assert.equal(isAbsolutePath("/c:/Users/me/proj/a.ts"), true, "a URI spells a drive with a leading slash");
  assert.equal(isAbsolutePath("src/a.ts"), false);
  assert.equal(isAbsolutePath("./src/a.ts"), false);
});

test("a UNC share keeps the pair of slashes that makes it one", () => {
  assert.equal(tidyPath("\\\\server\\share\\a.ts"), "//server/share/a.ts");
  assert.equal(isAbsolutePath("\\\\server\\share\\a.ts"), true);
});

test("`..` is resolved, and refused only when it climbs out", () => {
  assert.equal(collapsePath("src/./a/../b.ts"), "src/b.ts");
  // The case the old rule existed for, and the only one it was right about.
  assert.equal(collapsePath("../../etc/passwd"), undefined);
  assert.equal(collapsePath("src/../../etc/passwd"), undefined);
  // Inside, by way of out and back. Textually alarming, actually `src/a.ts`.
  assert.equal(collapsePath("src/sub/../a.ts"), "src/a.ts");
  // A root absorbs it, the way every filesystem does.
  assert.equal(collapsePath("/../etc/passwd"), "/etc/passwd");
});

test("an absolute path inside the open folder is inside it", () => {
  const roots = ["/home/me/proj"];
  assert.deepEqual(underRoot("/home/me/proj/src/a.ts", roots), { root: "/home/me/proj", relative: "src/a.ts" });
  assert.deepEqual(underRoot("/home/me/proj", roots), { root: "/home/me/proj", relative: "" });
  assert.deepEqual(underRoot("/home/me/proj/", roots), { root: "/home/me/proj", relative: "" });
});

test("a path outside every root is outside, and a neighbour with the same prefix is not inside", () => {
  assert.equal(underRoot("/etc/passwd", ["/home/me/proj"]), undefined);
  // The classic off-by-one of a prefix comparison: `/srv/app` does not contain `/srv/application`.
  assert.equal(underRoot("/srv/application/x.ts", ["/srv/app"]), undefined);
  // And `..` that climbs out of the root is out, however it is spelled.
  assert.equal(underRoot("/home/me/proj/../other/x.ts", ["/home/me/proj"]), undefined);
});

test("the nested root wins over the one that contains it", () => {
  const placed = underRoot("/work/outer/inner/src/a.ts", ["/work/outer", "/work/outer/inner"]);
  assert.deepEqual(placed, { root: "/work/outer/inner", relative: "src/a.ts" });
});

test("a Windows path matches the folder however either side spells it", () => {
  const placed = underRoot("C:\\Users\\me\\proj\\src\\a.ts", ["/c:/Users/me/proj"], true);
  assert.deepEqual(placed, { root: "/c:/Users/me/proj", relative: "src/a.ts" });
});

test("case folding is not applied where the filesystem does not fold", () => {
  assert.equal(underRoot("/home/ME/proj/a.ts", ["/home/me/proj"]), undefined);
  assert.deepEqual(underRoot("/home/ME/proj/a.ts", ["/home/me/proj"], true), {
    root: "/home/me/proj",
    relative: "a.ts",
  });
});

// The resolver now accepts an absolute path, which means the privacy list has to be matched against
// one. The list is written workspace-relative — `**/.env*`, `**/.ssh/**` — so this is the contract
// the resolver relies on when it drops the leading slash before asking.
test("the privacy list still matches when a path arrives with its folders in front", () => {
  const globs = ["**/.env*", "**/.ssh/**", "**/*.pem"];
  assert.equal(isBlockedPath("home/me/.ssh/id_rsa", globs), true);
  assert.equal(isBlockedPath("home/me/proj/.env", globs), true);
  assert.equal(isBlockedPath("home/me/proj/certs/server.pem", globs), true);
  assert.equal(isBlockedPath("home/me/proj/src/a.ts", globs), false);
  // And the form the resolver actually passes: tidied, leading slash removed.
  assert.equal(isBlockedPath(tidyPath("/home/me/.ssh/id_rsa").replace(/^\/+/, ""), globs), true);
});
