// How a recorder is stopped decides whether there is a file at all.
//
// "Nothing usable was recorded (that file is not a recording)" — on Windows, Node's
// `kill("SIGINT")` terminates the process outright, so ffmpeg died before writing its WAV header.
// ffmpeg is told to stop the way it understands everywhere: a `q` on its standard input.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { recorders } from "../src/core/dictation/capture.js";
import { describeWav } from "../src/core/dictation/wav.js";
import { startRecording } from "../src/extension/whisper.js";

test("every ffmpeg recorder is stopped with q, never with a signal", () => {
  for (const platform of ["win32", "darwin", "linux"]) {
    const ff = recorders(platform).filter((r) => r.program === "ffmpeg");
    assert.ok(ff.length, `no ffmpeg recorder on ${platform}`);
    for (const r of ff) assert.equal(r.stop, "quit", `${platform}: ffmpeg must be stopped with q`);
  }
});

const hasFfmpeg = !spawnSync("ffmpeg", ["-version"]).error;

test("⚠️ ffmpeg stopped with q leaves a readable WAV", { skip: !hasFfmpeg && "ffmpeg is not installed" }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "hivey-rec-"));
  const wav = join(dir, "voice.wav");
  try {
    // A generated tone instead of a microphone: the same writer, the same stop, no hardware.
    const run = startRecording(
      ["ffmpeg", "-hide_banner", "-loglevel", "error", "-re", "-f", "lavfi", "-i", "sine=frequency=440", "-ar", "16000", "-ac", "1", "-y", wav],
      wav,
      "quit",
    );
    await new Promise((r) => setTimeout(r, 1200));
    await run.stop();
    const facts = describeWav(readFileSync(wav));
    assert.equal(facts.ok, true, facts.why);
    assert.ok(facts.seconds > 0.5, `${facts.seconds}s recorded`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
