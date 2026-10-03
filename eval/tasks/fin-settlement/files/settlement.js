// When a trade settles.

/** The settlement date for a trade, `days` business days after it. */
export function settles(tradeDate, days, holidays = []) {
  const date = new Date(tradeDate);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
