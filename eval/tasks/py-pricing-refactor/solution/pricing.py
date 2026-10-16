"""Checkout pricing."""

from decimal import ROUND_HALF_UP, Decimal

CENT = Decimal("0.01")
FREE = Decimal("0.00")

TIER_DISCOUNT = {"gold": Decimal("0.10"), "silver": Decimal("0.05")}

# Country → (free-shipping threshold, shipping cost). Anything else ships from the rest-of-world rate.
SHIPPING = {
    "BE": (Decimal("50"), Decimal("4.95")),
    "FR": (Decimal("75"), Decimal("9.95")),
    "NL": (Decimal("75"), Decimal("9.95")),
    "LU": (Decimal("75"), Decimal("9.95")),
    "DE": (Decimal("75"), Decimal("9.95")),
}
WORLD_SHIPPING = Decimal("19.95")

VAT_RATE = {"BE": Decimal("0.21"), "FR": Decimal("0.20"), "NL": Decimal("0.21"), "DE": Decimal("0.19"), "LU": Decimal("0.17")}

BULK_QTY = 10
BULK_FACTOR = Decimal("0.95")
WELCOME_RATE = Decimal("0.10")
WELCOME_CAP = Decimal("20")


def _line_total(item):
    if item["qty"] <= 0:
        raise ValueError(f"bad quantity for {item['sku']}")
    line = Decimal(item["unit_price"]) * item["qty"]
    # Ten or more of the same item: 5 % off the line. Not on books (fixed book price law).
    if item["qty"] >= BULK_QTY and item["category"] != "books":
        line = line * BULK_FACTOR
    return line


def _subtotal(cart):
    if not cart:
        raise ValueError("empty cart")
    subtotal = Decimal("0")
    for item in cart:
        subtotal += _line_total(item)
    return subtotal


def _code_discount(code, tier, subtotal, discount):
    """The extra discount a promo code adds on top of the tier discount."""
    if code is None or code == "FREESHIP":
        return Decimal("0")
    if code == "WELCOME10":
        if tier != "regular":
            raise ValueError("WELCOME10 is for new customers")
        return min(subtotal * WELCOME_RATE, WELCOME_CAP)
    if code.startswith("FLAT") and code[4:].isdigit():
        return min(Decimal(code[4:]), subtotal - discount)
    raise ValueError(f"unknown code {code}")


def _discount(subtotal, customer, code):
    discount = subtotal * TIER_DISCOUNT.get(customer["tier"], Decimal("0"))
    return discount + _code_discount(code, customer["tier"], subtotal, discount)


def _shipping(country, after, code):
    if country not in SHIPPING:
        if code == "FREESHIP":
            raise ValueError("FREESHIP is only for the EU")
        return WORLD_SHIPPING
    threshold, cost = SHIPPING[country]
    return FREE if after >= threshold or code == "FREESHIP" else cost


def _round(amount):
    return str(amount.quantize(CENT, ROUND_HALF_UP))


def quote(cart, customer, code=None):
    """Price a cart.

    cart: list of {"sku", "unit_price" (decimal string), "qty", "category"}
    customer: {"tier": "regular" | "silver" | "gold", "country": ISO code}
    code: a promo code, or None

    Returns {"subtotal", "discount", "shipping", "vat", "total"} as decimal strings.
    """
    subtotal = _subtotal(cart)
    discount = _discount(subtotal, customer, code)
    after = subtotal - discount
    shipping = _shipping(customer["country"], after, code)
    vat = (after + shipping) * VAT_RATE.get(customer["country"], Decimal("0"))
    # The total from the UNROUNDED VAT, as it always was: it can differ by a cent from the sum of
    # the rounded parts, and changing that would change invoices already issued.
    total = after + shipping + vat
    return {"subtotal": _round(subtotal), "discount": _round(discount), "shipping": str(shipping), "vat": _round(vat), "total": _round(total)}
