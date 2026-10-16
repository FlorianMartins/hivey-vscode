import type { Order, OrderRepo } from "./orders.js";

export interface Page {
  items: Order[];
  nextOffset: number | null;
}

export type Query = Record<string, string | undefined>;

export type Response = { status: 200; body: Page } | { status: 400; body: { error: string } };

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

function parseLimit(raw: string | undefined): number | null {
  if (raw === undefined) return DEFAULT_LIMIT;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) return null;
  return Math.min(n, MAX_LIMIT);
}

/** GET /orders?offset=&limit= — newest first. */
export function listOrders(repo: OrderRepo, query: Query): Response {
  const limit = parseLimit(query["limit"]);
  if (limit === null) return { status: 400, body: { error: "limit must be a positive integer" } };
  const offset = query["offset"] === undefined ? 0 : Number(query["offset"]);
  if (!Number.isInteger(offset) || offset < 0) return { status: 400, body: { error: "invalid offset" } };

  const all = repo.newestFirst();
  const items = all.slice(offset, offset + limit);
  const next = offset + items.length;
  return { status: 200, body: { items, nextOffset: next < all.length ? next : null } };
}
