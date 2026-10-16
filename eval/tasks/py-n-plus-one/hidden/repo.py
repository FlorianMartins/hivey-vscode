"""Data access. Production implements this over Postgres; every method is one query."""

MAX_IDS_PER_QUERY = 100


class Repo:
    def orders_for_month(self, year, month):
        """The month's orders: dicts with id, customer_id and lines ([{product_id, quantity, unit_cents}])."""
        raise NotImplementedError

    def get_customer(self, customer_id):
        """One customer ({id, name, country}), or None."""
        raise NotImplementedError

    def get_customers(self, customer_ids):
        """{id: customer} for the ids that exist. At most MAX_IDS_PER_QUERY ids, or ValueError."""
        raise NotImplementedError

    def get_product(self, product_id):
        """One product ({id, name, category}), or None."""
        raise NotImplementedError

    def get_products(self, product_ids):
        """{id: product} for the ids that exist. At most MAX_IDS_PER_QUERY ids, or ValueError."""
        raise NotImplementedError


class MemoryRepo(Repo):
    """For tests."""

    def __init__(self, orders, customers, products):
        self.orders = orders
        self.customers = {c["id"]: c for c in customers}
        self.products = {p["id"]: p for p in products}

    def orders_for_month(self, year, month):
        return [o for o in self.orders if o["month"] == (year, month)]

    def get_customer(self, customer_id):
        return self.customers.get(customer_id)

    def get_customers(self, customer_ids):
        ids = list(customer_ids)
        if len(ids) > MAX_IDS_PER_QUERY:
            raise ValueError(f"{len(ids)} ids in one query, at most {MAX_IDS_PER_QUERY}")
        return {i: self.customers[i] for i in ids if i in self.customers}

    def get_product(self, product_id):
        return self.products.get(product_id)

    def get_products(self, product_ids):
        ids = list(product_ids)
        if len(ids) > MAX_IDS_PER_QUERY:
            raise ValueError(f"{len(ids)} ids in one query, at most {MAX_IDS_PER_QUERY}")
        return {i: self.products[i] for i in ids if i in self.products}
