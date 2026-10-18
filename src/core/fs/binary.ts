// A file that is not text, read the way Claude Code reads it: an image is shown to the model, anything
// else is described — never a bare "the file seems to be binary" the model can do nothing with.
//
// ⚠️ « tu peux rajouter le traitement des fichiers binaires (image, etc) ? je veux vraiment le même
// fonctionnement que Claude Code ». A screenshot or an icon the person pointed at failed to read, and
// the model went on to guess what was in it — or to write a script to measure its pixels.

import type { ToolResult } from "../agent/loop.js";
import { BINARY_EXTENSIONS } from "../agent/searchScope.js";

/** The images a vision model reads, by extension. */
const IMAGE_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
};

/** Above this, an image costs more context than it is worth; the model is told and can ask for less. */
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

const extOf = (path: string): string => (/\.([A-Za-z0-9-]+)$/.exec(path)?.[1] ?? "").toLowerCase();

const sizeWords = (n: number): string =>
  n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : n >= 1024 ? `${Math.round(n / 1024)} KB` : `${n} bytes`;

/** Is this file one that is not text — by its extension, or by a NUL byte where text has none? */
export function isBinaryFile(path: string, head?: Uint8Array): boolean {
  const ext = extOf(path);
  if (IMAGE_TYPES[ext] || BINARY_EXTENSIONS.includes(ext)) return true;
  if (!head) return false;
  const n = Math.min(head.length, 8000);
  for (let i = 0; i < n; i++) if (head[i] === 0) return true;
  return false;
}

/** The width and height a PNG, GIF or WebP states in its header, when it does. */
function dimensions(bytes: Uint8Array): string | undefined {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length > 24 && bytes[0] === 0x89 && bytes[1] === 0x50) return `${view.getUint32(16)}×${view.getUint32(20)}`;
  if (bytes.length > 10 && bytes[0] === 0x47 && bytes[1] === 0x49) return `${view.getUint16(6, true)}×${view.getUint16(8, true)}`;
  if (bytes.length > 30 && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[12] === 0x56 && bytes[15] === 0x58) {
    // VP8X: canvas size, 24 bits each, minus one.
    const w = 1 + (bytes[24]! | (bytes[25]! << 8) | (bytes[26]! << 16));
    const h = 1 + (bytes[27]! | (bytes[28]! << 8) | (bytes[29]! << 16));
    return `${w}×${h}`;
  }
  return undefined;
}

/** What read_file returns for a file that is not text. */
export function readBinary(path: string, bytes: Uint8Array): ToolResult {
  const ext = extOf(path);
  const type = IMAGE_TYPES[ext];
  const size = sizeWords(bytes.length);
  if (type) {
    const dims = dimensions(bytes);
    if (bytes.length > MAX_IMAGE_BYTES) {
      return { content: `${path} is an image (${type}${dims ? `, ${dims}` : ""}, ${size}) — too large to attach; ask the user for a smaller copy or a screenshot of the part that matters.` };
    }
    return {
      content: `${path} is an image (${type}${dims ? `, ${dims}` : ""}, ${size}). It is attached for you to look at.`,
      images: [{ mediaType: type, data: Buffer.from(bytes).toString("base64") }],
    };
  }
  return {
    content:
      `${path} is a binary file (${ext ? `.${ext}` : "no extension"}, ${size}): its bytes are not text and are not shown. ` +
      `Read what produces or describes it instead — the code that writes it, a schema, a manifest — or run a command that prints what you need from it.`,
  };
}
