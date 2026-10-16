import type { Events } from "./events.js";

export type EventName = keyof Events;
export type Handler<K extends EventName> = (payload: Events[K]) => void;

/** What `emit` takes after the name: the payload, or nothing at all for an event that carries none. */
type PayloadArgs<K extends EventName> = Events[K] extends undefined ? [] : [payload: Events[K]];

/** The app's event bus, typed by `Events`: an unknown event or a wrong payload does not compile. */
export class Bus {
  // One map for every event, so its values cannot be typed per key; `on` and `emit` are the only
  // way in and both are typed, which is what keeps the cast below honest.
  private readonly handlers = new Map<EventName, Set<(payload: unknown) => void>>();

  /** Subscribes; returns the function that unsubscribes. */
  on<K extends EventName>(event: K, handler: Handler<K>): () => void {
    let set = this.handlers.get(event);
    if (!set) {
      set = new Set();
      this.handlers.set(event, set);
    }
    set.add(handler as (payload: unknown) => void);
    return () => this.off(event, handler);
  }

  off<K extends EventName>(event: K, handler: Handler<K>): void {
    this.handlers.get(event)?.delete(handler as (payload: unknown) => void);
  }

  emit<K extends EventName>(event: K, ...args: PayloadArgs<K>): void {
    const payload = args[0];
    for (const handler of [...(this.handlers.get(event) ?? [])]) handler(payload);
  }
}
