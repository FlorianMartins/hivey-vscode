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
    case "refunded":
      return `invoice ${event.id} refunded ${event.cents} cents`;
  }
  // A `default` branch accepts every future addition in silence; assigning the remaining type to
  // `never` makes the compiler name the case that was forgotten, at the moment it is added.
  const missed: never = event;
  throw new Error(`unhandled event: ${JSON.stringify(missed)}`);
}
