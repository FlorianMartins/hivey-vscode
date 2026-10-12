from billing import charge


def line_total(quantity, unit_price):
    return charge("EUR", quantity * unit_price)
