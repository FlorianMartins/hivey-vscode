// The warning before a remote request — asserted on the source, because the dialog needs a real VS
// Code and a remote model to appear.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const egress = readFileSync("src/extension/egress.ts", "utf8");
const dialog = egress.slice(egress.indexOf("const conversation = target.conversation;"), egress.indexOf("const estimatedTokens"));

test("one Cancel: the modal dialog's own, none added", () => {
  // « il y a deux fois le bouton annuler »: VS Code adds Cancel to every modal dialog.
  assert.match(dialog, /modal: true/);
  assert.doesNotMatch(dialog, /t\("Cancel"\)/);
});

test("asked for credentials anywhere, and for a person's or a company's data from files — with where it is", () => {
  assert.match(dialog, /f\.kind === "secret" \|\| \(WARNED\.has\(f\.kind\) && place\.from !== "typed"\)/);
  assert.match(egress, /const WARNED = new Set<FindingKind>\(\["identity", "business", "term"\]\)/);
  assert.match(dialog, /whereWords\(place\)/, "the dialog says the file and the line");
  assert.match(dialog, /detail: lines\.join/);
});

test("asked once per value per conversation, or never again with \"Always send\"", () => {
  // « la fenêtre se déclenche tout le temps »: asked at every step of an agent turn.
  assert.match(dialog, /!accepted\.has\(f\.value\)/);
  assert.match(dialog, /!this\.secretsAllowed\.has\(conversation\)/);
  assert.match(dialog, /t\("Always send \(this conversation\)"\)/);
  // EVERY request names its conversation — the turn and its steps, and also the sub-agents, the
  // summary and the model comparison. « il n'y a plus que "Envoyer (marqueurs en place)" »: those
  // three did not, and the window lost "Always send" and its memory of what was accepted.
  const chat = readFileSync("src/extension/chat.ts", "utf8");
  const calls = chat.match(/gate\.prepare\(/g)?.length ?? 0;
  assert.ok(calls >= 6);
  assert.equal(chat.match(/gate\.prepare\([^)]*conversation: this\.session\.id/g)?.length, calls, "a request that does not name its conversation");
  assert.match(egress, /isLocal: boolean; conversation: string \}/, "and the type requires it");
});
