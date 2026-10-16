import { test } from "node:test";
import assert from "node:assert/strict";
import { listOrders } from "../src/api.js";
import { fetchAllOrders } from "../src/client.js";
import { OrderRepo } from "../src/orders.js";

function seeded(n: number): OrderRepo {
  const repo = new OrderRepo();
  for (let i = 0; i < n; i++) {
    const minute = String(i % 60).padStart(2, "0");
    const hour = String(Math.floor(i / 60)).padStart(2, "0");
    repo.insert({ createdAt: `2026-05-01T${hour}:${minute}:00Z`, customer: `c${i}`, totalCents: 100 + i });
  }
  return repo;
}

test("the first page is the newest orders", () => {
  const res = listOrders(seeded(10), { limit: "3" });
  assert.equal(res.status, 200);
  if (res.status !== 200) return;
  assert.deepEqual(res.body.items.map((o) => o.id), [10, 9, 8]);
});

test("the export gets every order once", () => {
  const repo = seeded(250);
  const all = fetchAllOrders((q) => listOrders(repo, q), 40);
  assert.equal(all.length, 250);
  assert.equal(new Set(all.map((o) => o.id)).size, 250);
});

test("a bad limit is a 400", () => {
  assert.equal(listOrders(seeded(1), { limit: "0" }).status, 400);
  assert.equal(listOrders(seeded(1), { limit: "abc" }).status, 400);
});
