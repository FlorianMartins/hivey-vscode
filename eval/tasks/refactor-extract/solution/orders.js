const LOYAL_DISCOUNT = 0.9;

function netTotal(order) {
  const base = order.lines.reduce((s, l) => s + l.price * l.quantity, 0);
  return order.customer.loyal ? base * LOYAL_DISCOUNT : base;
}

export function quote(order) {
  return netTotal(order);
}

export function invoiceTotal(order) {
  return Math.round(netTotal(order) * 100) / 100;
}

export function summary(order) {
  return `${order.lines.length} lines, ${netTotal(order).toFixed(2)} EUR`;
}
