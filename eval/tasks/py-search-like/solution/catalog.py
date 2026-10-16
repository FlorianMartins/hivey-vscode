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


def _like_literal(term):
    """`term` as a LIKE pattern that matches only itself: %, _ and the escape character escaped."""
    return term.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def search_products(conn, term, limit=20):
    """Products whose name contains `term` (case does not matter), sorted by name.

    The term is a bound parameter, never part of the SQL text: interpolating it is what made
    "O'Reilly" a syntax error, and anything else an injection. Binding alone is not enough for
    LIKE, whose own wildcards survive it — "50%" matched every product — so they are escaped too.
    """
    sql = (
        "SELECT id, name, price_cents FROM products "
        "WHERE name LIKE ? ESCAPE '\\' ORDER BY name LIMIT ?"
    )
    rows = conn.execute(sql, (f"%{_like_literal(term)}%", int(limit)))
    return [{"id": r[0], "name": r[1], "price_cents": r[2]} for r in rows]
