"""Monthly subscriptions."""

import calendar
from datetime import date


def months_after(start: date, months: int) -> date:
    """The date `months` months after `start`, on the last day of the month when it is shorter.

    Always computed FROM THE START, never from the previous renewal: stepping from Feb 28 would
    give Mar 28 for a subscription that started on Jan 31, and the 31st would be lost for good.
    """
    index = start.month - 1 + months
    year, month = start.year + index // 12, index % 12 + 1
    day = min(start.day, calendar.monthrange(year, month)[1])
    return date(year, month, day)


def add_month(d: date) -> date:
    return months_after(d, 1)


def renewals(start: date, count: int) -> list[date]:
    """The first `count` renewal dates of a monthly subscription that started on `start`."""
    return [months_after(start, n) for n in range(1, count + 1)]
