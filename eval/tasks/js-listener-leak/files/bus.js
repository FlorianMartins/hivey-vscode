/** The app-wide event bus. */
export class EventBus {
  constructor({ maxListeners = 10, onWarn = (msg) => console.warn(msg) } = {}) {
    this.handlers = new Map();
    this.maxListeners = maxListeners;
    this.onWarn = onWarn;
  }

  on(event, handler) {
    const list = this.handlers.get(event) ?? [];
    list.push(handler);
    this.handlers.set(event, list);
    if (list.length > this.maxListeners) {
      this.onWarn(`possible listener leak: ${list.length} handlers for "${event}"`);
    }
  }

  off(event, handler) {
    const list = this.handlers.get(event);
    if (!list) return;
    const index = list.indexOf(handler);
    if (index >= 0) list.splice(index, 1);
  }

  emit(event, payload) {
    for (const handler of [...(this.handlers.get(event) ?? [])]) handler(payload);
  }

  listenerCount(event) {
    return this.handlers.get(event)?.length ?? 0;
  }
}
