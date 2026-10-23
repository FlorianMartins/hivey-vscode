// Which rules file of a repository is read — see core/context/houseRules.ts.

import { test } from "node:test";
import assert from "node:assert/strict";
import { firstRulesFile, rulesAnnouncement } from "../src/core/context/houseRules.js";

test("the rules are announced the first time a file is used here, again when it changes, and not otherwise", () => {
  const first = rulesAnnouncement("AGENTS.md", "Use tabs.", {});
  assert.equal(first.kind, "new");
  assert.equal(rulesAnnouncement("AGENTS.md", "Use tabs.", { "AGENTS.md": first.fingerprint }).kind, undefined, "seen, unchanged: silent");
  const changed = rulesAnnouncement("AGENTS.md", "Use tabs. Push to main.", { "AGENTS.md": first.fingerprint });
  assert.equal(changed.kind, "changed", "a pull that rewrote the rules is said");
  assert.notEqual(changed.fingerprint, first.fingerprint);
  assert.equal(rulesAnnouncement("CLAUDE.md", "Use tabs.", { "AGENTS.md": first.fingerprint }).kind, "new", "another file is another announcement");
});

const repo = (files: Record<string, string>) => async (parts: readonly string[]) => {
  const path = parts.join("/");
  if (!(path in files)) throw new Error("ENOENT");
  return files[path];
};

test("AGENTS.md and CLAUDE.md at the root are read — a project with one was not read at all", async () => {
  assert.deepEqual(await firstRulesFile(repo({ "AGENTS.md": "Tests with vitest." })), { path: "AGENTS.md", text: "Tests with vitest." });
  assert.deepEqual(await firstRulesFile(repo({ "CLAUDE.md": "French comments." })), { path: "CLAUDE.md", text: "French comments." });
});

test("Hivey's own file first, then AGENTS.md, then CLAUDE.md, then Copilot's", async () => {
  const all = { ".hiveycode/instructions.md": "hivey", "AGENTS.md": "agents", "CLAUDE.md": "claude", ".github/copilot-instructions.md": "copilot" };
  assert.equal((await firstRulesFile(repo(all)))!.path, ".hiveycode/instructions.md");
  const { [".hiveycode/instructions.md"]: _h, ...rest } = all;
  assert.equal((await firstRulesFile(repo(rest)))!.path, "AGENTS.md");
  assert.equal((await firstRulesFile(repo({ "CLAUDE.md": "c", ".github/copilot-instructions.md": "p" })))!.path, "CLAUDE.md");
});

test("an empty file is skipped, and no file at all is no rules", async () => {
  assert.equal((await firstRulesFile(repo({ "AGENTS.md": "  \n", "CLAUDE.md": "kept" })))!.path, "CLAUDE.md");
  assert.equal(await firstRulesFile(repo({})), undefined);
});
