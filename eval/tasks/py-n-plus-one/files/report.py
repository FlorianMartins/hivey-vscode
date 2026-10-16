"""The monthly sales report."""


def _money(cents):
    return f"{cents // 100}.{cents % 100:02d}"


def monthly_report(repo, year, month):
    """The report's lines: one per order (by order id), then the revenue per country and per category."""
    lines = []
    by_country = {}
    by_category = {}
    for order in sorted(repo.orders_for_month(year, month), key=lambda o: o["id"]):
        customer = repo.get_customer(order["customer_id"])
        name = customer["name"] if customer else f"unknown customer #{order['customer_id']}"
        country = customer["country"] if customer else "??"
        total = 0
        for line in order["lines"]:
            amount = line["quantity"] * line["unit_cents"]
            total += amount
            product = repo.get_product(line["product_id"])
            category = product["category"] if product else "uncategorised"
            by_category[category] = by_category.get(category, 0) + amount
        by_country[country] = by_country.get(country, 0) + total
        lines.append(f"#{order['id']} {name} ({country}) {_money(total)}")
    lines.append("-- by country")
    for country in sorted(by_country):
        lines.append(f"{country} {_money(by_country[country])}")
    lines.append("-- by category")
    for category in sorted(by_category):
        lines.append(f"{category} {_money(by_category[category])}")
    return lines
