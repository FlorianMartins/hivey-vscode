// Dictation that runs on the machine.
//
// What is tested here is everything that can be wrong without a microphone: which archive this
// machine needs, where it comes from, what is run, and what is read back. The one thing a test cannot
// check — that a voice becomes the right words — was checked by hand, once, end to end: the Linux
// build and the `tiny.en` model were downloaded and transcribed the project's own sample correctly.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  WHISPER_BUILD,
  WHISPER_MODELS,
  modelFor,
  modelUrl,
  parseWhisperText,
  whisperArgv,
  whisperAsset,
  whisperBinary,
  whisperUrl,
} from "../src/core/dictation/local.js";
import { readTar } from "../src/core/archive/tar.js";
import { howToRecord, recordArgv, recorders } from "../src/core/dictation/capture.js";
import { gzipSync } from "node:zlib";
import { encodeWav, SPEECH_SAMPLE_RATE, WAV_HEADER_BYTES } from "../src/core/dictation/wav.js";

test("each machine is offered the archive built for it", () => {
  assert.equal(whisperAsset({ platform: "linux", arch: "x64" }), "whisper-bin-ubuntu-x64.tar.gz");
  assert.equal(whisperAsset({ platform: "linux", arch: "arm64" }), "whisper-bin-ubuntu-arm64.tar.gz");
  assert.equal(whisperAsset({ platform: "win32", arch: "x64" }), "whisper-bin-x64.zip");
  assert.equal(whisperAsset({ platform: "win32", arch: "arm64" }), "whisper-bin-win-cpu-arm64.zip");
});

test("⚠️ macOS has no prebuilt command, and says so rather than downloading 60 MB to fail", () => {
  // The project publishes an `xcframework` for embedding in an app, not a program you can run. The
  // caller turns this `undefined` into the one-line Homebrew instruction, after which the same
  // detection finds `whisper-cli` on PATH and nothing else changes.
  assert.equal(whisperAsset({ platform: "darwin", arch: "arm64" }), undefined);
  assert.equal(whisperAsset({ platform: "darwin", arch: "x64" }), undefined);
  // And an architecture nobody builds for is the same answer, for the same reason.
  assert.equal(whisperAsset({ platform: "linux", arch: "ppc64" }), undefined);
});

test("⚠️ the build is PINNED, never 'latest'", () => {
  // A measurement has to be reproducible and so does a bug report. "It stopped transcribing" is
  // answerable when everybody has the same binary and unanswerable when the answer depends on the day
  // it was installed. Moving it is a commit, which is the point.
  assert.match(WHISPER_BUILD, /^b\d+$/);
  assert.ok(!/latest/.test(whisperUrl("x.zip")), "the download follows a moving target");
  assert.ok(whisperUrl("whisper-bin-x64.zip").includes(WHISPER_BUILD));
});

test("the binary is named the way each platform names it", () => {
  assert.equal(whisperBinary("win32"), "whisper-cli.exe");
  assert.equal(whisperBinary("linux"), "whisper-cli");
  assert.equal(whisperBinary("darwin"), "whisper-cli");
});

test("every offered model says how big it is", () => {
  // A download nobody sized is a download nobody agreed to: the figure is what the consent question
  // is built from, so a model without one would ask for permission while hiding the cost.
  assert.ok(WHISPER_MODELS.length >= 3);
  for (const m of WHISPER_MODELS) {
    assert.ok(m.mb > 0, `${m.id} does not say its size`);
    assert.ok(m.hint.length > 20, `${m.id} does not say what it is for`);
    assert.ok(modelUrl(m.file).endsWith(m.file));
  }
  // Smallest first, because that is the order the question offers them in.
  const sizes = WHISPER_MODELS.map((m) => m.mb);
  assert.deepEqual([...sizes].sort((a, b) => a - b), sizes, "the list is not smallest-first");
  // An unknown id falls back to the smallest rather than to nothing: a stale setting must not break
  // dictation, it must transcribe with the safest choice.
  assert.equal(modelFor("nonsense").id, WHISPER_MODELS[0]!.id);
});

