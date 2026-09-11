// Pasting and dropping things onto the composer.
//
// The panel is the only side of this extension with a clipboard, so it does the decoding, the
// downscaling and the decision about which of the three things a paste means — see `core/ui/paste`
// for the decisions themselves. What crosses to the extension is already bounded and already named.
//
// One rule governs the whole file: a paste that this code does not understand must behave exactly
// as it did before. Someone pasting a variable name into the box is not asking for a feature, and
// intercepting their keystroke to be clever would be the most annoying possible outcome.

import { fitImage, isImage, isTextLike, pastedName, shouldAttachText } from "../core/ui/paste.js";
import type { ToExtension } from "../shared/protocol.js";

type Send = (message: ToExtension) => void;

/** Read a file as a `data:` URL. Blob URLs are not in the panel's content policy; data URLs are. */
function readDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error ?? new Error("unreadable"));
    reader.readAsDataURL(file);
  });
}

function readText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error ?? new Error("unreadable"));
    reader.readAsText(file);
  });
}

/**
 * Draw the image smaller, and say how big it was.
 *
 * Through an `<img>` and a `<canvas>` rather than `createImageBitmap`, because the result has to be
 * re-encoded anyway and this path is the one that works in every webview. PNG out: a screenshot is
 * flat colour and text, which JPEG turns into a smear exactly where the text is — and text is what
 * somebody pastes a screenshot of a stack trace FOR.
 */
async function shrink(dataUrl: string, mediaType: string): Promise<{ mediaType: string; data: string; width: number; height: number }> {
  const image = new Image();
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error("not an image"));
    image.src = dataUrl;
  });
  const target = fitImage(image.naturalWidth, image.naturalHeight);
  if (target.width === image.naturalWidth && target.height === image.naturalHeight) {
    return { mediaType, data: dataUrl.slice(dataUrl.indexOf(",") + 1), width: target.width, height: target.height };
  }
  const canvas = document.createElement("canvas");
  canvas.width = target.width;
  canvas.height = target.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return { mediaType, data: dataUrl.slice(dataUrl.indexOf(",") + 1), width: image.naturalWidth, height: image.naturalHeight };
  ctx.drawImage(image, 0, 0, target.width, target.height);
  const out = canvas.toDataURL("image/png");
  return { mediaType: "image/png", data: out.slice(out.indexOf(",") + 1), width: target.width, height: target.height };
}

/** One file, from wherever it came, as an attachment — or nothing, when it is not one we can read. */
async function attachFile(file: File, send: Send): Promise<boolean> {
  const mediaType = file.type || "";
  if (isImage(mediaType)) {
    const shrunk = await shrink(await readDataUrl(file), mediaType);
    send({
      type: "pasteContext",
      name: pastedName(file.name, shrunk.mediaType),
      mediaType: shrunk.mediaType,
      data: shrunk.data,
      width: shrunk.width,
      height: shrunk.height,
    });
    return true;
  }
  if (isTextLike(mediaType, file.name)) {
    send({ type: "pasteContext", name: pastedName(file.name, mediaType), text: await readText(file) });
    return true;
  }
  return false;
}

/**
 * Everything a `DataTransfer` can carry, in the order that answers the user's intent.
 *
 * Files first: a screenshot in the clipboard also carries a text/plain of its file path on some
 * platforms, and attaching the path instead of the picture would be technically defensible and
 * completely wrong.
 */
async function handleTransfer(data: DataTransfer | null, send: Send): Promise<boolean> {
  if (!data) return false;

  const files = Array.from(data.files ?? []);
  if (files.length) {
    let taken = 0;
    for (const file of files.slice(0, 8)) if (await attachFile(file, send)) taken++;
    if (taken) return true;
  }

  // A file dragged from the editor's explorer, or a tab dropped on the panel. It never arrives as a
  // File — only as a URI — and the extension already knows how to attach a path.
  const uris = data.getData("text/uri-list");
  if (uris) {
    const paths = uris
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"))
      .slice(0, 8);
    let taken = 0;
    for (const uri of paths) {
      const path = uri.startsWith("file://") ? decodeURIComponent(new URL(uri).pathname) : uri;
      if (!path) continue;
      send({ type: "attachPath", path });
      taken++;
    }
    if (taken) return true;
  }

  const text = data.getData("text/plain");
  if (text && shouldAttachText(text)) {
    send({ type: "pasteContext", name: pastedName(undefined, "text/plain"), text });
    return true;
  }
  return false;
}

/**
 * Wire the composer for pasting and dropping.
 *
 * Returns nothing and keeps no state: every outcome is a message to the extension, which owns the
 * attachments. The panel re-renders from what comes back, like everything else here.
 */
export function wirePaste(box: HTMLElement, send: Send): void {
  box.addEventListener("paste", (event) => {
    const clipboard = (event as ClipboardEvent).clipboardData;
    // Peeked at synchronously: the decision to take over the paste has to be made before the
    // default happens, and `preventDefault` cannot be called from a promise.
    const hasFile = Boolean(clipboard?.files?.length);
    const text = clipboard?.getData("text/plain") ?? "";
    if (!hasFile && !shouldAttachText(text)) return; // An ordinary paste stays an ordinary paste.
    event.preventDefault();
    void handleTransfer(clipboard, send);
  });

  // Dropping is the same decision with a different gesture. `dragover` must be cancelled or the
  // editor treats the drop as "open this file", and the panel never sees it.
  box.addEventListener("dragover", (event) => {
    if (!(event as DragEvent).dataTransfer) return;
    event.preventDefault();
    box.classList.add("drop-target");
  });
  box.addEventListener("dragleave", () => box.classList.remove("drop-target"));
  box.addEventListener("drop", (event) => {
    const transfer = (event as DragEvent).dataTransfer;
    if (!transfer) return;
    event.preventDefault();
    box.classList.remove("drop-target");
    void handleTransfer(transfer, send);
  });
}
