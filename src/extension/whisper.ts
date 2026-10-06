// Installing and running a transcriber on this machine.
//
// ⚠️ The download is the only thing in this extension that reaches an address the user did not
// configure, and it happens exactly once, after they have been asked and told the size. That is the
// bargain the roadmap's rule allows: no network call to an unconfigured address WITHOUT CONSENT. The
// alternative on offer was a cloud key, which is a network call on every sentence.
//
// Nothing here is an npm dependency. An archive is fetched, unpacked by the readers this project
// already has, and a program is run.

import { spawn } from "node:child_process";
import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  WHISPER_BUILD,
  modelFor,
  modelUrl,
  parseWhisperText,
  whisperArgv,
  whisperAsset,
  whisperBinary,
  whisperUrl,
} from "../core/dictation/local.js";
import { readTar } from "../core/archive/tar.js";
import { listZipEntries, readZipEntry } from "../core/docs/zip.js";

/** Where a build and its models live, kept per build so a pinned upgrade cannot half-replace one. */
export function whisperHome(storage: string): string {
  return join(storage, "whisper", WHISPER_BUILD);
}

export interface Installed {
  binary: string;
  model: string;
}

/** What is already here, if anything. Both halves, because either alone transcribes nothing. */
export function installedWhisper(storage: string, platform: string, modelId: string): Installed | undefined {
  const home = whisperHome(storage);
  const binary = join(home, "bin", whisperBinary(platform));
  const model = join(home, "models", modelFor(modelId).file);
  return existsSync(binary) && existsSync(model) ? { binary, model } : undefined;
}

async function download(url: string, onProgress?: (mb: number) => void): Promise<Buffer> {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  if (!res.body) return Buffer.from(await res.arrayBuffer());
  // Read in chunks so the progress a long download reports is the real one. A spinner that cannot
  // move is indistinguishable from a hang, and this is 75 MB on a home connection.
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
    chunks.push(Buffer.from(chunk));
    bytes += chunk.length;
    onProgress?.(bytes / 1_048_576);
  }
  return Buffer.concat(chunks);
}

/**
 * Unpack a release into `bin/`, flattening the single directory these archives wrap everything in.
 *
 * The libraries sit beside the binary and must stay beside it: whisper.cpp links them at run time by
 * a relative path, which is why the whole archive is kept rather than the one program.
 */
async function unpack(archive: Buffer, asset: string, into: string): Promise<void> {
  await mkdir(into, { recursive: true });
  const write = async (path: string, data: Buffer, mode: number) => {
    // ⚠️ The archive's own leading directory is dropped, and so is any path that tries to climb out
    // of the destination. `..` in an archive is the oldest way out of a sandbox there is.
    const flat = path.split("/").slice(1).join("/") || path;
    if (!flat || flat.split("/").includes("..")) return;
    const target = join(into, flat);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, data);
    if (mode & 0o111) await chmod(target, 0o755);
  };
  if (asset.endsWith(".zip")) {
    for (const entry of listZipEntries(archive)) {
      if (entry.endsWith("/")) continue;
      const data = readZipEntry(archive, entry);
      // A Windows release carries no modes, and everything in it is meant to be runnable.
      if (data) await write(entry, data, 0o755);
    }
    return;
  }
  const entries = readTar(archive);
  for (const entry of entries) if (!entry.link) await write(entry.path, entry.data, entry.mode);
  // ⚠️ Symlinks become COPIES of what they point at, and only when that is inside the archive.
  // whisper.cpp's Linux build ships `libwhisper.so.1` as a link to `libwhisper.so.1.9.5`, and the
  // loader looks for the LINK's name — so dropping them installs a binary that dies on `cannot open
  // shared object file`. Copying is the one resolution that cannot be made to reach outside the
  // destination, which is what following a link can.
  for (const entry of entries) {
    if (!entry.link) continue;
    if (entry.link.startsWith("/") || entry.link.split("/").includes("..")) continue;
    const dir = entry.path.split("/").slice(0, -1).join("/");
    const wanted = entry.link.includes("/") ? entry.link : `${dir}/${entry.link}`;
    const target = entries.find((e) => !e.link && e.path === wanted);
    if (target) await write(entry.path, target.data, target.mode);
  }
}

/**
 * Fetch and install the build and the model, reporting what it is doing.
 *
 * Partial state is removed on failure rather than left behind: half a binary passes `existsSync` and
 * then fails to run, which is the most confusing possible outcome of a download that was interrupted.
 */
export async function installWhisper(
  storage: string,
  platform: string,
  arch: string,
  modelId: string,
  say: (what: string) => void,
): Promise<Installed> {
  const asset = whisperAsset({ platform, arch });
  if (!asset) throw new Error(`no prebuilt whisper.cpp for ${platform}/${arch}`);
  const home = whisperHome(storage);
  const model = modelFor(modelId);
  try {
    if (!existsSync(join(home, "bin", whisperBinary(platform)))) {
      say("downloading the transcriber");
      const archive = await download(whisperUrl(asset), (mb) => say(`downloading the transcriber — ${mb.toFixed(0)} MB`));
      say("unpacking the transcriber");
      await unpack(archive, asset, join(home, "bin"));
    }
    const target = join(home, "models", model.file);
    if (!existsSync(target)) {
      await mkdir(join(home, "models"), { recursive: true });
      const bytes = await download(modelUrl(model.file), (mb) =>
        say(`downloading the model — ${mb.toFixed(0)} of ${model.mb} MB`),
      );
      await writeFile(target, bytes);
    }
  } catch (err) {
    await rm(home, { recursive: true, force: true });
    throw err;
  }
  const done = installedWhisper(storage, platform, modelId);
  if (!done) throw new Error("the download finished but the files are not where they should be");
  return done;
}

