// Dictation: local by default, and a transcript nobody sends without reading.
//
// Florian asked for « une option pour dicter (parler) ». What shapes it is that a recording of
// somebody's voice is one of the two things this extension cannot pseudonymise — an image is the
// other — so sending it anywhere is a decision, never a default.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  AUDIO_MIME,
  cleanTranscript,
  dictationMode,
  localCommand,
  transcriptionBody,
} from "../src/core/dictation/dictation.js";

const OFF = { command: "", endpoint: "", model: "whisper-1", language: "" };

test("dictation is off until it is configured", () => {
  // Nothing happens, and nothing is sent anywhere, on a fresh install. The project's rule about not
  // calling an unconfigured address applies to a microphone more than to anything else.
  assert.equal(dictationMode(OFF), "off");
});

test("a local command wins over a remote endpoint", () => {
  // ⚠️ The privacy stance made operational. Somebody who has configured both has the means to
  // transcribe on their own machine, and nothing should quietly prefer the network for being faster.
  assert.equal(dictationMode({ ...OFF, command: "whisper-cli -f {file}" }), "local");
  assert.equal(dictationMode({ ...OFF, endpoint: "https://api.test/v1" }), "remote");
  assert.equal(
    dictationMode({ ...OFF, command: "whisper-cli -f {file}", endpoint: "https://api.test/v1" }),
    "local",
  );
});

test("a command without {file} is refused rather than guessed at", () => {
  // ⚠️ Appending the path would guess the tool's argument order, and a wrong guess runs a command the
  // user never wrote — on a configuration they will read as working.
  const problem = localCommand("whisper-cli --output-txt", "/tmp/a.webm");
  assert.ok("message" in problem);
  assert.match(problem.message, /\{file\}/);
});

test("the recording's path is substituted, and a quoted path stays one argument", () => {
  // argv, never a shell line: `~/My Recordings/a.webm` is two arguments to a shell and one to spawn.
  const built = localCommand('"/opt/my tools/whisper" -f {file} --language fr', "/tmp/my recording.webm");
  assert.ok("argv" in built);
  assert.deepEqual(built.argv, ["/opt/my tools/whisper", "-f", "/tmp/my recording.webm", "--language", "fr"]);
});

test("an empty command is a problem, not an empty argv", () => {
  assert.ok("message" in localCommand("   ", "/tmp/a.webm"));
});

test("the multipart body carries the model, the audio and a boundary that matches", () => {
  const audio = new Uint8Array([1, 2, 3, 250, 251]);
  const { body, contentType } = transcriptionBody(audio, { model: "whisper-1", language: "fr" });
  const boundary = /boundary=(.+)$/.exec(contentType)?.[1];
  assert.ok(boundary, "the content type must name the boundary");
  const text = new TextDecoder("latin1").decode(body);
  assert.ok(text.startsWith(`--${boundary}\r\n`), "the body must open with the boundary it declares");
  assert.ok(text.endsWith(`--${boundary}--\r\n`), "and close with it");
  assert.match(text, /name="model"\r\n\r\nwhisper-1/);
  assert.match(text, /name="language"\r\n\r\nfr/);
  assert.match(text, new RegExp(`Content-Type: ${AUDIO_MIME}`));
  // The audio bytes survive unmangled — the reason this is assembled by hand rather than encoded.
  assert.ok(body.includes(250) && body.includes(251), "the raw bytes must not have been re-encoded");
});

test("no language field when none was chosen", () => {
  const { body } = transcriptionBody(new Uint8Array([0]), { model: "whisper-1" });
  assert.equal(/name="language"/.test(new TextDecoder().decode(body)), false);
});

test("whisper.cpp timestamps are not part of the question", () => {
  const raw = "[00:00:00.000 --> 00:00:02.400]   Ajoute une fonction moyenne\n[00:00:02.400 --> 00:00:03.000]   au fichier.\n";
  assert.equal(cleanTranscript(raw), "Ajoute une fonction moyenne au fichier.");
});

test("a recogniser that answered in JSON is still understood", () => {
  assert.equal(cleanTranscript('{"text":"  Bonjour  "}'), "Bonjour");
  // Something that merely starts with a brace is not JSON and must survive as it came.
  assert.equal(cleanTranscript("{this is not json"), "{this is not json");
});

test("a whole answer wrapped in quotes is unwrapped", () => {
  assert.equal(cleanTranscript('"Corrige le test."'), "Corrige le test.");
  // But a quotation inside a sentence is the speaker's, not an artefact.
  assert.equal(cleanTranscript('Il a dit "non" hier.'), 'Il a dit "non" hier.');
});

test("silence produces nothing, not a question made of a placeholder", () => {
  // ⚠️ `[BLANK_AUDIO]` as a question is worse than an empty one, because it looks deliberate.
  assert.equal(cleanTranscript("[BLANK_AUDIO]"), "");
  assert.equal(cleanTranscript("(silence)"), "");
  assert.equal(cleanTranscript("[ Inaudible ]"), "");
  assert.equal(cleanTranscript("   \n  "), "");
  // A real bracketed phrase is kept: only the recognisers' own placeholders go.
  assert.equal(cleanTranscript("[important] revois ce fichier"), "[important] revois ce fichier");
});
