"""Line totals for an invoice."""

from decimal import Decimal, ROUND_HALF_UP

CENT = Decimal("0.01")


def total(prices, tax_rate):
    """Sum the lines and add tax, to the cent."""
    gross = sum((Decimal(p) for p in prices), Decimal(0)) * (Decimal(1) + Decimal(tax_rate))
    return gross.quantize(CENT, rounding=ROUND_HALF_UP)
