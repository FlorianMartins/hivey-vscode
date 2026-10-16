"""The product catalogue, in SQLite."""

import sqlite3

SCHEMA = """
CREATE TABLE products (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    price_cents INTEGER NOT NULL
);
"""


def connect(path=":memory:"):
    conn = sqlite3.connect(path)
    conn.executescript(SCHEMA)
    return conn


def add_product(conn, name, price_cents):
    cur = conn.execute("INSERT INTO products (name, price_cents) VALUES (?, ?)", (name, price_cents))
    return cur.lastrowid


def search_products(conn, term, limit=20):
    """Products whose name contains `term` (case does not matter), sorted by name."""
    sql = f"SELECT id, name, price_cents FROM products WHERE name LIKE '%{term}%' ORDER BY name LIMIT {limit}"
    return [{"id": r[0], "name": r[1], "price_cents": r[2]} for r in conn.execute(sql)]
