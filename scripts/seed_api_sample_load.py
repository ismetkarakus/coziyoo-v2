#!/usr/bin/env python3
"""Seed sample users and orders through Coziyoo HTTP API.

Creates buyers/sellers using /v1/auth/register and creates orders using
existing foods fetched from admin metadata endpoints.
"""

from __future__ import annotations

import argparse
import json
import random
import string
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any


@dataclass
class UserAccount:
    email: str
    password: str
    user_id: str
    access_token: str


def now_stamp() -> str:
    return datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S")


def rand_suffix(n: int = 6) -> str:
    alphabet = string.ascii_lowercase + string.digits
    return "".join(random.choice(alphabet) for _ in range(n))


def http_json(
    method: str,
    url: str,
    *,
    payload: dict[str, Any] | None = None,
    headers: dict[str, str] | None = None,
    timeout: float = 30.0,
) -> tuple[int, dict[str, Any]]:
    body: bytes | None = None
    req_headers = {"content-type": "application/json"}
    if headers:
        req_headers.update(headers)
    if payload is not None:
        body = json.dumps(payload).encode("utf-8")
    request = urllib.request.Request(url=url, data=body, headers=req_headers, method=method.upper())
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            status = response.status
            raw = response.read().decode("utf-8")
            return status, json.loads(raw) if raw else {}
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode("utf-8", errors="replace")
        try:
            parsed = json.loads(raw) if raw else {}
        except json.JSONDecodeError:
            parsed = {"error": {"code": "HTTP_ERROR", "message": raw}}
        return exc.code, parsed


def join_url(base_url: str, path: str, query: dict[str, Any] | None = None) -> str:
    base = base_url.rstrip("/")
    full = f"{base}{path}"
    if not query:
        return full
    return f"{full}?{urllib.parse.urlencode(query)}"


def register_user(base_url: str, *, email: str, password: str, display_name: str, user_type: str) -> UserAccount:
    status, body = http_json(
        "POST",
        join_url(base_url, "/v1/auth/register"),
        payload={
            "email": email,
            "password": password,
            "displayName": display_name,
            "userType": user_type,
            "countryCode": "TR",
            "language": "tr",
        },
    )
    if status != 201:
        raise RuntimeError(f"register failed ({email}) status={status} body={body}")
    data = body["data"]
    return UserAccount(
        email=email,
        password=password,
        user_id=data["user"]["id"],
        access_token=data["tokens"]["accessToken"],
    )


def admin_login(base_url: str, *, email: str, password: str) -> str:
    status, body = http_json(
        "POST",
        join_url(base_url, "/v1/admin/auth/login"),
        payload={"email": email, "password": password},
    )
    if status != 200:
        raise RuntimeError(f"admin login failed status={status} body={body}")
    return body["data"]["tokens"]["accessToken"]


def fetch_foods(base_url: str, *, admin_token: str, page_size: int = 100) -> list[dict[str, Any]]:
    all_rows: list[dict[str, Any]] = []
    page = 1
    while True:
        status, body = http_json(
            "GET",
            join_url(
                base_url,
                "/v1/admin/metadata/tables/foods/records",
                {"page": page, "pageSize": page_size, "sortDir": "desc"},
            ),
            headers={"authorization": f"Bearer {admin_token}"},
        )
        if status != 200:
            raise RuntimeError(f"fetch foods failed page={page} status={status} body={body}")
        rows = body.get("data", {}).get("rows", [])
        if not rows:
            break
        all_rows.extend(rows)
        total_pages = body.get("pagination", {}).get("totalPages", page)
        if page >= total_pages:
            break
        page += 1

    usable: list[dict[str, Any]] = []
    for row in all_rows:
        if not row.get("id") or not row.get("seller_id"):
            continue
        if row.get("is_active") is False:
            continue
        usable.append(row)
    return usable


def create_order(
    base_url: str,
    *,
    buyer_token: str,
    seller_id: str,
    items: list[dict[str, Any]],
    idempotency_key: str,
    max_retries: int = 6,
) -> dict[str, Any]:
    attempt = 0
    while True:
        status, body = http_json(
            "POST",
            join_url(base_url, "/v1/orders"),
            payload={
                "sellerId": seller_id,
                "deliveryType": "delivery",
                "deliveryAddress": {"city": "Istanbul", "line": "Kadikoy"},
                "items": items,
            },
            headers={
                "authorization": f"Bearer {buyer_token}",
                "Idempotency-Key": idempotency_key,
            },
        )
        if status == 201:
            return body
        if status == 429 and attempt < max_retries:
            wait_s = 2 ** attempt
            print(f"rate limited, retrying in {wait_s}s (attempt {attempt + 1}/{max_retries})")
            time.sleep(wait_s)
            attempt += 1
            continue
        raise RuntimeError(f"order create failed status={status} body={body}")


