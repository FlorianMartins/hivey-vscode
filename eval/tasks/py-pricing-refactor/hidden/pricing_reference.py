"""Checkout pricing."""

from decimal import ROUND_HALF_UP, Decimal


def quote(cart, customer, code=None):
    """Price a cart.

    cart: list of {"sku", "unit_price" (decimal string), "qty", "category"}
    customer: {"tier": "regular" | "silver" | "gold", "country": ISO code}
    code: a promo code, or None

    Returns {"subtotal", "discount", "shipping", "vat", "total"} as decimal strings.
    """
    if not cart:
        raise ValueError("empty cart")
    subtotal = Decimal("0")
    for item in cart:
        if item["qty"] <= 0:
            raise ValueError(f"bad quantity for {item['sku']}")
        price = Decimal(item["unit_price"])
        line = price * item["qty"]
        # Ten or more of the same item: 5 % off the line. Not on books (fixed book price law).
        if item["qty"] >= 10 and item["category"] != "books":
            line = line * Decimal("0.95")
        subtotal += line

    discount = Decimal("0")
    if customer["tier"] == "gold":
        discount = subtotal * Decimal("0.10")
    elif customer["tier"] == "silver":
        discount = subtotal * Decimal("0.05")

    if code is not None:
        if code == "WELCOME10":
            if customer["tier"] == "regular":
                code_discount = subtotal * Decimal("0.10")
                if code_discount > Decimal("20"):
                    code_discount = Decimal("20")
                discount = discount + code_discount
            else:
                raise ValueError("WELCOME10 is for new customers")
        elif code == "FREESHIP":
            pass
        elif code.startswith("FLAT") and code[4:].isdigit():
            flat = Decimal(code[4:])
            if flat > subtotal - discount:
                flat = subtotal - discount
            discount = discount + flat
        else:
            raise ValueError(f"unknown code {code}")

    after = subtotal - discount
    if customer["country"] == "BE":
        if after >= Decimal("50") or code == "FREESHIP":
            shipping = Decimal("0.00")
        else:
            shipping = Decimal("4.95")
    elif customer["country"] in ("FR", "NL", "LU", "DE"):
        if after >= Decimal("75") or code == "FREESHIP":
            shipping = Decimal("0.00")
        else:
            shipping = Decimal("9.95")
    else:
        if code == "FREESHIP":
            raise ValueError("FREESHIP is only for the EU")
        shipping = Decimal("19.95")

    if customer["country"] == "BE":
        rate = Decimal("0.21")
    elif customer["country"] == "FR":
        rate = Decimal("0.20")
    elif customer["country"] == "NL":
        rate = Decimal("0.21")
    elif customer["country"] == "DE":
        rate = Decimal("0.19")
    elif customer["country"] == "LU":
        rate = Decimal("0.17")
    else:
        rate = Decimal("0")
    vat = (after + shipping) * rate

    cent = Decimal("0.01")
    total = after + shipping + vat
    return {
        "subtotal": str(subtotal.quantize(cent, ROUND_HALF_UP)),
        "discount": str(discount.quantize(cent, ROUND_HALF_UP)),
        "shipping": str(shipping),
        "vat": str(vat.quantize(cent, ROUND_HALF_UP)),
        "total": str(total.quantize(cent, ROUND_HALF_UP)),
    }