test("what is run, and what is left out of it", () => {
  assert.deepEqual(whisperArgv("/w/whisper-cli", "/w/m.bin", "/tmp/a.wav"), [
    "/w/whisper-cli", "-m", "/w/m.bin", "-f", "/tmp/a.wav", "-nt", "-np",
  ]);
  // ⚠️ A language is passed only when there is one. Whisper's own detection beats a wrong hint, and
  // an empty setting is a wrong hint — `-l ""` is not "decide for yourself", it is a language of no
  // name.
  assert.deepEqual(whisperArgv("w", "m", "a.wav", "   "), ["w", "-m", "m", "-f", "a.wav", "-nt", "-np"]);
  assert.deepEqual(whisperArgv("w", "m", "a.wav", "fr"), ["w", "-m", "m", "-f", "a.wav", "-nt", "-np", "-l", "fr"]);
});

test("⚠️ the program's own log is not what you said", () => {
  // Taken verbatim from a real run on this machine. whisper.cpp writes its diagnostics to stdout
  // beside the transcript, so returning the whole of stdout hands the user a line of C++ logging as
  // though they had spoken it.
  const real = [
    "whisper_init_from_file_with_params_no_state: loading model from '../ggml-tiny.en.bin'",
    "read_audio_data: reading audio data from '../jfk.wav' ...",
    "read_audio_data: trying to decode with miniaudio",
    "",
    " And so my fellow Americans ask not what your country can do for you, ask what you can do for your country.",
  ].join("\n");
  assert.equal(
    parseWhisperText(real),
    "And so my fellow Americans ask not what your country can do for you, ask what you can do for your country.",
  );
  assert.equal(parseWhisperText("whisper_print_timings: total time = 1ms"), "");
});

test("the tar reader unpacks a release, and refuses what it should not follow", () => {
  // Built here rather than fetched: a test that downloads is a test that fails when the network does.
  const header = (path: string, size: number, type: string, mode = 0o755) => {
    const b = Buffer.alloc(512);
    b.write(path, 0, "utf8");
    b.write(mode.toString(8).padStart(7, "0") + "\0", 100, "ascii");
    b.write(size.toString(8).padStart(11, "0") + "\0", 124, "ascii");
    b.write(type, 156, "ascii");
    return b;
  };
  const file = (path: string, body: string, type = "0") => {
    const data = Buffer.from(body, "utf8");
    const pad = Buffer.alloc(Math.ceil(data.length / 512) * 512 - data.length);
    return Buffer.concat([header(path, data.length, type), data, pad]);
  };
  const link = (path: string, target: string) => {
    const b = header(path, 0, "2");
    b.write(target, 157, "ascii");
    return b;
  };
  const archive = Buffer.concat([
    file("dir/", "", "5"),
    file("dir/whisper-cli", "ELF"),
    // ⚠️ REPORTED, never followed. The first version of this reader skipped symlinks entirely, on the
    // reasoning that "a release of compiled binaries has none" — a premise, not a fact, and false:
    // whisper.cpp's Linux build ships `libwhisper.so.1` as a link, and dropping it produced an
    // install that died at run time on `cannot open shared object file`. Found by running it.
    link("dir/libwhisper.so.1", "libwhisper.so.1.9.5"),
    link("dir/evil", "../../../etc/passwd"),
    file("dir/libwhisper.so.1.9.5", "LIB"),
    Buffer.alloc(1024),
  ]);
  for (const input of [archive, gzipSync(archive)]) {
    const entries = readTar(input);
    assert.deepEqual(entries.map((e) => e.path), [
      "dir/whisper-cli",
      "dir/libwhisper.so.1",
      "dir/evil",
      "dir/libwhisper.so.1.9.5",
    ]);
    assert.equal(entries[0]!.data.toString(), "ELF");
    assert.equal(entries[0]!.mode & 0o111, 0o111, "the mode is lost, so the binary cannot be run");
    // A link carries its target and no bytes; what the caller does with it is the caller's decision,
    // and the one this project makes is to copy the target when it is inside the archive.
    assert.equal(entries[1]!.link, "libwhisper.so.1.9.5");
    assert.equal(entries[1]!.data.length, 0);
    assert.equal(entries[2]!.link, "../../../etc/passwd", "an escaping target must still be VISIBLE to be refused");
  }
});

