// The repository map kept for the conversation, what changed since said after the transcript — see
// core/context/structure.ts.

import { test } from "node:test";
import assert from "node:assert/strict";
import { isStructural, netChanges, structureNote } from "../src/core/context/structure.js";
import { turnDirectives } from "../src/core/prompts.js";

test("net changes: created then deleted is nothing, deleted then created again is nothing", () => {
  const net = netChanges([
    { kind: "created", path: "src/a.ts" },
    { kind: "created", path: "src/tmp.ts" },
    { kind: "deleted", path: "src/tmp.ts" },
    { kind: "deleted", path: "src/old.ts" },
    { kind: "deleted", path: "src/b.ts" },
    { kind: "created", path: "src/b.ts" },
  ]);
  assert.deepEqual(net, { created: ["src/a.ts"], deleted: ["src/old.ts"] });
});

test("dependencies and build output are not the structure", () => {
  assert.equal(isStructural("node_modules/react/index.js"), false);
  assert.equal(isStructural("packages/app/dist/main.js"), false);
  assert.equal(isStructural(".git/HEAD"), false);
  assert.equal(isStructural("src/dist-utils.ts"), true, "a name that only starts like one");
});

test("said after the transcript, in the turn's directives — never in the cached prefix", () => {
  const note = structureNote({ created: ["src/succes.ts"], deleted: [] });
  assert.equal(note, "[Since the repository map above was taken — created: src/succes.ts.]");
  assert.equal(structureNote({ created: [], deleted: [] }), "");
  assert.match(turnDirectives({ structure: note, language: "Reply in French." }), /created: src\/succes\.ts[\s\S]*Reply in French/);
});
