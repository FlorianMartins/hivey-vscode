/** Every event the app emits, and what it carries. `undefined`: the event carries nothing. */
export interface Events {
  "app:ready": undefined;
  "user:login": { userId: string; at: number };
  "user:logout": { userId: string };
  "cart:add": { sku: string; quantity: number };
  "cart:clear": undefined;
}