test("a WAV is forty-four bytes of header and then the samples", () => {
  // ⚠️ This exists because whisper.cpp decodes WAV, FLAC and MP3 — and `MediaRecorder` produces Opus
  // in WebM, which is none of them. The remote services accept the WebM happily, so nothing upstream
  // had ever had to care; a local transcriber is the first consumer that does.
  const wav = encodeWav([Float32Array.from([0, 1, -1, 0.5])], SPEECH_SAMPLE_RATE);
  const view = new DataView(wav.buffer);
  const tag = (at: number) => String.fromCharCode(...wav.slice(at, at + 4));
  assert.equal(wav.length, WAV_HEADER_BYTES + 4 * 2);
  assert.equal(tag(0), "RIFF");
  assert.equal(tag(8), "WAVE");
  assert.equal(tag(12), "fmt ");
  assert.equal(tag(36), "data");
  assert.equal(view.getUint32(4, true), 36 + 8, "the RIFF size counts everything after itself");
  assert.equal(view.getUint16(20, true), 1, "not uncompressed PCM");
  assert.equal(view.getUint16(22, true), 1, "not mono");
  assert.equal(view.getUint32(24, true), 16_000);
  assert.equal(view.getUint32(28, true), 32_000, "bytes per second is rate × channels × 2");
  assert.equal(view.getUint16(34, true), 16);
  assert.equal(view.getUint32(40, true), 8, "the data size is not the sample count × 2");
  // The samples themselves, at both ends of the range.
  assert.equal(view.getInt16(44, true), 0);
  assert.equal(view.getInt16(46, true), 32767);
  assert.equal(view.getInt16(48, true), -32768);
});

test("⚠️ a sample past the limit is clamped, not wrapped", () => {
  // Scaling an out-of-range float wraps it: 1.2 becomes a large negative number, which is a loud
  // click. A recording made with the gain up is full of them, and a transcriber hears every one.
  const wav = encodeWav([Float32Array.from([1.5, -1.5])], 16_000);
  const view = new DataView(wav.buffer);
  assert.equal(view.getInt16(44, true), 32767);
  assert.equal(view.getInt16(46, true), -32768);
});

test("several chunks make one file", () => {
  // A recording arrives in whatever pieces the audio callback produced; the file is one.
  const one = encodeWav([Float32Array.from([0.25, 0.5, 0.75])], 16_000);
  const many = encodeWav([Float32Array.from([0.25]), Float32Array.from([0.5, 0.75])], 16_000);
  assert.deepEqual([...one], [...many]);
});

// ── Recording, from outside the panel ────────────────────────────────────────────────────────────

test("⚠️ every recorder writes 16 kHz mono, because that is what a speech model reads", () => {
  // The panel cannot record at all — VS Code grants `media` to the workbench and withholds it from a
  // `vscode-webview://` origin, with no prompt and no setting. So a program on the machine does it,
  // and every one of them has to be asked for the same thing or whisper hears a chipmunk.
  for (const platform of ["linux", "darwin", "win32"]) {
    const list = recorders(platform);
    assert.ok(list.length >= 1, `${platform} has no recorder at all`);
    for (const r of list) {
      const argv = r.args("/tmp/v.wav").join(" ");
      assert.match(argv, /16000|16k/, `${r.program} does not ask for 16 kHz`);
      assert.ok(argv.includes("/tmp/v.wav"), `${r.program} never says where to write`);
      assert.ok(r.from.length > 2, `${r.program} does not say what to install it from`);
    }
  }
  // And the advice names a package rather than saying "install something".
  for (const platform of ["linux", "darwin", "win32"]) {
    assert.match(howToRecord(platform), /install/, `${platform} has no instruction`);
  }
});

test("a recording command the user wrote is split the way a shell would, without being one", () => {
  // A path on Windows has spaces in it, and splitting on whitespace alone is exactly how that breaks.
  assert.deepEqual(recordArgv('"C:\\Program Files\\sox\\rec.exe" -r 16000 {file}', "C:\\t\\v.wav"), [
    "C:\\Program Files\\sox\\rec.exe", "-r", "16000", "C:\\t\\v.wav",
  ]);
  assert.deepEqual(recordArgv("rec -q {file}", "/tmp/v.wav"), ["rec", "-q", "/tmp/v.wav"]);
  // ⚠️ A template that never says where to write would record somewhere else, and the first sign of
  // it would be a transcription of silence. Refused rather than run.
  assert.equal(recordArgv("rec -q", "/tmp/v.wav"), undefined);
  assert.equal(recordArgv("   ", "/tmp/v.wav"), undefined);
});
