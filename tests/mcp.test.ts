// The MCP client, driven against a fake server.
//
// The transport is injected precisely so this is possible: the tests below exercise the handshake,
// the pagination, the cancellation path and the framing without spawning a process or opening a
// socket. The framing tests are the ones worth having — a message split across two reads is the
// bug every hand-written client has once, and it does not fail loudly. It hangs.

import { test } from "node:test";
import assert from "node:assert/strict";
import { LineFramer, McpClient, PROTOCOL_VERSION, flattenContent, type McpTransport } from "../src/core/mcp/client.js";
import { formatRows, isReadOnlySql, parseMemberRef } from "../src/core/ibmi/sql.js";

/** A server that answers from a table of handlers, and records what it was sent. */
function fakeServer(handlers: Record<string, (params: any) => unknown> = {}) {
  let deliver: (m: unknown) => void = () => {};
  let fail: (e: Error) => void = () => {};
  const sent: any[] = [];
  let closed = false;

  const transport: McpTransport = {
    async send(message: any) {
      sent.push(message);
      if (message.id === undefined) return; // a notification needs no answer
      const handler = handlers[message.method];
      // Answering on a later tick is not decoration: it is how a real transport behaves, and a
      // client that only works when the answer is synchronous works only in its own tests.
      queueMicrotask(() => {
        if (!handler) deliver({ jsonrpc: "2.0", id: message.id, error: { code: -32601, message: "Method not found" } });
        else deliver({ jsonrpc: "2.0", id: message.id, result: handler(message.params) });
      });
    },
    onMessage(h) { deliver = h; },
    onError(h) { fail = h; },
    async close() { closed = true; },
  };
  return { transport, sent, closed: () => closed, crash: (e: Error) => fail(e), push: (m: unknown) => deliver(m) };
}

const INIT = () => ({
  protocolVersion: PROTOCOL_VERSION,
  serverInfo: { name: "arcad-elias", version: "1.2.3" },
  capabilities: { tools: {}, resources: {} },
});

// ── Handshake ────────────────────────────────────────────────────────────────────────────────

test("the handshake announces the client, reads the server, and confirms it is ready", async () => {
  const server = fakeServer({ initialize: INIT });
  const client = new McpClient({ transport: server.transport, clientName: "forge", clientVersion: "9.9.9" });
  await client.initialize();

  assert.equal(client.serverName, "arcad-elias");
  assert.equal(client.serverVersion, "1.2.3");
  assert.equal(server.sent[0].method, "initialize");
  assert.equal(server.sent[0].params.clientInfo.name, "forge");
  assert.equal(server.sent[0].params.protocolVersion, PROTOCOL_VERSION);
  // Without this notification a spec-compliant server may refuse everything that follows.
  assert.equal(server.sent[1].method, "notifications/initialized");
  assert.equal(server.sent[1].id, undefined, "a notification carries no id");
});

test("a server that declares no tools is not asked for any", async () => {
  const server = fakeServer({
    initialize: () => ({ protocolVersion: PROTOCOL_VERSION, serverInfo: { name: "x" }, capabilities: {} }),
  });
  const client = new McpClient({ transport: server.transport });
  await client.initialize();
  assert.deepEqual(await client.listTools(), []);
  assert.ok(!server.sent.some((m) => m.method === "tools/list"));
});

// ── Tools ────────────────────────────────────────────────────────────────────────────────────

test("the tool list is read to the end, not just its first page", async () => {
  // The regression this guards: a server with thirty tools returns ten and a cursor, and a client
  // that ignores the cursor silently offers a third of what the user installed.
  const pages: Record<string, { tools: any[]; nextCursor?: string }> = {
    "": { tools: [{ name: "a" }, { name: "b" }], nextCursor: "p2" },
    p2: { tools: [{ name: "c" }], nextCursor: "p3" },
    p3: { tools: [{ name: "d" }] },
  };
  const server = fakeServer({ initialize: INIT, "tools/list": (p) => pages[p?.cursor ?? ""] });
  const client = new McpClient({ transport: server.transport });
  await client.initialize();
  assert.deepEqual((await client.listTools()).map((t) => t.name), ["a", "b", "c", "d"]);
});

