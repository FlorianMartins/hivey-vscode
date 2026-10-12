from datetime import date


def parse_date(text):
    """Parse a date written the French way: 31/12/2026."""
    day, month, year = text.split("/")
    # `date` takes year, month, day — the day and the month were the wrong way round, which is
    # invisible for every date whose day is also a valid month.
    return date(int(year), int(month), int(day))
