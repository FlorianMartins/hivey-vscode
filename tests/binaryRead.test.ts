// A file that is not text — see core/fs/binary.ts.

import { test } from "node:test";
import assert from "node:assert/strict";
import { isBinaryFile, readBinary } from "../src/core/fs/binary.js";
import { runTurn, type Tool } from "../src/core/agent/loop.js";
import type { ChatRequest, ChatResult, Provider } from "../src/core/providers/types.js";

/** A 1×1 PNG: signature, then an IHDR saying 640×480. */
const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 2, 128, 0, 0, 1, 224, 8, 6, 0, 0, 0]);

test("an image is shown to the model, with what its header says", () => {
  assert.ok(isBinaryFile("assets/icone.png"));
  const r = readBinary("assets/icone.png", png);
  assert.match(r.content, /^assets\/icone\.png is an image \(image\/png, 640×480, 29 bytes\)\. It is attached/);
  assert.equal(r.images?.[0]?.mediaType, "image/png");
  assert.equal(Buffer.from(r.images![0]!.data, "base64").length, png.length);
  assert.ok(!r.isError, "not a failure: the model can look at it");
});

test("any other binary is described, not refused; text is left to the text reader", () => {
  const r = readBinary("data/guilde.db", new Uint8Array(2048));
  assert.match(r.content, /binary file \(\.db, 2 KB\)/);
  assert.equal(r.images, undefined);
  assert.ok(isBinaryFile("build/out.unknown", new Uint8Array([65, 0, 66])), "a NUL byte is not text");
  assert.ok(!isBinaryFile("src/ui.js", new TextEncoder().encode("const a = 1;\n")));
  assert.ok(!isBinaryFile("icons/logo.svg"), "an SVG is text, read as such");
});

test("the image reaches the model after the step's tool results, never between them", async () => {
  const seen: ChatRequest[] = [];
  const replies: ChatResult[] = [
    {
      text: "",
      reasoning: "",
      toolCalls: [
        { id: "a", name: "read_file", args: '{"path":"shot.png"}' },
        { id: "b", name: "read_file", args: '{"path":"src/ui.js"}' },
      ],
      usage: { promptTokens: 1, completionTokens: 1, cachedTokens: 0 },
      stopReason: "tool_calls",
    },
    { text: "Vu.", reasoning: "", toolCalls: [], usage: { promptTokens: 1, completionTokens: 1, cachedTokens: 0 }, stopReason: "stop" },
  ];
  const provider: Provider = {
    id: "local",
    baseUrl: "http://127.0.0.1:1/v1",
    isLocal: true,
    async chat(req) {
      seen.push({ ...req, messages: req.messages.map((m) => ({ ...m })) });
      return replies[seen.length - 1]!;
    },
    async listModels() {
      return [];
    },
  };
  const read: Tool = {
    parallel: () => true,
    schema: { name: "read_file", description: "", parameters: { type: "object", properties: {} } },
    approval: () => false,
    run: async (args) => (String(args["path"]).endsWith(".png") ? readBinary(String(args["path"]), png) : { content: "const a = 1;" }),
  } as Tool;
  await runTurn({ provider, model: "m", messages: [{ role: "user", content: "regarde mon screen" }], tools: [read] });
  const msgs = seen[1]!.messages;
  const roles = msgs.map((m) => m.role);
  assert.deepEqual(roles.slice(-4), ["assistant", "tool", "tool", "user"]);
  const last = msgs[msgs.length - 1]!;
  assert.equal(last.images?.[0]?.mediaType, "image/png");
  assert.match(last.content, /read_file shot\.png/);
});
