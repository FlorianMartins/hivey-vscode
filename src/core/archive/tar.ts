// Just enough of the TAR format to unpack a release.
//
// Written by hand, like the ZIP reader beside it, the markdown renderer, the diff and the MCP
// client, and for the same reason: this extension ships no runtime dependencies. `node:zlib` is not
// one — it is part of the runtime — and a gzipped tar is what whisper.cpp publishes for Linux.
//
// The format is deliberately simple and that is the whole reason it is implementable here: a
// sequence of 512-byte headers, each followed by its file's bytes padded to the next 512 boundary.
// What is implemented is ustar and GNU long names; sparse files, extended headers beyond long names,
// and anything that is not a regular file or a directory are reported rather than guessed at.

import { gunzipSync } from "node:zlib";

export interface TarEntry {
  path: string;
  /** Unix mode, which is what decides whether the extracted file may be run. */
  mode: number;
  data: Buffer;
  /**
   * Where a symlink points, when this entry is one. `data` is then empty.
   *
   * ⚠️ Reported rather than followed, and reported rather than SKIPPED — the first version of this
   * skipped them on the reasoning that "a release of compiled binaries has none". It was a premise,
   * not a fact, and the premise was false: whisper.cpp's Linux build ships `libwhisper.so.1` as a
   * link to `libwhisper.so.1.9.5`, so dropping them produced a binary that installed cleanly and
   * then died on `cannot open shared object file`. Caught by running it rather than by reading it.
   *
   * The caller decides what to do. Writing a COPY of the target, when the target is inside the
   * archive, is safe in a way following a link never is.
   */
  link?: string;
}

const BLOCK = 512;

/** An octal field, which is how tar writes every number. Trailing NULs and spaces are padding. */
function octal(block: Buffer, offset: number, length: number): number {
  const text = block.subarray(offset, offset + length).toString("ascii").replace(/\0.*$/, "").trim();
  return text ? Number.parseInt(text, 8) || 0 : 0;
}

function name(block: Buffer): string {
  const main = block.subarray(0, 100).toString("utf8").replace(/\0.*$/, "");
  // ustar splits a long path across a prefix field. Joining them is the whole of that feature.
  const prefix = block.subarray(345, 500).toString("utf8").replace(/\0.*$/, "");
  return prefix ? `${prefix}/${main}` : main;
}

/**
 * Every regular file in a `.tar` or `.tar.gz`, in the order the archive holds them.
 *
 * ⚠️ Directories are skipped; symlinks are REPORTED, with their target and no bytes. An extractor
 * that followed a symlink out of its destination is the oldest archive vulnerability there is, so
 * this one never follows anything — it hands the caller the target and lets it decide. Dropping them
 * instead was the first attempt, and it produced a working install that died at run time on a
 * missing `libwhisper.so.1`.
 */
export function readTar(input: Buffer): TarEntry[] {
  const data = input[0] === 0x1f && input[1] === 0x8b ? gunzipSync(input) : input;
  const out: TarEntry[] = [];
  let at = 0;
  // A GNU long name arrives as its own entry, naming the one that follows.
  let pending: string | undefined;

  while (at + BLOCK <= data.length) {
    const header = data.subarray(at, at + BLOCK);
    // Two zero blocks end the archive; one is enough to stop reading.
    if (header.every((b) => b === 0)) break;
    const size = octal(header, 124, 12);
    const type = String.fromCharCode(header[156] ?? 0);
    const body = data.subarray(at + BLOCK, at + BLOCK + size);
    at += BLOCK + Math.ceil(size / BLOCK) * BLOCK;

    if (type === "L") {
      pending = body.toString("utf8").replace(/\0.*$/, "");
      continue;
    }
    const path = pending ?? name(header);
    pending = undefined;
    // "2" is a symlink: reported with its target and no bytes, for the caller to resolve or refuse.
    if (type === "2") {
      out.push({ path, mode: octal(header, 100, 8), data: Buffer.alloc(0), link: header.subarray(157, 257).toString("utf8").replace(/\0.*$/, "") });
      continue;
    }
    // "0" and "\0" are both a regular file; everything else — directory, device, fifo — is not
    // something this unpacks.
    if (type !== "0" && type !== "\0") continue;
    out.push({ path, mode: octal(header, 100, 8), data: Buffer.from(body) });
  }
  return out;
}
