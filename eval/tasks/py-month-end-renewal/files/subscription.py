"""Monthly subscriptions."""

from datetime import date


def add_month(d: date) -> date:
    if d.month == 12:
        return d.replace(year=d.year + 1, month=1)
    return d.replace(month=d.month + 1)


def renewals(start: date, count: int) -> list[date]:
    """The first `count` renewal dates of a monthly subscription that started on `start`."""
    out = []
    current = start
    for _ in range(count):
        current = add_month(current)
        out.append(current)
    return out
