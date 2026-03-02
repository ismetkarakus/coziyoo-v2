from __future__ import annotations

from dataclasses import dataclass


@dataclass
class SalesToolResult:
    ok: bool
    message: str
    payload: dict


async def search_products(query: str) -> SalesToolResult:
    # TODO: replace with API integration in next stage.
    return SalesToolResult(ok=True, message="stubbed search", payload={"query": query, "items": []})


async def create_quote(product_id: str, quantity: int) -> SalesToolResult:
    # TODO: replace with API integration in next stage.
    return SalesToolResult(ok=True, message="stubbed quote", payload={"productId": product_id, "quantity": quantity})
