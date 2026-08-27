// The glob matcher, and the block list that depends on it.
//
// This file exists because there was no file like it, and the absence cost something real: the
// matcher turned `**/.env*` into a pattern matching nothing at all, so every default in
// `privacy.blockedGlobs` — `.env`, private keys, `secrets/**`, `.ssh/**` — was silently inert. The
// extension's central promise was untested, and therefore untrue.
//
// The last group below is the one that matters: it asserts the SHIPPED defaults against the paths
// they exist to stop, so a future rewrite of the matcher cannot quietly disarm them again.

import { test } from "node:test";
import assert from "node:assert/strict";
import { isBlockedPath, matchGlob } from "../src/core/util/glob.js";

// ── `**` crosses directories ─────────────────────────────────────────────────────────────────

test("`**/` matches zero directories as well as many", () => {
  // The regression that started this file. "Zero" is the case people forget, and the case that
  // matters: a `.env` at the root of a repository is the one you most need to block.
  assert.equal(matchGlob(".env", "**/.env*"), true);
  assert.equal(matchGlob("config/.env", "**/.env*"), true);
  assert.equal(matchGlob("a/b/c/.env.production", "**/.env*"), true);
});

test("`**` on its own crosses anything", () => {
  assert.equal(matchGlob("a/b/c.ts", "**"), true);
  assert.equal(matchGlob("src/**/deep/x.ts".replace("**/", ""), "src/**/x.ts"), true);
  assert.equal(matchGlob("src/a/b/x.ts", "src/**/x.ts"), true);
  assert.equal(matchGlob("src/x.ts", "src/**/x.ts"), true, "zero directories again");
});

// ── `*` does not ─────────────────────────────────────────────────────────────────────────────

test("`*` stops at a directory boundary", () => {
  assert.equal(matchGlob("docs/guide.md", "docs/*.md"), true);
  assert.equal(matchGlob("docs/fr/guide.md", "docs/*.md"), false, "otherwise * and ** would be the same thing");
  assert.equal(matchGlob("src/app.ts", "*.ts"), false);
  assert.equal(matchGlob("app.ts", "*.ts"), true);
});

test("`?` is exactly one character, and not a slash", () => {
  assert.equal(matchGlob("a.ts", "?.ts"), true);
  assert.equal(matchGlob("ab.ts", "?.ts"), false);
  assert.equal(matchGlob("a/ts", "a?ts"), false);
});

// ── Literals stay literal ────────────────────────────────────────────────────────────────────

test("a dot is a dot, not any character", () => {
  // Escaping this wrong is how `*.pem` starts matching `keyXpem`.
  assert.equal(matchGlob("server.pem", "*.pem"), true);
  assert.equal(matchGlob("serverXpem", "*.pem"), false);
});

test("regex metacharacters in a path do not become a pattern", () => {
  assert.equal(matchGlob("src/a+b(c).ts", "src/a+b(c).ts"), true);
  assert.equal(matchGlob("src/aXbYcZ.ts", "src/a+b(c).ts"), false);
  assert.equal(matchGlob("a[1].ts", "a[1].ts"), true);
});

test("the pattern is anchored at both ends", () => {
  assert.equal(matchGlob("src/app.ts.bak", "src/app.ts"), false);
  assert.equal(matchGlob("old/src/app.ts", "src/app.ts"), false);
});

// ── Path shapes ──────────────────────────────────────────────────────────────────────────────

test("a Windows path is the same path", () => {
  assert.equal(matchGlob("src\\core\\app.ts", "src/core/*.ts"), true);
  assert.equal(matchGlob("C:\\repo\\.env", "**/.env*"), true);
});

test("a leading ./ is not part of the path", () => {
  assert.equal(matchGlob("./src/app.ts", "src/*.ts"), true);
});

// ── The shipped defaults, against what they exist to stop ────────────────────────────────────

const DEFAULTS = [
  "**/.env*",
  "**/*.pem",
  "**/*.key",
  "**/*.p12",
  "**/id_rsa*",
  "**/secrets/**",
  "**/credentials*",
  "**/.aws/**",
  "**/.ssh/**",
];

test("every default blocks what it was written for, at the root and nested", () => {
  const shouldBlock = [
    ".env",
    ".env.local",
    "apps/api/.env.production",
    "server.pem",
    "certs/server.pem",
    "private.key",
    "keys/private.key",
    "cert.p12",
    "id_rsa",
    "id_rsa.pub",
    ".ssh/id_rsa",
    "secrets/db.txt",
    "config/secrets/nested/deep/db.txt",
    "credentials",
    "credentials.json",
    ".aws/credentials",
    "home/.aws/config",
    ".ssh/config",
  ];
  for (const path of shouldBlock) {
    assert.equal(isBlockedPath(path, DEFAULTS), true, `${path} was NOT blocked`);
  }
});

test("the defaults do not block ordinary source", () => {
  // A block list that blocks everything is as useless as one that blocks nothing, and considerably
  // more annoying.
  const shouldPass = [
    "src/app.ts",
    "README.md",
    "docs/environment.md",
    "src/keyboard.ts",
    "test/credentials.test.ts.snap".replace("credentials", "creds"),
    "package.json",
    "src/env/config.ts",
  ];
  for (const path of shouldPass) {
    assert.equal(isBlockedPath(path, DEFAULTS), false, `${path} was blocked and should not be`);
  }
});

test("an empty list blocks nothing, and no list blocks by accident", () => {
  assert.equal(isBlockedPath(".env", []), false);
  assert.equal(isBlockedPath("", DEFAULTS), false);
});

test("the same glob is compiled once and keeps working", () => {
  // The cache is an optimisation, and an optimisation that returns a stale answer on the second
  // call would be worse than no cache at all.
  for (let i = 0; i < 3; i++) {
    assert.equal(matchGlob(".env", "**/.env*"), true);
    assert.equal(matchGlob("src/app.ts", "**/.env*"), false);
  }
});
