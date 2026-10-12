"""Is a venue open?"""

from datetime import time
from zoneinfo import ZoneInfo

# The venue's own time zone and its own session, in LOCAL time. A window written in UTC is right for
# half the year: the exchange does not move its bell when the clocks change, so the UTC offset of the
# open is not a constant.
VENUE = ZoneInfo("Europe/Paris")
SESSION_OPEN = time(9, 0)
SESSION_CLOSE = time(17, 30)


def is_open(at, holidays=()):
    """True when the venue is trading at this instant."""
    local = at.astimezone(VENUE)
    if local.weekday() >= 5:
        return False
    # The holidays come from the caller: a calendar in this file is wrong next year.
    if local.date().isoformat() in tuple(holidays):
        return False
    return SESSION_OPEN <= local.time() < SESSION_CLOSE
