export function quote(order) {
  const base = order.lines.reduce((s, l) => s + l.price * l.quantity, 0);
  return order.customer.loyal ? base * 0.9 : base;
}

export function invoiceTotal(order) {
  const base = order.lines.reduce((s, l) => s + l.price * l.quantity, 0);
  const discounted = order.customer.loyal ? base * 0.9 : base;
  return Math.round(discounted * 100) / 100;
}

export function summary(order) {
  const base = order.lines.reduce((s, l) => s + l.price * l.quantity, 0);
  const total = order.customer.loyal ? base * 0.9 : base;
  return `${order.lines.length} lines, ${total.toFixed(2)} EUR`;
}
