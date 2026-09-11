// What to do with what somebody just pasted.
//
// Pasting is one gesture that means three things, and the panel has to tell them apart without
// asking. A short piece of text belongs in the box, where it can be edited before it is sent. A
// screenshot belongs beside the question, because there is nowhere in a text box to put it. And a
// thousand lines of log belong beside the question too — a composer holding a wall of text is a
// composer you can no longer see what you are writing in.
//
// The arithmetic here is small and the decisions are not, so both live in `core` where they can be
// checked without a browser.

/**
 * Above this, pasted text becomes an attachment instead of going into the box.
 *
 * Chosen from what the box can hold rather than from a round number: the composer grows to about
 * eight lines before it starts eating the transcript, which at a typical wrapped width is roughly
 * this many characters. Below it, the paste behaves the way it does in every other text field in
 * the world — which is the behaviour nobody should have to learn.
 */
export const ATTACH_TEXT_CHARS = 1200;

/** And this many lines, because a hundred short lines fill the box just as well as one long one. */
export const ATTACH_TEXT_LINES = 12;

export function shouldAttachText(text: string): boolean {
  if (!text) return false;
  if (text.length > ATTACH_TEXT_CHARS) return true;
  return text.split("\n").length > ATTACH_TEXT_LINES;
}

/**
 * The longest side an attached image is reduced to.
 *
 * Not about quality — about what crosses the wire twice. An untouched phone screenshot is several
 * megabytes of base64 in the message to the extension AND again in the request to the model, and
 * no model reads a screenshot at more than about this resolution anyway: every one of them tiles
 * the image down before looking at it.
 */
export const MAX_IMAGE_EDGE = 1600;

/** The size to draw at, preserving the aspect ratio, never enlarging. */
export function fitImage(width: number, height: number, maxEdge = MAX_IMAGE_EDGE): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (longest <= maxEdge || longest === 0) return { width, height };
  const scale = maxEdge / longest;
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/**
 * A name for something the clipboard handed over without one.
 *
 * A screenshot pasted from the system clipboard arrives as a `File` called `image.png` at best and
 * `blob` at worst, and three of them in a conversation are then indistinguishable. The time is the
 * cheapest thing that tells them apart, and it is what the user will remember them by.
 */
export function pastedName(given: string | undefined, mediaType: string, at = new Date()): string {
  const clean = (given ?? "").trim();
  if (clean && clean !== "blob" && clean !== "image.png") return clean;
  const stamp = `${String(at.getHours()).padStart(2, "0")}:${String(at.getMinutes()).padStart(2, "0")}:${String(at.getSeconds()).padStart(2, "0")}`;
  const extension = mediaType.split("/")[1]?.replace(/[^a-z0-9]/gi, "") || "bin";
  return `${stamp}.${extension}`;
}

/**
 * Is this something we can hand to a model as text?
 *
 * Deliberately by what the browser says it is, not by extension. The honest boundary: a `.docx` or
 * a `.pdf` is a zip or a binary container, and reading either properly means a parser this project
 * does not ship — see ADR-0004. Attaching one as mojibake would be worse than refusing it, because
 * the model would confidently answer about the noise.
 */
export function isTextLike(mediaType: string, name = ""): boolean {
  if (mediaType.startsWith("text/")) return true;
  if (/^application\/(json|xml|x-yaml|yaml|sql|javascript|typescript|x-sh|x-httpd-php)$/.test(mediaType)) return true;
  if (!mediaType || mediaType === "application/octet-stream") {
    // A source file dragged from a file manager often arrives with no type at all.
    return /\.(txt|md|markdown|json|ya?ml|toml|ini|cfg|conf|csv|tsv|log|sql|sh|bash|zsh|ps1|py|rb|go|rs|java|kt|cs|c|h|cpp|hpp|ts|tsx|js|jsx|vue|svelte|html?|css|scss|xml|rpgle|sqlrpgle|clle|clp|dds|cbl|cob)$/i.test(
      name,
    );
  }
  return false;
}

export function isImage(mediaType: string): boolean {
  // The four every provider accepts. A TIFF or an SVG would be attached and then rejected by the
  // API, which is a worse outcome than being told here that it is not an image we can send.
  return /^image\/(png|jpeg|jpg|webp|gif)$/.test(mediaType);
}