test("a tool call carries its arguments and returns the text the server produced", async () => {
  const server = fakeServer({
    initialize: INIT,
    "tools/call": (p) => ({ content: [{ type: "text", text: `ran ${p.name} on ${p.arguments.component}` }] }),
  });
  const client = new McpClient({ transport: server.transport });
  await client.initialize();
  const result = await client.callTool("checkout", { component: "CUSTMAST" });
  assert.equal(flattenContent(result.content), "ran checkout on CUSTMAST");
  assert.equal(result.isError, undefined);
});

test("an error from the server is an error here, not a silent empty answer", async () => {
  const server = fakeServer({ initialize: INIT });
  const client = new McpClient({ transport: server.transport });
  await client.initialize();
  await assert.rejects(() => client.callTool("nope", {}), /Method not found/);
});

test("a tool that reports failure keeps its message and its flag", async () => {
  const server = fakeServer({
    initialize: INIT,
    "tools/call": () => ({ content: [{ type: "text", text: "component is locked" }], isError: true }),
  });
  const client = new McpClient({ transport: server.transport });
  await client.initialize();
  const result = await client.callTool("checkin", {});
  assert.equal(result.isError, true);
  assert.match(flattenContent(result.content), /locked/);
});

// ── Cancellation and failure ─────────────────────────────────────────────────────────────────

test("stopping the turn settles the call and tells the server", async () => {
  // A never-answered request must not leave a promise alive forever: the turn would never end.
  const server = fakeServer({ initialize: INIT });
  const client = new McpClient({ transport: server.transport });
  await client.initialize();

  const controller = new AbortController();
  const call = client.callTool("slow", {}, controller.signal);
  controller.abort();
  await assert.rejects(() => call, /Cancelled/);
  assert.ok(server.sent.some((m) => m.method === "notifications/cancelled"));
});

test("a transport that dies fails every request in flight instead of hanging", async () => {
  const server = fakeServer({ initialize: INIT });
  const client = new McpClient({ transport: server.transport });
  await client.initialize();
  const call = client.callTool("anything", {});
  server.crash(new Error("The server exited (code 1)."));
  await assert.rejects(() => call, /exited/);
});

test("a request the server sends us is refused properly rather than ignored", async () => {
  // We advertise no sampling capability. A server that asks anyway is waiting for a reply, and
  // silence makes it wait for its own timeout instead of moving on.
  const server = fakeServer({ initialize: INIT });
  const client = new McpClient({ transport: server.transport });
  await client.initialize();
  server.push({ jsonrpc: "2.0", id: 99, method: "sampling/createMessage", params: {} });
  await new Promise((r) => setTimeout(r, 5));
  const reply = server.sent.find((m) => m.id === 99);
  assert.ok(reply, "the client answered nothing");
  assert.equal(reply.error.code, -32601);
});

test("a closed client refuses new work instead of queueing it", async () => {
  const server = fakeServer({ initialize: INIT });
  const client = new McpClient({ transport: server.transport });
  await client.initialize();
  await client.close();
  assert.ok(server.closed());
  await assert.rejects(() => client.callTool("x", {}), /closed/);
});

// ── Framing ──────────────────────────────────────────────────────────────────────────────────

test("a message split across two reads is still one message", () => {
  const framer = new LineFramer();
  assert.deepEqual(framer.push('{"jsonrpc":"2.0","i'), []);
  assert.deepEqual(framer.push('d":1,"result":{}}\n'), [{ jsonrpc: "2.0", id: 1, result: {} }]);
});

test("several messages in one read are all delivered, in order", () => {
  const framer = new LineFramer();
  const out = framer.push('{"id":1}\n{"id":2}\n{"id":3}\n');
  assert.deepEqual(out.map((m: any) => m.id), [1, 2, 3]);
});

