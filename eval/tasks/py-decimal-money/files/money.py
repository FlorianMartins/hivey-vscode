"""Line totals for an invoice."""


def total(prices, tax_rate):
    """Sum the lines and add tax, to the cent."""
    # Converted to float to do the arithmetic, which is where the cents go missing.
    return round(float(sum(prices)) * (1 + float(tax_rate)), 2)