def build_items_for_seller(seller_foods: list[dict[str, Any]]) -> list[dict[str, Any]]:
    food_count = min(len(seller_foods), random.randint(1, 3))
    picked = random.sample(seller_foods, k=food_count)
    items: list[dict[str, Any]] = []
    for food in picked:
        qty = random.randint(1, 3)
        items.append({"foodId": food["id"], "quantity": qty})
    return items


def main() -> int:
    parser = argparse.ArgumentParser(description="Seed buyers/sellers/orders via Coziyoo API.")
    parser.add_argument("--base-url", default="https://api.coziyoo.com", help="API base URL")
    parser.add_argument("--buyers", type=int, default=10, help="Buyer users to create")
    parser.add_argument("--sellers", type=int, default=10, help="Seller users to create")
    parser.add_argument("--orders", type=int, default=100, help="Orders to create")
    parser.add_argument("--admin-email", default="admin@coziyoo.local", help="Admin email for metadata API")
    parser.add_argument("--admin-password", default="Admin12345!", help="Admin password for metadata API")
    parser.add_argument("--buyer-password", default="Buyer12345!", help="Password used for new buyers")
    parser.add_argument("--seller-password", default="Seller12345!", help="Password used for new sellers")
    parser.add_argument(
        "--order-interval-seconds",
        type=float,
        default=2.2,
        help="Sleep between order requests to reduce rate-limit hits",
    )
    parser.add_argument(
        "--out",
        default="scripts/seed_api_sample_load_output.json",
        help="Path to write created account/order summary",
    )
    args = parser.parse_args()

    seed_id = f"{now_stamp()}-{rand_suffix()}"
    random.seed(seed_id)
    print(f"seed run: {seed_id}")
    print(f"target: buyers={args.buyers} sellers={args.sellers} orders={args.orders}")

    admin_token = admin_login(args.base_url, email=args.admin_email, password=args.admin_password)
    foods = fetch_foods(args.base_url, admin_token=admin_token)
    if not foods:
        raise RuntimeError("No foods found in API. Seed foods first.")

    foods_by_seller: dict[str, list[dict[str, Any]]] = {}
    for food in foods:
        seller_id = str(food["seller_id"])
        foods_by_seller.setdefault(seller_id, []).append(food)

    seller_ids = [sid for sid, rows in foods_by_seller.items() if len(rows) > 0]
    if not seller_ids:
        raise RuntimeError("No seller/food pairs available for order creation.")
    print(f"fetched foods: {len(foods)} across sellers: {len(seller_ids)}")

    buyers: list[UserAccount] = []
    sellers: list[UserAccount] = []

    for i in range(args.buyers):
        email = f"api-seed-buyer-{seed_id}-{i + 1}@coziyoo.local"
        display_name = f"apiseedbuyer{seed_id.replace('-', '')}{i + 1}"
        account = register_user(
            args.base_url,
            email=email,
            password=args.buyer_password,
            display_name=display_name,
            user_type="buyer",
        )
        buyers.append(account)
        print(f"[buyer {i + 1}/{args.buyers}] {account.email} ({account.user_id})")

    for i in range(args.sellers):
        email = f"api-seed-seller-{seed_id}-{i + 1}@coziyoo.local"
        display_name = f"apiseedseller{seed_id.replace('-', '')}{i + 1}"
        account = register_user(
            args.base_url,
            email=email,
            password=args.seller_password,
            display_name=display_name,
            user_type="seller",
        )
        sellers.append(account)
        print(f"[seller {i + 1}/{args.sellers}] {account.email} ({account.user_id})")

    created_orders: list[str] = []
    for idx in range(args.orders):
        buyer = buyers[idx % len(buyers)]
        chosen_seller_id = random.choice(seller_ids)
        items = build_items_for_seller(foods_by_seller[chosen_seller_id])
        idem_key = f"api-seed-order-{seed_id}-{idx + 1}"
        result = create_order(
            args.base_url,
            buyer_token=buyer.access_token,
            seller_id=chosen_seller_id,
            items=items,
            idempotency_key=idem_key,
        )
        order_id = result["data"]["orderId"]
        created_orders.append(order_id)
        print(f"[order {idx + 1}/{args.orders}] orderId={order_id} buyer={buyer.user_id} seller={chosen_seller_id}")
        time.sleep(max(0.0, args.order_interval_seconds))

    summary = {
        "seedId": seed_id,
        "baseUrl": args.base_url,
        "buyersCreated": [{"email": b.email, "userId": b.user_id} for b in buyers],
        "sellersCreated": [{"email": s.email, "userId": s.user_id} for s in sellers],
        "ordersCreated": created_orders,
        "counts": {
            "buyers": len(buyers),
            "sellers": len(sellers),
            "orders": len(created_orders),
        },
    }
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(summary, f, indent=2)
    print(f"done. summary written to: {args.out}")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        raise SystemExit(1)
