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
    # A generator is consumed once. Everything after the first pass saw an exhausted iterator and
    # summed nothing — so the rows were right and every figure under them was zero.
    records = list(rows(text))
    body = [f"{account} {amount}" for account, amount in records]
    return {
        "lines": body,
        "count": len(records),
        "total": sum(amount for _, amount in records),
    }