/** Run it. The transcript, or the reason there is none. */
export async function runWhisper(where: Installed, wav: string, language: string | undefined): Promise<string> {
  const [program, ...args] = whisperArgv(where.binary, where.model, wav, language);
  return await new Promise<string>((resolve, reject) => {
    // argv, never a shell: a path with a space in it is one argument here and two to a shell, and
    // this path is built from a storage directory nobody chose.
    const child = spawn(program!, args, {
      // whisper.cpp loads its own libraries from beside the binary.
      cwd: dirname(where.binary),
      env: { ...process.env, LD_LIBRARY_PATH: dirname(where.binary) },
    });
    let out = "";
    let err = "";
    child.stdout.on("data", (d: Buffer) => (out += d.toString("utf8")));
    child.stderr.on("data", (d: Buffer) => (err += d.toString("utf8")));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve(parseWhisperText(out));
      else reject(new Error(err.trim().split("\n").slice(-3).join(" ") || `whisper-cli exited ${code}`));
    });
  });
}

/** For the one caller that wants to know whether a model file is already on disk. */
export async function modelBytes(storage: string, modelId: string): Promise<number> {
  try {
    return (await readFile(join(whisperHome(storage), "models", modelFor(modelId).file))).length;
  } catch {
    return 0;
  }
}

// ── Recording, from outside the panel ────────────────────────────────────────────────────────────

import { spawnSync } from "node:child_process";
import { howToRecord, recordArgv, recorders, type Recorder } from "../core/dictation/capture.js";

/** The first recorder on PATH, or nothing. `where`/`which` is how every shell answers this. */
export function findRecorder(platform: string): Recorder | undefined {
  const look = platform === "win32" ? "where" : "which";
  return recorders(platform).find((r) => {
    // `builtin` is part of the system: PowerShell on Windows is not something to look for, and
    // looking anyway would mean a machine with an unusual PATH could not dictate at all.
    if (r.builtin) return true;
    try {
      return spawnSync(look, [r.program], { stdio: "ignore" }).status === 0;
    } catch {
      return false;
    }
  });
}

export function recorderAdvice(platform: string): string {
  return howToRecord(platform);
}

export interface Recording {
  /** Stop, and resolve with the file once the recorder has closed it. */
  stop: () => Promise<string>;
  /** Stop and throw the file away. */
  cancel: () => void;
}

/**
 * Start recording to a WAV, with whatever this machine has.
 *
 * ⚠️ The process is ended with SIGINT rather than SIGKILL, and that is not politeness: every one of
 * these tools finalises its WAV header on SIGINT and leaves a truncated, unreadable file on SIGKILL.
 * The header holds the sample count, so a file that was never closed says it is empty.
 */
export function startRecording(argv: string[], wav: string, how: "signal" | "stdin" = "signal"): Recording {
  const [program, ...args] = argv;
  // stdin is a pipe whatever the recorder, because the Windows one is stopped by a line on it.
  const child = spawn(program!, args, { stdio: ["pipe", "ignore", "pipe"] });
  let why = "";
  child.stderr?.on("data", (d: Buffer) => (why += d.toString("utf8")));
  let code: number | null = null;
  const ended = new Promise<void>((resolve) =>
    child.on("close", (status) => {
      code = status;
      resolve();
    }),
  );
  return {
    stop: async () => {
      // ⚠️ A line, not a signal, for the recorder that has to SAVE. The Windows one writes its file
      // with an explicit `mciSendString('save …')`, and a process that has been killed never reaches
      // it — the recording would be lost at exactly the moment somebody finished speaking.
      if (how === "stdin") child.stdin?.end("\n");
      else child.kill("SIGINT");
      await Promise.race([ended, new Promise((r) => setTimeout(r, 4000))]);
      // ⚠️ The recorder's own words, when it had any. They used to be collected and dropped, so a
      // microphone that could not be opened — no input device, or another program holding it — ended
      // as a file with a header and no frames, and the person was shown a transcriber's complaint
      // about a temporary path instead.
      const said = why.trim().split("\n").filter(Boolean).slice(-2).join(" ");
      if (code && code !== 0) throw new Error(said || `the recorder exited ${code}`);
      if (!existsSync(wav)) throw new Error(said || "the recorder wrote nothing");
      return wav;
    },
    cancel: () => {
      // Killed outright: there is nothing to save, and the file is removed either way.
      child.kill("SIGINT");
      void ended.then(() => rm(wav, { force: true }));
    },
  };
}

export { recordArgv };

import { listDevicesArgv, parseDevices, type InputDevice } from "../core/dictation/capture.js";

/**
 * The microphones this machine offers, asked of the recorder that will be used.
 *
 * ⚠️ Every one of these tools answers on STDERR and exits non-zero afterwards, because listing was
 * never what the command claimed to be doing. Both are normal. Treating a non-zero exit as a failure
 * here would report "no microphones" on a machine that has four.
 */
export function inputDevices(kind: NonNullable<Recorder["devices"]>): InputDevice[] {
  const { program, args } = listDevicesArgv(kind);
  try {
    const run = spawnSync(program, args, { encoding: "utf8" });
    return parseDevices(kind, `${run.stderr ?? ""}\n${run.stdout ?? ""}`);
  } catch {
    return [];
  }
}
