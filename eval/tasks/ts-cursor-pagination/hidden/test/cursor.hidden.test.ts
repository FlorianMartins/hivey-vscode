import { test } from "node:test";
import assert from "node:assert/strict";
import { listOrders } from "../src/api.js";
import { fetchAllOrders } from "../src/client.js";
import { OrderRepo, type Order } from "../src/orders.js";

interface CursorPage {
  items: Order[];
  nextCursor: string | null;
}

/** One GET /orders, read through the shape the prompt asks for, whatever the declared types. */
function get(repo: OrderRepo, query: Record<string, string | undefined>): { status: number; body: unknown } {
  return listOrders(repo, query) as unknown as { status: number; body: unknown };
}

function page(repo: OrderRepo, query: Record<string, string | undefined>): CursorPage {
  const res = get(repo, query);
  assert.equal(res.status, 200, `GET /orders ${JSON.stringify(query)} → ${res.status} ${JSON.stringify(res.body)}`);
  const body = res.body as CursorPage;
  assert.ok(Array.isArray(body.items), "a page has items");
  assert.ok(body.nextCursor === null || typeof body.nextCursor === "string", "nextCursor is a string or null");
  return body;
}

function stamp(minutes: number): string {
  return new Date(Date.UTC(2026, 4, 1) + minutes * 60_000).toISOString();
}

function seeded(n: number, at: (i: number) => string = stamp): OrderRepo {
  const repo = new OrderRepo();
  for (let i = 0; i < n; i++) repo.insert({ createdAt: at(i), customer: `c${i}`, totalCents: 100 + i });
  return repo;
}

/** Walks every page, calling `between` after each one. */
function walk(repo: OrderRepo, limit: number, between: (pageNo: number) => void = () => undefined): number[] {
  const ids: number[] = [];
  let cursor: string | undefined;
  for (let pageNo = 0; pageNo < 1000; pageNo++) {
    const body = page(repo, { limit: String(limit), ...(cursor === undefined ? {} : { cursor }) });
    assert.ok(body.items.length <= limit);
    ids.push(...body.items.map((o) => o.id));
    if (body.nextCursor === null) return ids;
    cursor = body.nextCursor;
    between(pageNo);
  }
  throw new Error("more than 1000 pages: the cursor never ends");
}

test("orders created while paging cause no duplicate and no gap", () => {
  const repo = seeded(120);
  const original = new Set(repo.newestFirst().map((o) => o.id));
  let minute = 10_000;
  const ids = walk(repo, 25, () => {
    for (let k = 0; k < 3; k++) repo.insert({ createdAt: stamp(minute++), customer: "new", totalCents: 1 });
  });
  assert.equal(new Set(ids).size, ids.length, "an order came back twice");
  for (const id of original) assert.ok(ids.includes(id), `order ${id} was skipped`);
});

test("a walk with nothing changing is exactly the newest-first order", () => {
  // Order 41 is a backfill: inserted last, with the oldest date of all.
  const repo = seeded(40);
  repo.insert({ createdAt: stamp(-500), customer: "imported", totalCents: 5 });
  assert.deepEqual(walk(repo, 7), repo.newestFirst().map((o) => o.id));
});

test("orders sharing a timestamp across a page boundary are neither lost nor repeated", () => {
  const repo = seeded(30, (i) => (i < 5 ? stamp(i) : i < 25 ? stamp(100) : stamp(200 + i)));
  assert.deepEqual(walk(repo, 7), repo.newestFirst().map((o) => o.id));
  assert.deepEqual(walk(repo, 1), repo.newestFirst().map((o) => o.id));
});

test("the last page says so, even when it is full", () => {
  const repo = seeded(50);
  const first = page(repo, { limit: "25" });
  assert.equal(first.items.length, 25);
  assert.ok(first.nextCursor !== null);
  const second = page(repo, { limit: "25", cursor: first.nextCursor! });
  assert.equal(second.items.length, 25);
  assert.equal(second.nextCursor, null);
});

test("an empty table is one empty page", () => {
  const body = page(new OrderRepo(), {});
  assert.deepEqual(body.items, []);
  assert.equal(body.nextCursor, null);
});

test("the limit keeps its default and its maximum", () => {
  const repo = seeded(300);
  assert.equal(page(repo, {}).items.length, 50);
  assert.equal(page(repo, { limit: "1000" }).items.length, 200);
  assert.equal(get(repo, { limit: "-1" }).status, 400);
});

test("a cursor that was not issued by the API is a 400", () => {
  const repo = seeded(10);
  for (const cursor of ["garbage!!", "%%%", "12"]) {
    assert.equal(get(repo, { cursor }).status, 400, `cursor ${JSON.stringify(cursor)} was accepted`);
  }
});

test("the export client follows the cursor and survives concurrent inserts", () => {
  const repo = seeded(230);
  const original = repo.newestFirst().map((o) => o.id);
  let minute = 50_000;
  let calls = 0;
  const all = fetchAllOrders((q) => {
    const res = listOrders(repo, q);
    calls++;
    repo.insert({ createdAt: stamp(minute++), customer: "late", totalCents: 1 });
    return res;
  }, 40);
  const ids = all.map((o) => o.id);
  assert.equal(new Set(ids).size, ids.length, "the export has duplicates");
  for (const id of original) assert.ok(ids.includes(id), `the export lost order ${id}`);
  assert.ok(calls >= 6 && calls <= 8, `${calls} requests for 230 orders by 40`);
});
