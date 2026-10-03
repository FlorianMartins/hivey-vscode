"""Is a venue open?"""

from datetime import datetime, timezone

# Paris opens at 09:00 and closes at 17:30, local time. Somebody wrote down what that was in UTC on
# the day they wrote this.
OPEN_UTC = 7
CLOSE_UTC = 15


def is_open(at, holidays=()):
    """True when the venue is trading at this instant."""
    moment = at.astimezone(timezone.utc)
    return OPEN_UTC <= moment.hour < CLOSE_UTC
