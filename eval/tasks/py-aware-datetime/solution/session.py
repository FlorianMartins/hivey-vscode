"""Is this session still valid?"""

from datetime import datetime, timedelta, timezone

LIFETIME = timedelta(hours=1)


def _utc(moment):
    """The same instant, as an aware UTC timestamp. A bare timestamp is read as UTC."""
    if moment.tzinfo is None:
        return moment.replace(tzinfo=timezone.utc)
    return moment.astimezone(timezone.utc)


def expired(issued_at, now=None):
    """True when the session is older than its lifetime."""
    # Subtracting an aware timestamp from a naive one is a TypeError, not a wrong answer: the two
    # are not the same kind of quantity. Both sides are brought to UTC first.
    moment = _utc(now) if now is not None else datetime.now(timezone.utc)
    return moment - _utc(issued_at) > LIFETIME
