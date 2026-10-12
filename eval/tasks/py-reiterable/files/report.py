"""Read the ledger and summarise it."""


def rows(text):
    """One record per non-empty line: (account, amount in cents)."""
    for line in text.splitlines():
        line = line.strip()
        if not line:
            continue
        account, amount = line.split(",")
        yield account, int(amount)


def render(text):
    """The lines, then the number of them and their total."""
    records = rows(text)
    body = [f"{account} {amount}" for account, amount in records]
    return {
        "lines": body,
        "count": sum(1 for _ in records),
        "total": sum(amount for _, amount in records),
    }
