// A model that cannot read images, found out from the server rather than from the catalogue.
//
// « HTTP 500 Internal Server Error: image input is not supported - hint: if this is unexpected, you
// may need to provide the mmproj » — llama.cpp without its vision projector. The turn failed, and so
// did every later one, since the image stays in the conversation.

import { test } from "node:test";
import assert from "node:assert/strict";
import { isImageRefusal, withoutImages } from "../src/core/models/vision.js";

test("the servers' ways of refusing an image are recognised, and nothing else is", () => {
  assert.ok(
    isImageRefusal(
      "HTTP 500 Internal Server Error: image input is not supported - hint: if this is unexpected, you may need to provide the mmproj",
    ),
  );
  assert.ok(isImageRefusal("400: this model does not support image inputs"));
  assert.ok(isImageRefusal("Error: model 'qwen3-coder' does not support vision"));
  assert.ok(!isImageRefusal("HTTP 500 Internal Server Error: CUDA out of memory"));
  assert.ok(!isImageRefusal("429 Too Many Requests"));
});

test("images are taken out, and the message says they were", () => {
  const img = { mediaType: "image/png", data: "AAAA" };
  const out = withoutImages([
    { role: "user" as const, content: "What is wrong in this screenshot?", images: [img, img] },
    { role: "assistant" as const, content: "Let me see." },
  ]);
  assert.equal(out[0]!.images, undefined, "no image is sent");
  assert.match(out[0]!.content, /^What is wrong in this screenshot\?/, "the question is kept");
  assert.match(out[0]!.content, /2 image\(s\) .* removed/, "and the model is told why it cannot see them");
  assert.equal(out[1]!.content, "Let me see.", "messages without images are untouched");
});
