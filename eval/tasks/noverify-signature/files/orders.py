from billing import charge


def line_total(quantity, unit_price):
    return charge(quantity * unit_price, "EUR")
