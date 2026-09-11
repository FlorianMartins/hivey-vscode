// Pasting, and the rule that makes it safe to touch at all: anything this code does not understand
// must behave exactly as it did before. Somebody pasting a variable name into the box is not asking
// for a feature, and intercepting their keystroke to be clever is the most annoying outcome there
// is — so most of what follows is about NOT acting.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ATTACH_TEXT_CHARS,
  fitImage,
  isImage,
  isTextLike,
  MAX_IMAGE_EDGE,
  pastedName,
  shouldAttachText,
} from "../src/core/ui/paste.js";
import { acceptsImages, IMAGE_TOKENS } from "../src/core/models/vision.js";

test("an ordinary paste stays an ordinary paste", () => {
  assert.equal(shouldAttachText("totalCents"), false);
  assert.equal(shouldAttachText("const a = 1;\nconst b = 2;"), false);
  assert.equal(shouldAttachText(""), false);
});

test("a wall of text becomes an attachment instead of filling the box", () => {
  assert.equal(shouldAttachText("x".repeat(ATTACH_TEXT_CHARS + 1)), true);
  // And by lines as well as by characters: a hundred short lines fill the composer just as well as
  // one long one, and a stack trace is exactly that shape.
  assert.equal(shouldAttachText("at foo\n".repeat(40)), true);
  assert.equal(shouldAttachText("at foo\n".repeat(3)), false);
});

test("an image is reduced only when it is too big, and never enlarged", () => {
  assert.deepEqual(fitImage(800, 600), { width: 800, height: 600 }, "a small image is left alone");
  assert.deepEqual(fitImage(3200, 1600), { width: 1600, height: 800 }, "the long side decides");
  assert.deepEqual(fitImage(1000, 4000), { width: 400, height: 1600 }, "portrait too");
  assert.deepEqual(fitImage(0, 0), { width: 0, height: 0 }, "and nothing divides by zero");
  const tall = fitImage(10, 100_000);
  assert.ok(tall.width >= 1, "a sliver must not round away to a zero-width canvas");
  assert.equal(tall.height, MAX_IMAGE_EDGE);
});

test("a screenshot with no name of its own gets one that distinguishes it", () => {
  // Three pastes in a conversation all called `image.png` are three attachments nobody can tell
  // apart, and the chip is the only handle the user has on them.
  const at = new Date(2026, 8, 11, 9, 5, 3);
  assert.equal(pastedName(undefined, "image/png", at), "09:05:03.png");
  assert.equal(pastedName("image.png", "image/png", at), "09:05:03.png", "the browser's default name is not a name");
  assert.equal(pastedName("blob", "image/png", at), "09:05:03.png");
  assert.equal(pastedName("stack-trace.png", "image/png", at), "stack-trace.png", "a real name is kept");
});

test("what can be read as text, and what honestly cannot", () => {
  assert.equal(isTextLike("text/plain"), true);
  assert.equal(isTextLike("application/json"), true);
  // No type at all is what a file manager gives for source files.
  assert.equal(isTextLike("", "queries.sql"), true);
  assert.equal(isTextLike("application/octet-stream", "CUSTRPT.rpgle"), true);
  // The honest boundary. A .docx is a zip and a .pdf is a binary container; reading either means a
  // parser this project does not ship. Attaching one as mojibake would be worse than refusing it,
  // because the model would answer confidently about the noise.
  assert.equal(isTextLike("application/pdf", "spec.pdf"), false);
  assert.equal(isTextLike("application/vnd.openxmlformats-officedocument.wordprocessingml.document", "spec.docx"), false);
  assert.equal(isTextLike("application/zip", "bundle.zip"), false);
});

test("only the image formats every provider accepts", () => {
  for (const type of ["image/png", "image/jpeg", "image/webp", "image/gif"]) assert.equal(isImage(type), true, type);
  // Attached and then rejected by the API is a worse outcome than being told here.
  assert.equal(isImage("image/svg+xml"), false);
  assert.equal(isImage("image/tiff"), false);
  assert.equal(isImage("text/plain"), false);
});

test("whether a model reads images is read from the catalogue, not from its name", () => {
  // The failure being prevented is the quiet one: a model that cannot see an image does not say so,
  // it answers about an image nobody looked at.
  assert.equal(acceptsImages("openai/gpt-5"), true);
  assert.equal(acceptsImages("gpt-5"), true, "the bare id a native API uses must work too");
  assert.equal(acceptsImages("anthropic/claude-sonnet-5"), true);
  assert.equal(acceptsImages("qwen2.5-coder:7b"), false, "a local coder model is not a vision model");
  assert.equal(acceptsImages(""), false);
  assert.equal(acceptsImages("something-nobody-has-heard-of"), false, "unknown is reported as no, and that is the safe half");
});

test("an image costs what an image costs", () => {
  // A budget that counts the sentence describing the image instead of the image is wrong by about
  // a thousand tokens per screenshot, and that is the mistake that costs money.
  assert.ok(IMAGE_TOKENS > 500, "a flat estimate below the real cost defeats the budget");
});