test("a line that is not JSON is dropped, because servers print to stdout", () => {
  const framer = new LineFramer();
  const out = framer.push('Listening on port 3000\n{"id":1}\n');
  assert.deepEqual(out, [{ id: 1 }]);
});

// ── Content ──────────────────────────────────────────────────────────────────────────────────

test("binary content is named, not inlined", () => {
  // Turning a screenshot into a megabyte of base64 inside the transcript would be the exact
  // opposite of an extension whose promise is that you know what left your machine.
  const text = flattenContent([
    { type: "text", text: "here it is" },
    { type: "image", mimeType: "image/png", data: "AAAA" },
  ]);
  assert.match(text, /here it is/);
  assert.match(text, /\[image image\/png, not included\]/);
  assert.ok(!text.includes("AAAA"));
});

test("an embedded resource contributes its text", () => {
  assert.equal(flattenContent([{ type: "resource", resource: { uri: "file:///a", text: "body" } }]), "body");
  assert.match(flattenContent([{ type: "resource", resource: { uri: "file:///a" } }]), /file:\/\/\/a/);
});

// ── Db2 for i: what runs without asking ──────────────────────────────────────────────────────

test("plain reads are recognised as reads", () => {
  assert.ok(isReadOnlySql("select * from qgpl.custmast"));
  assert.ok(isReadOnlySql("SELECT * FROM QSYS2.SYSTABLES FETCH FIRST 10 ROWS ONLY"));
  assert.ok(isReadOnlySql("with t as (select 1 from sysibm.sysdummy1) select * from t"));
  assert.ok(isReadOnlySql("values current date"));
  assert.ok(isReadOnlySql("-- what is in there?\nselect count(*) from qgpl.orders"));
});

test("anything that can change data is not", () => {
  for (const statement of [
    "update qgpl.custmast set bal = 0",
    "delete from qgpl.orders",
    "insert into qgpl.log values('x')",
    "drop table qgpl.t",
    "call qsys2.qcmdexc('CLRPFM QGPL/CUSTMAST')",
    "create table qgpl.t (a int)",
    "grant all on qgpl.custmast to public",
  ]) {
    assert.equal(isReadOnlySql(statement), false, `${statement} was treated as a read`);
  }
});

test("a write smuggled behind a read is refused", () => {
  // The two shapes that make a naive "does it start with select" check dangerous.
  assert.equal(isReadOnlySql("select 1 from sysibm.sysdummy1; delete from qgpl.orders"), false);
  assert.equal(isReadOnlySql("with d as (delete from qgpl.orders) select * from d"), false);
  assert.equal(isReadOnlySql("/* select */ update qgpl.t set a = 1"), false);
  assert.equal(isReadOnlySql(""), false);
  assert.equal(isReadOnlySql("   "), false);
});

test("both ways of writing a member reference are accepted", () => {
  assert.deepEqual(parseMemberRef("QGPL/QRPGLESRC(CALCVAT)"), {
    library: "QGPL",
    sourceFile: "QRPGLESRC",
    member: "CALCVAT",
  });
  assert.deepEqual(parseMemberRef("/QGPL/QRPGLESRC/CALCVAT.RPGLE"), {
    library: "QGPL",
    sourceFile: "QRPGLESRC",
    member: "CALCVAT",
  });
  assert.equal(parseMemberRef("mylib/qddssrc(custmast)").library, "MYLIB", "the platform is uppercase");
  assert.throws(() => parseMemberRef("just-a-name"), /not a member reference/);
});

test("a result set reads as a table, and says when it was cut", () => {
  const rows = Array.from({ length: 5 }, (_, i) => ({ CUSNBR: i, CUSNAM: `Customer ${i}` }));
  const table = formatRows(rows, 3);
  assert.match(table, /CUSNBR/);
  assert.match(table, /Customer 0/);
  assert.match(table, /2 more rows/);
  assert.equal(formatRows([]), "0 rows.");
  assert.ok(!formatRows(rows, 3).includes("Customer 4"));
});

test("a null cell is empty, not the word null", () => {
  assert.ok(!formatRows([{ A: null, B: 1 }]).includes("null"));
});
