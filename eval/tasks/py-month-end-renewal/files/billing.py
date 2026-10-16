"""The nightly billing job."""

from datetime import date

from subscription import renewals


def next_charge(start: date, today: date) -> date:
    """The first renewal of the subscription strictly after `today`."""
    months = (today.year - start.year) * 12 + (today.month - start.month) + 2
    for renewal in renewals(start, max(months, 1)):
        if renewal > today:
            return renewal
    raise AssertionError("unreachable")


def due_today(subscriptions: dict[str, date], today: date) -> list[str]:
    """The ids of the subscriptions that renew today, sorted."""
    due = []
    for sub_id, start in subscriptions.items():
        months = (today.year - start.year) * 12 + (today.month - start.month) + 1
        if today in renewals(start, max(months, 0)):
            due.append(sub_id)
    return sorted(due)
