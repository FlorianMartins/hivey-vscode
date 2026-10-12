// A PDF as text, when it can honestly be read as text.
//
// This is the hard one, and the project's existing instinct about it was right: "attaching mojibake
// would be worse than refusing it, because the model would confidently answer about the noise."
// What changes is not that instinct but who applies it. A PDF written by Word or LibreOffice holds
// its prose in content streams as ordinary strings, and pulling those out gives exactly the
// document. A scanned page holds an image and no text at all. A PDF using subset fonts with a
// custom encoding holds strings whose bytes are glyph indices, and reading those gives letters that
// are not the ones on the page.
//
// So the extractor is bounded and it SAYS whether to trust it. `confident` is false when there is
// too little text for the size of the file, or when too much of what came out is not the sort of
// character prose is made of. The caller refuses rather than attaching it — which is the same
// decision as before, taken on evidence instead of on the file extension.
//
// What is not attempted, deliberately: CMap and ToUnicode tables, encrypted files, and anything
// needing a font program to be read. Those are where a half-right answer is most convincing and
// most wrong.

import { inflateSync } from "node:zlib";

export interface PdfText {
  text: string;
  /** False when what came out should not be shown to a model as if it were the document. */
  confident: boolean;
  why?: string;
}

export function pdfText(data: Buffer): PdfText {
  if (data.subarray(0, 5).toString("latin1") !== "%PDF-") {
    return { text: "", confident: false, why: "not a PDF" };
  }
  if (/\/Encrypt\b/.test(data.toString("latin1", 0, Math.min(data.length, 4096)))) {
    return { text: "", confident: false, why: "encrypted" };
  }

  const pieces: string[] = [];
  for (const stream of streams(data)) pieces.push(textFromContent(stream));
  const text = pieces.join("\n").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();

  if (!text) return { text: "", confident: false, why: "no text layer — a scan, or fonts that cannot be read here" };

  // Prose is mostly letters, digits, spaces and punctuation. A stream of glyph indices read as
  // characters is not, and this is the cheapest honest way to tell the two apart.
  const readable = (text.match(/[\p{L}\p{N}\p{Zs}\p{P}\n]/gu) ?? []).length / text.length;
  if (readable < 0.9) {
    return { text, confident: false, why: "what came out does not read as text — probably a custom font encoding" };
  }
  // A hundred-kilobyte file holding four words is a scan with a title on it.
  if (text.length < Math.min(200, data.length / 500)) {
    return { text, confident: false, why: "almost nothing came out for the size of the file" };
  }
  return { text, confident: true };
}

/** Every stream in the file, inflated when it is deflated and skipped when it is anything else. */
function streams(data: Buffer): string[] {
  const out: string[] = [];
  const latin = data.toString("latin1");
  const re = /stream\r?\n/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(latin))) {
    const start = m.index + m[0].length;
    const end = latin.indexOf("endstream", start);
    if (end < 0) break;
    const raw = data.subarray(start, end);
    // The dictionary that precedes it says how it is encoded. Only Flate is attempted; a stream
    // that is an image or an unknown filter contributes nothing rather than nonsense.
    const header = latin.slice(Math.max(0, m.index - 400), m.index);
    if (/\/Filter\s*(?:\[\s*)?\/FlateDecode/.test(header)) {
      try {
        out.push(inflateSync(raw).toString("latin1"));
      } catch {
        // A stream that will not inflate is one fewer, not a failure.
      }
    } else if (!/\/Filter/.test(header)) {
      out.push(raw.toString("latin1"));
    }
    re.lastIndex = end;
  }
  return out;
}

/** The text-showing operators of a content stream, in order. */
function textFromContent(content: string): string {
  if (!/\bTJ\b|\bTj\b/.test(content)) return "";
  const out: string[] = [];
  const token =
    /\((?:\\.|[^\\()])*\)\s*Tj|<[0-9A-Fa-f\s]*>\s*Tj|\[(?:[^\][]|\\.)*\]\s*TJ|\bT\*|\bTd\b|\bTD\b|\bET\b/g;
  let m: RegExpExecArray | null;
  while ((m = token.exec(content))) {
    const piece = m[0];
    if (piece.endsWith("Tj")) {
      out.push(piece.startsWith("<") ? hexString(piece) : literal(piece.slice(0, piece.lastIndexOf(")") + 1)));
    } else if (piece.endsWith("TJ")) {
      out.push(array(piece));
    } else {
      out.push("\n");
    }
  }
  return out.join("").replace(/\n{2,}/g, "\n");
}

/** `[(He) -250 (llo)] TJ` — the numbers are kerning; a big negative one is a space. */
function array(piece: string): string {
  const inner = piece.slice(piece.indexOf("[") + 1, piece.lastIndexOf("]"));
  let out = "";
  const token = /\((?:\\.|[^\\()])*\)|<[0-9A-Fa-f\s]*>|-?\d+(?:\.\d+)?/g;
  let m: RegExpExecArray | null;
  while ((m = token.exec(inner))) {
    const t = m[0];
    if (t.startsWith("(")) out += literal(t);
    else if (t.startsWith("<")) out += hexString(t);
    else if (Number(t) < -120) out += " ";
  }
  return out;
}

function literal(text: string): string {
  const body = text.slice(1, -1);
  return body.replace(/\\(n|r|t|b|f|\(|\)|\\|[0-7]{1,3})/g, (_, code: string) => {
    switch (code) {
      case "n":
        return "\n";
      case "r":
        return "\r";
      case "t":
        return "\t";
      case "b":
      case "f":
        return " ";
      case "(":
        return "(";
      case ")":
        return ")";
      case "\\":
        return "\\";
      default:
        return String.fromCharCode(parseInt(code, 8));
    }
  });
}

function hexString(text: string): string {
  const hex = text.replace(/[^0-9A-Fa-f]/g, "");
  let out = "";
  // Two digits per byte; four per character when the stream is UTF-16, which is what a `<FEFF…>`
  // marker announces.
  if (/^feff/i.test(hex)) {
    for (let i = 4; i + 3 < hex.length; i += 4) out += String.fromCharCode(parseInt(hex.slice(i, i + 4), 16));
    return out;
  }
  for (let i = 0; i + 1 < hex.length; i += 2) out += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16));
  return out;
}
