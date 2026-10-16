export interface Order {
  id: number;
  /** ISO timestamp. Orders imported from the old shop keep their original date. */
  createdAt: string;
  customer: string;
  totalCents: number;
}

export type NewOrder = Omit<Order, "id">;

/** Orders in memory. The real one is a SQL table with an index on (created_at, id). */
export class OrderRepo {
  private readonly rows: Order[] = [];
  private nextId = 1;

  insert(order: NewOrder): Order {
    const row = { id: this.nextId++, ...order };
    this.rows.push(row);
    return row;
  }

  /** Every order, newest first; orders with the same createdAt, highest id first. */
  newestFirst(): Order[] {
    return [...this.rows].sort((a, b) => (a.createdAt === b.createdAt ? b.id - a.id : a.createdAt < b.createdAt ? 1 : -1));
  }

  count(): number {
    return this.rows.length;
  }
}
