"""Is this session still valid?"""

from datetime import datetime, timedelta

LIFETIME = timedelta(hours=1)


def expired(issued_at, now=None):
    """True when the session is older than its lifetime."""
    now = now or datetime.utcnow()
    return now - issued_at > LIFETIME
