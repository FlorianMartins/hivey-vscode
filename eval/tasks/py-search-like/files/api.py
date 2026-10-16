"""The /search endpoint, minus the HTTP plumbing."""

from catalog import search_products


def handle_search(conn, params):
    term = params.get("q", "").strip()
    limit = min(int(params.get("limit", "20")), 100)
    return {"status": 200, "results": search_products(conn, term, limit)}
