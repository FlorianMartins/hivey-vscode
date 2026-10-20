// A connection cut in the middle of an answer — see `isConnectionDrop` in core/providers/openai.ts.
//
// « Il y a eu un terminated avec qwen 3.8 » : the user's side reset the connection while the model was
// writing, and Node's fetch THREW « terminated » instead of ending the stream. The panel showed that
// word as the whole answer, where a stream that merely stopped is picked up and continued.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { OpenAICompatibleProvider, isConnectionDrop } from "../src/core/providers/openai.js";

test("the connection reset mid-answer: what arrived is kept, and the answer is marked interrupted", async () => {
  const server = createServer((req, res) => {
    req.resume();
    req.on("end", () => {
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { reasoning_content: "Je lis le fichier" } }] })}\n\n`);
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: "Le début de la réponse" } }] })}\n\n`);
      // The other side resets the socket: no finish_reason, no [DONE], no clean end.
      setTimeout(() => res.socket?.destroy(), 50);
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as AddressInfo).port;
  try {
    const provider = new OpenAICompatibleProvider({ id: "local", baseUrl: `http://127.0.0.1:${port}/v1`, isLocal: true });
    const res = await provider.chat({ model: "m", messages: [{ role: "user", content: "x" }] });
    assert.equal(res.interrupted, true);
    assert.equal(res.text, "Le début de la réponse");
    assert.equal(res.reasoning, "Je lis le fichier");
  } finally {
    server.close();
  }
});

test("only a dropped connection is taken for one — a refusal or a bug still fails as itself", () => {
  assert.equal(isConnectionDrop(Object.assign(new TypeError("terminated"), { cause: { code: "UND_ERR_SOCKET" } })), true);
  assert.equal(isConnectionDrop(Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" })), true);
  assert.equal(isConnectionDrop(new TypeError("Cannot read properties of undefined (reading 'choices')")), false);
  assert.equal(isConnectionDrop(new Error("model not found")), false);
});
