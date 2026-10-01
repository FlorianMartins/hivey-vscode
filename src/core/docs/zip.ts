// Just enough of the ZIP format to read a .docx.
//
// Written by hand, like the markdown renderer, the diff, the glob and the MCP client, and for the
// same reason: this extension ships no runtime dependencies. `node:zlib` is not one — it is part of
// the runtime — and DEFLATE is the only compression a Word document actually uses.
//
// Only what is needed is implemented. The central directory is read rather than the local headers,
// because a local header may carry zeroed sizes with the real ones in a data descriptor after the
// data, and the central directory always has them. Encryption, ZIP64 and multi-volume archives are
// not supported and say so instead of returning something wrong.

import { inflateRawSync } from "node:zlib";

const END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const CENTRAL_FILE_HEADER = 0x02014b50;

export interface ZipEntry {
  name: string;
  bytes: Buffer;
}

/** Read one named entry, or `undefined` when the archive does not hold it. */
export function readZipEntry(data: Buffer, wanted: string): Buffer | undefined {
  const end = findEndOfCentralDirectory(data);
  if (end === undefined) return undefined;

  const count = data.readUInt16LE(end + 10);
  let offset = data.readUInt32LE(end + 16);

  for (let i = 0; i < count; i++) {
    if (offset + 46 > data.length || data.readUInt32LE(offset) !== CENTRAL_FILE_HEADER) return undefined;
    const method = data.readUInt16LE(offset + 10);
    const compressedSize = data.readUInt32LE(offset + 20);
    const nameLength = data.readUInt16LE(offset + 28);
    const extraLength = data.readUInt16LE(offset + 30);
    const commentLength = data.readUInt16LE(offset + 32);
    const localOffset = data.readUInt32LE(offset + 42);
    const name = data.toString("utf8", offset + 46, offset + 46 + nameLength);

    if (name === wanted) return extract(data, localOffset, method, compressedSize);
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return undefined;
}

function extract(data: Buffer, localOffset: number, method: number, compressedSize: number): Buffer | undefined {
  if (localOffset + 30 > data.length) return undefined;
  // The local header's own name and extra lengths, which differ from the central directory's.
  const nameLength = data.readUInt16LE(localOffset + 26);
  const extraLength = data.readUInt16LE(localOffset + 28);
  const start = localOffset + 30 + nameLength + extraLength;
  const body = data.subarray(start, start + compressedSize);
  if (method === 0) return Buffer.from(body); // stored
  if (method !== 8) return undefined; // anything but DEFLATE is not something to guess at
  try {
    return inflateRawSync(body);
  } catch {
    return undefined;
  }
}

/**
 * The end-of-central-directory record, searched from the back.
 *
 * It is the last thing in the file unless there is a comment, which may be up to 64 kB, so the
 * search is bounded by that rather than scanning the whole archive backwards.
 */
function findEndOfCentralDirectory(data: Buffer): number | undefined {
  const floor = Math.max(0, data.length - 22 - 0xffff);
  for (let i = data.length - 22; i >= floor; i--) {
    if (data.readUInt32LE(i) === END_OF_CENTRAL_DIRECTORY) return i;
  }
  return undefined;
}
