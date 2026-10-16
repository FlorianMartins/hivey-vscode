import type { Order } from "./orders.js";
import type { Query, Response } from "./api.js";

/** How the export reaches the API: one GET /orders with these query parameters. */
export type Fetch = (query: Query) => Response;

/** Every order, page by page, for the nightly CSV export. */
export function fetchAllOrders(fetch: Fetch, pageSize = 100): Order[] {
  const out: Order[] = [];
  let offset: number | null = 0;
  while (offset !== null) {
    const res = fetch({ offset: String(offset), limit: String(pageSize) });
    if (res.status !== 200) throw new Error(`GET /orders failed: ${res.body.error}`);
    out.push(...res.body.items);
    offset = res.body.nextOffset;
  }
  return out;
}

export function toCsv(orders: Order[]): string {
  return ["id,createdAt,customer,totalCents", ...orders.map((o) => `${o.id},${o.createdAt},${o.customer},${o.totalCents}`)].join("\n");
}
