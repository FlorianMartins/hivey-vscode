// A connection reset before the answer began — see `resetBeforeAnswer` in core/util/http.ts.
//
// « chat vers ai.hivey.be a échoué : read ECONNRESET » : the request never reached the gateway — an
// idle connection closed meanwhile failed it — and the turn ended on that.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { request, resetBeforeAnswer } from "../src/core/util/http.js";

async function serve(handle: (n: number, req: IncomingMessage, res: ServerResponse) => void, fn: (url: string, count: () => number) => Promise<void>): Promise<void> {
  let n = 0;
  const server = createServer((req, res) => {
    n++;
    req.resume();
    req.on("end", () => handle(n, req, res));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  try {
    await fn(`http://127.0.0.1:${(server.address() as AddressInfo).port}/v1/chat/completions`, () => n);
  } finally {
    server.closeAllConnections?.();
    server.close();
  }
}

test("reset before a byte came back: sent again once, and it goes through", async () => {
  await serve(
    (n, req, res) => {
      if (n === 1) return req.socket.destroy();
      res.writeHead(200, { "content-type": "application/json" });
      res.end('{"ok":true}');
    },
    async (url, count) => {
      const res = await request(url, { method: "POST", body: '{"model":"m"}', label: "chat" });
      assert.equal(res.status, 200);
      assert.deepEqual(await res.json(), { ok: true });
      assert.equal(count(), 2);
    },
  );
});

test("reset every time: one more attempt, never a loop, and the error is still said", async () => {
  await serve(
    (_n, req) => req.socket.destroy(),
    async (url, count) => {
      await assert.rejects(request(url, { method: "POST", body: "{}", label: "chat" }));
      assert.equal(count(), 2);
    },
  );
});

test("only a reset is taken for one", () => {
  assert.equal(resetBeforeAnswer(Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNRESET", message: "read ECONNRESET" } })), true);
  assert.equal(resetBeforeAnswer(Object.assign(new TypeError("fetch failed"), { cause: { code: "UND_ERR_SOCKET", message: "other side closed" } })), true);
  assert.equal(resetBeforeAnswer(Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNREFUSED" } })), false, "a server that is down is not retried here");
  assert.equal(resetBeforeAnswer(new Error("timeout")), false);
});
