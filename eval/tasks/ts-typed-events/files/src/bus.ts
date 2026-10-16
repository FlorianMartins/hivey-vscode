type Handler = (payload: any) => void;

/** The app's event bus. */
export class Bus {
  private readonly handlers = new Map<string, Set<Handler>>();

  /** Subscribes; returns the function that unsubscribes. */
  on(event: string, handler: Handler): () => void {
    let set = this.handlers.get(event);
    if (!set) {
      set = new Set();
      this.handlers.set(event, set);
    }
    set.add(handler);
    return () => this.off(event, handler);
  }

  off(event: string, handler: Handler): void {
    this.handlers.get(event)?.delete(handler);
  }

  emit(event: string, payload?: any): void {
    for (const handler of [...(this.handlers.get(event) ?? [])]) handler(payload);
  }
}
