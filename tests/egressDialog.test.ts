// The credential warning before a remote request — asserted on the source, because the dialog needs a
// real VS Code and a remote model to appear.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const egress = readFileSync("src/extension/egress.ts", "utf8");
const dialog = egress.slice(egress.indexOf("if (hasSecret"), egress.indexOf("const estimatedTokens"));

test("one Cancel: the modal dialog's own, none added", () => {
  // « il y a deux fois le bouton annuler »: VS Code adds Cancel to every modal dialog.
  assert.match(dialog, /modal: true/);
  assert.doesNotMatch(dialog, /t\("Cancel"\)/);
});

test("\"Always send\" answers the warning for the rest of the conversation, markers kept", () => {
  // « la fenêtre se déclenche tout le temps »: asked at every step of an agent turn.
  assert.match(dialog, /!\(target\.conversation && this\.secretsAllowed\.has\(target\.conversation\)\)/);
  assert.match(dialog, /t\("Always send \(this conversation\)"\)/);
  assert.match(dialog, /this\.secretsAllowed\.add\(target\.conversation\)/);
  // The agent turn names its conversation, on its first request and on every step after.
  const chat = readFileSync("src/extension/chat.ts", "utf8");
  assert.equal(chat.match(/gate\.prepare\([^)]*conversation: this\.session\.id/g)?.length, 2);
});
