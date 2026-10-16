import type { Order, OrderRepo } from "./orders.js";

export interface Page {
  items: Order[];
  /** Pass back as `cursor` to get the next page; null on the last page. */
  nextCursor: string | null;
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

/**
 * Where a page ended: the sort key of its last order.
 *
 * The KEY, not a position. An offset counts rows, so every order inserted ahead of it while a client
 * pages through shifts the rows under it — the next page repeats the end of the previous one. A key
 * says "older than this order", which stays true whatever is inserted. And the whole key: createdAt
 * alone would skip or repeat orders that share a timestamp, and id alone is not the sort order
 * (imported orders have a high id and an old date).
 */
interface Position {
  createdAt: string;
  id: number;
}

const CURSOR = /^o1\.(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z)\.(\d+)$/;

function encodeCursor(order: Order): string {
  return `o1.${order.createdAt}.${order.id}`;
}

function decodeCursor(raw: string): Position | null {
  const match = CURSOR.exec(raw);
  if (!match) return null;
  return { createdAt: match[1]!, id: Number(match[2]) };
}

/** Whether `order` comes after `position` in newest-first order. */
function isAfter(order: Order, position: Position): boolean {
  return order.createdAt < position.createdAt || (order.createdAt === position.createdAt && order.id < position.id);
}

/** GET /orders?cursor=&limit= — newest first. */
export function listOrders(repo: OrderRepo, query: Query): Response {
  const limit = parseLimit(query["limit"]);
  if (limit === null) return { status: 400, body: { error: "limit must be a positive integer" } };

  let position: Position | null = null;
  const raw = query["cursor"];
  if (raw !== undefined && raw !== "") {
    position = decodeCursor(raw);
    if (!position) return { status: 400, body: { error: "invalid cursor" } };
  }

  const rest = position ? repo.newestFirst().filter((o) => isAfter(o, position)) : repo.newestFirst();
  const items = rest.slice(0, limit);
  // One more than asked would exist: that, and only that, is what makes this not the last page.
  const more = rest.length > limit;
  return { status: 200, body: { items, nextCursor: more ? encodeCursor(items[items.length - 1]!) : null } };
}
