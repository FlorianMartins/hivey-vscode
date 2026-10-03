from billing import charge


def footer(total):
    return "TOTAL " + charge(total, "USD")
