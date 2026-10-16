"""The monthly sales report."""

from repo import MAX_IDS_PER_QUERY


def _money(cents):
    return f"{cents // 100}.{cents % 100:02d}"


def _fetch_all(fetch_many, ids):
    """{id: row} for every id that exists, in batches the database layer accepts.

    Each distinct id is asked for once, in sorted order so the queries are the same from one run to
    the next. This replaced one query per order and one per order line.
    """
    found = {}
    unique = sorted(set(ids))
    for start in range(0, len(unique), MAX_IDS_PER_QUERY):
        found.update(fetch_many(unique[start : start + MAX_IDS_PER_QUERY]))
    return found


def monthly_report(repo, year, month):
    """The report's lines: one per order (by order id), then the revenue per country and per category."""
    orders = sorted(repo.orders_for_month(year, month), key=lambda o: o["id"])
    customers = _fetch_all(repo.get_customers, [o["customer_id"] for o in orders])
    products = _fetch_all(repo.get_products, [l["product_id"] for o in orders for l in o["lines"]])

    lines = []
    by_country = {}
    by_category = {}
    for order in orders:
        customer = customers.get(order["customer_id"])
        name = customer["name"] if customer else f"unknown customer #{order['customer_id']}"
        country = customer["country"] if customer else "??"
        total = 0
        for line in order["lines"]:
            amount = line["quantity"] * line["unit_cents"]
            total += amount
            product = products.get(line["product_id"])
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
