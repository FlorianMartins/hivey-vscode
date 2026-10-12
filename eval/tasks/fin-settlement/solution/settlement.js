// When a trade settles.

const DAY = 86_400_000;

/**
 * Is this a day on which anything settles?
 *
 * The holidays come from the CALLER. A calendar built into this file is wrong in another country and
 * wrong next year, and the person who finds out is a counterparty.
 */
function isBusinessDay(date, holidays) {
  const day = date.getUTCDay();
  if (day === 0 || day === 6) return false;
  return !holidays.includes(date.toISOString().slice(0, 10));
}

/** The settlement date for a trade, `days` business days after it. */
export function settles(tradeDate, days, holidays = []) {
  let date = new Date(`${tradeDate}T00:00:00Z`);
  // T+0 still has to land on a business day: nothing settles on a Sunday.
  while (!isBusinessDay(date, holidays)) date = new Date(date.getTime() + DAY);
  let left = days;
  while (left > 0) {
    date = new Date(date.getTime() + DAY);
    if (isBusinessDay(date, holidays)) left -= 1;
  }
  return date.toISOString().slice(0, 10);
}
