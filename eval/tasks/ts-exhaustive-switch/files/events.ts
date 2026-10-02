// What can happen to an invoice.

export type Event =
  | { kind: "issued"; id: string }
  | { kind: "settled"; id: string }
  | { kind: "cancelled"; id: string; reason: string }
  | { kind: "refunded"; id: string; cents: number };

export function describe(event: Event): string {
  switch (event.kind) {
    case "issued":
      return `invoice ${event.id} issued`;
    case "settled":
      return `invoice ${event.id} settled`;
    case "cancelled":
      return `invoice ${event.id} cancelled: ${event.reason}`;
    default:
      return "unknown event";
  }
}
