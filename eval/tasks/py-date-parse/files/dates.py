from datetime import date


def parse_date(text):
    """Parse a date written the French way: 31/12/2026."""
    day, month, year = text.split("/")
    return date(int(year), int(day), int(month))
