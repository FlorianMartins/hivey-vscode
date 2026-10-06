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
