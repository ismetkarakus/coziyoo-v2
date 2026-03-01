#!/usr/bin/env python3
"""Seed rich Turkish sample data through Coziyoo HTTP API + PostgreSQL.

Flow:
- Create buyers/sellers via /v1/auth/register
- Insert categories/foods directly into PostgreSQL
- Backfill profile and GPS fields for created users
- Create orders via /v1/orders
"""

from __future__ import annotations

import argparse
import json
import os
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


TURKISH_BUYER_NAMES: list[str] = [
    "Ahmet Yılmaz",
    "Mehmet Demir",
    "Ali Kaya",
    "Can Aydın",
    "Burak Şahin",
    "Murat Çelik",
    "Emre Arslan",
    "Deniz Koç",
    "Ece Yıldız",
    "Selin Öztürk",
]

TURKISH_SELLER_NAMES: list[str] = [
    "Fatma Karaca",
    "Ayşe Güneş",
    "Zeynep Aksoy",
    "Elif Turan",
    "Merve Erdem",
    "Hakan İnce",
    "Yusuf Sarı",
    "Hasan Uçar",
    "Gamze Korkmaz",
    "İrem Kurt",
]

CATEGORY_DEFS: list[dict[str, str]] = [
    {"tr": "Çorbalar", "en": "Soups"},
    {"tr": "Ana Yemekler", "en": "Main Dishes"},
    {"tr": "Zeytinyağlılar", "en": "Olive Oil Dishes"},
    {"tr": "Tatlılar", "en": "Desserts"},
    {"tr": "İçecekler", "en": "Beverages"},
]

FOOD_TEMPLATES: dict[str, list[dict[str, Any]]] = {
    "Çorbalar": [
        {
            "name": "Mercimek Çorbası",
            "card_summary": "Klasik kırmızı mercimek çorbası",
            "description": "Günlük hazırlanan, limonla servis edilen geleneksel mercimek çorbası.",
            "recipe": "Mercimek, soğan, havuç ve baharatlar ile 45 dakika pişirilir.",
            "ingredients": ["kırmızı mercimek", "soğan", "havuç", "tereyağı", "tuz"],
            "allergens": ["süt"],
        },
        {
            "name": "Ezogelin Çorbası",
            "card_summary": "Bulgur ve mercimekli baharatlı çorba",
            "description": "Nane ve pul biber ile tatlandırılmış yoğun kıvamlı ezogelin çorbası.",
            "recipe": "Mercimek ve bulgur kavrulur, salça ve baharatla kaynatılır.",
            "ingredients": ["mercimek", "ince bulgur", "salça", "nane", "soğan"],
            "allergens": [],
        },
    ],
    "Ana Yemekler": [
        {
            "name": "Karnıyarık",
            "card_summary": "Kıymalı patlıcan yemeği",
            "description": "Fırında pişmiş patlıcan içinde domatesli kıyma harcı ile hazırlanır.",
            "recipe": "Patlıcan kızartılır, kıymalı içle doldurulup fırınlanır.",
            "ingredients": ["patlıcan", "kıyma", "domates", "soğan", "biber"],
            "allergens": [],
        },
        {
            "name": "Tavuk Sote",
            "card_summary": "Sebzeli tavuk sote",
            "description": "Biber ve mantar ile wok tavada yüksek ateşte hazırlanır.",
            "recipe": "Jülyen tavuklar sebzelerle sotelenir ve baharatlanır.",
            "ingredients": ["tavuk", "biber", "mantar", "soğan", "zeytinyağı"],
            "allergens": [],
        },
    ],
    "Zeytinyağlılar": [
        {
            "name": "Zeytinyağlı Fasulye",
            "card_summary": "Soğuk servis yeşil fasulye",
            "description": "Domatesli ve zeytinyağlı klasik ev usulü tarif.",
            "recipe": "Fasulye, domates ve soğan ile kısık ateşte pişirilir.",
            "ingredients": ["yeşil fasulye", "domates", "soğan", "zeytinyağı", "sarımsak"],
            "allergens": [],
        },
        {
            "name": "Enginar Dolması",
            "card_summary": "İç baklalı enginar",
            "description": "Limonlu ve dereotlu hafif zeytinyağlı bir seçenek.",
            "recipe": "Enginar çanakları iç bakla harcıyla doldurulur ve pişirilir.",
            "ingredients": ["enginar", "iç bakla", "dereotu", "limon", "zeytinyağı"],
            "allergens": [],
        },
    ],
    "Tatlılar": [
        {
            "name": "Sütlaç",
            "card_summary": "Fırın üstü nar gibi sütlaç",
            "description": "Vanilya aromalı pirinçli süt tatlısı.",
            "recipe": "Pirinç süt ile kaynatılır, kaselerde fırınlanır.",
            "ingredients": ["süt", "pirinç", "şeker", "vanilya"],
            "allergens": ["süt"],
        },
        {
            "name": "Revani",
            "card_summary": "Şerbetli irmik tatlısı",
            "description": "Limon kabuğu aromalı yumuşak revani.",
            "recipe": "İrmik hamuru pişirilir, şerbet dökülerek dinlendirilir.",
            "ingredients": ["irmik", "yoğurt", "yumurta", "şeker", "un"],
            "allergens": ["gluten", "yumurta", "süt"],
        },
    ],
    "İçecekler": [
        {
            "name": "Ayran",
            "card_summary": "Soğuk ve köpüklü ayran",
            "description": "Günlük yoğurttan hazırlanmış serinletici içecek.",
            "recipe": "Yoğurt, su ve tuz yüksek devirde çırpılır.",
            "ingredients": ["yoğurt", "su", "tuz"],
            "allergens": ["süt"],
        },
        {
            "name": "Şalgam",
            "card_summary": "Acılı fermente içecek",
            "description": "Geleneksel Adana usulü mor havuç ve şalgam suyu.",
            "recipe": "Fermente şalgam suyu süzülerek soğuk servis edilir.",
            "ingredients": ["mor havuç", "şalgam", "su", "tuz"],
            "allergens": [],
        },
    ],
}

TURKEY_CITY_COORDS: list[tuple[str, float, float]] = [
    ("İstanbul", 41.0082, 28.9784),
    ("Ankara", 39.9334, 32.8597),
    ("İzmir", 38.4237, 27.1428),
    ("Bursa", 40.1950, 29.0600),
    ("Antalya", 36.8969, 30.7133),
    ("Adana", 37.0000, 35.3213),
    ("Konya", 37.8746, 32.4932),
    ("Gaziantep", 37.0662, 37.3833),
    ("Kayseri", 38.7225, 35.4875),
    ("Trabzon", 41.0015, 39.7178),
]


@dataclass
class UserAccount:
    email: str
    password: str
    user_id: str
    access_token: str
    full_name: str


def now_stamp() -> str:
    return datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S")


def rand_suffix(n: int = 6) -> str:
    alphabet = string.ascii_lowercase + string.digits
    return "".join(random.choice(alphabet) for _ in range(n))


def normalize_ascii(text: str) -> str:
    table = str.maketrans(
        {
            "ç": "c",
            "Ç": "c",
            "ğ": "g",
            "Ğ": "g",
            "ı": "i",
            "İ": "i",
            "ö": "o",
            "Ö": "o",
            "ş": "s",
            "Ş": "s",
            "ü": "u",
            "Ü": "u",
        }
    )
    return text.translate(table)


def slugify_display(text: str) -> str:
    cleaned = normalize_ascii(text).lower().replace("'", " ")
    parts = [p for p in cleaned.replace("-", " ").split() if p]
    return "_".join(parts)


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


def register_user(
    base_url: str,
    *,
    email: str,
    password: str,
    display_name: str,
    full_name: str,
    user_type: str,
) -> UserAccount:
    status, body = http_json(
        "POST",
        join_url(base_url, "/v1/auth/register"),
        payload={
            "email": email,
            "password": password,
            "displayName": display_name,
            "fullName": full_name,
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
        full_name=full_name,
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


def create_order(
    base_url: str,
    *,
    buyer_token: str,
    seller_id: str,
    items: list[dict[str, Any]],
    delivery_address: dict[str, Any],
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
                "deliveryAddress": delivery_address,
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
            wait_s = 2**attempt
            print(f"rate limited, retrying in {wait_s}s (attempt {attempt + 1}/{max_retries})")
            time.sleep(wait_s)
            attempt += 1
            continue
        raise RuntimeError(f"order create failed status={status} body={body}")


def load_db_driver() -> tuple[str, Any]:
    try:
        import psycopg  # type: ignore

        return "psycopg", psycopg
    except ImportError:
        pass

    try:
        import psycopg2  # type: ignore

        return "psycopg2", psycopg2
    except ImportError as exc:
        raise RuntimeError(
            "PostgreSQL driver not found. Install 'psycopg' or 'psycopg2-binary' to run this seed script."
        ) from exc


def open_db(database_url: str) -> tuple[Any, str]:
    driver_name, driver = load_db_driver()
    if driver_name == "psycopg":
        conn = driver.connect(database_url)
        conn.autocommit = False
        return conn, driver_name

    conn = driver.connect(database_url)
    conn.autocommit = False
    return conn, driver_name


def user_coordinates(index: int) -> tuple[str, float, float]:
    city, lat, lon = TURKEY_CITY_COORDS[index % len(TURKEY_CITY_COORDS)]
    jitter_lat = random.uniform(-0.03, 0.03)
    jitter_lon = random.uniform(-0.03, 0.03)
    return city, round(lat + jitter_lat, 6), round(lon + jitter_lon, 6)


def build_food_payload(category_name_tr: str, seller_slot: int, food_slot: int) -> dict[str, Any]:
    options = FOOD_TEMPLATES[category_name_tr]
    base = options[(seller_slot + food_slot) % len(options)]
    price = round(random.uniform(70, 280), 2)
    delivery_fee = round(random.uniform(10, 35), 2)
    current_stock = random.randint(12, 80)
    daily_stock = current_stock + random.randint(5, 50)
    prep_minutes = random.randint(15, 60)

    return {
        "name": f"{base['name']} ({seller_slot + 1}-{food_slot + 1})",
        "card_summary": base["card_summary"],
        "description": base["description"],
        "recipe": base["recipe"],
        "country_code": "TR",
        "price": price,
        "image_url": f"https://images.coziyoo.local/foods/{slugify_display(base['name'])}-{seller_slot + 1}-{food_slot + 1}.jpg",
        "ingredients_json": base["ingredients"],
        "allergens_json": base["allergens"],
        "preparation_time_minutes": prep_minutes,
        "serving_size": "1 porsiyon",
        "delivery_fee": delivery_fee,
        "max_delivery_distance_km": round(random.uniform(3, 18), 2),
        "delivery_options_json": {
            "delivery": True,
            "pickup": True,
            "minimumOrderAmount": round(random.uniform(120, 280), 2),
        },
        "current_stock": current_stock,
        "daily_stock": daily_stock,
        "is_available": True,
        "is_active": True,
    }


def seed_categories(conn: Any, *, count: int) -> list[dict[str, Any]]:
    categories: list[dict[str, Any]] = []
    with conn.cursor() as cur:
        for idx in range(count):
            base = CATEGORY_DEFS[idx % len(CATEGORY_DEFS)]
            name_tr = base["tr"]
            name_en = base["en"]
            if idx >= len(CATEGORY_DEFS):
                suffix = idx - len(CATEGORY_DEFS) + 2
                name_tr = f"{name_tr} {suffix}"
                name_en = f"{name_en} {suffix}"
            cur.execute(
                """
                INSERT INTO categories (name_tr, name_en, sort_order, is_active, created_at, updated_at)
                VALUES (%s, %s, %s, TRUE, now(), now())
                RETURNING id::text, name_tr, name_en
                """,
                (name_tr, name_en, idx),
            )
            row = cur.fetchone()
            categories.append({"id": row[0], "nameTr": row[1], "nameEn": row[2]})
    return categories


def ensure_user_gps_columns(conn: Any) -> None:
    with conn.cursor() as cur:
        cur.execute(
            """
            ALTER TABLE users
            ADD COLUMN IF NOT EXISTS latitude NUMERIC(9,6)
            """
        )
        cur.execute(
            """
            ALTER TABLE users
            ADD COLUMN IF NOT EXISTS longitude NUMERIC(9,6)
            """
        )
        cur.execute(
            """
            DO $$
            BEGIN
              IF NOT EXISTS (
                SELECT 1 FROM pg_constraint WHERE conname = 'users_latitude_range_check'
              ) THEN
                ALTER TABLE users
                ADD CONSTRAINT users_latitude_range_check CHECK (latitude BETWEEN -90 AND 90);
              END IF;
            END $$;
            """
        )
        cur.execute(
            """
            DO $$
            BEGIN
              IF NOT EXISTS (
                SELECT 1 FROM pg_constraint WHERE conname = 'users_longitude_range_check'
              ) THEN
                ALTER TABLE users
                ADD CONSTRAINT users_longitude_range_check CHECK (longitude BETWEEN -180 AND 180);
              END IF;
            END $$;
            """
        )


def backfill_users(conn: Any, users: list[UserAccount], *, role: str) -> dict[str, dict[str, Any]]:
    out: dict[str, dict[str, Any]] = {}
    with conn.cursor() as cur:
        for idx, user in enumerate(users):
            city, lat, lon = user_coordinates(idx + (100 if role == "seller" else 0))
            profile_image_url = f"https://images.coziyoo.local/{role}s/{slugify_display(user.full_name)}.jpg"
            cur.execute(
                """
                UPDATE users
                SET full_name = %s,
                    profile_image_url = %s,
                    country_code = 'TR',
                    language = 'tr',
                    latitude = %s,
                    longitude = %s,
                    updated_at = now()
                WHERE id = %s
                """,
                (user.full_name, profile_image_url, lat, lon, user.user_id),
            )
            out[user.user_id] = {
                "city": city,
                "latitude": lat,
                "longitude": lon,
                "profileImageUrl": profile_image_url,
            }
    return out


def seed_foods(
    conn: Any,
    *,
    sellers: list[UserAccount],
    categories: list[dict[str, Any]],
    foods_per_seller: int,
) -> dict[str, list[dict[str, Any]]]:
    foods_by_seller: dict[str, list[dict[str, Any]]] = {}
    with conn.cursor() as cur:
        for seller_idx, seller in enumerate(sellers):
            rows: list[dict[str, Any]] = []
            for food_idx in range(foods_per_seller):
                category = categories[food_idx % len(categories)]
                payload = build_food_payload(category["nameTr"], seller_idx, food_idx)
                cur.execute(
                    """
                    INSERT INTO foods (
                      seller_id,
                      category_id,
                      name,
                      card_summary,
                      description,
                      recipe,
                      country_code,
                      price,
                      image_url,
                      ingredients_json,
                      allergens_json,
                      preparation_time_minutes,
                      serving_size,
                      delivery_fee,
                      max_delivery_distance_km,
                      delivery_options_json,
                      current_stock,
                      daily_stock,
                      is_available,
                      is_active,
                      created_at,
                      updated_at
                    )
                    VALUES (
                      %s,
                      %s::uuid,
                      %s,
                      %s,
                      %s,
                      %s,
                      %s,
                      %s,
                      %s,
                      %s::jsonb,
                      %s::jsonb,
                      %s,
                      %s,
                      %s,
                      %s,
                      %s::jsonb,
                      %s,
                      %s,
                      %s,
                      %s,
                      now(),
                      now()
                    )
                    RETURNING id::text, seller_id::text, category_id::text, name, price::text
                    """,
                    (
                        seller.user_id,
                        category["id"],
                        payload["name"],
                        payload["card_summary"],
                        payload["description"],
                        payload["recipe"],
                        payload["country_code"],
                        payload["price"],
                        payload["image_url"],
                        json.dumps(payload["ingredients_json"], ensure_ascii=False),
                        json.dumps(payload["allergens_json"], ensure_ascii=False),
                        payload["preparation_time_minutes"],
                        payload["serving_size"],
                        payload["delivery_fee"],
                        payload["max_delivery_distance_km"],
                        json.dumps(payload["delivery_options_json"], ensure_ascii=False),
                        payload["current_stock"],
                        payload["daily_stock"],
                        payload["is_available"],
                        payload["is_active"],
                    ),
                )
                inserted = cur.fetchone()
                rows.append(
                    {
                        "id": inserted[0],
                        "sellerId": inserted[1],
                        "categoryId": inserted[2],
                        "name": inserted[3],
                        "price": inserted[4],
                    }
                )
            foods_by_seller[seller.user_id] = rows
    return foods_by_seller


def build_items_for_seller(seller_foods: list[dict[str, Any]]) -> list[dict[str, Any]]:
    count = min(len(seller_foods), random.randint(1, 3))
    picked = random.sample(seller_foods, k=count)
    return [{"foodId": row["id"], "quantity": random.randint(1, 3)} for row in picked]


def profile_for(index: int, names: list[str]) -> tuple[str, str]:
    full_name = names[index % len(names)]
    return slugify_display(full_name), full_name


def main() -> int:
    parser = argparse.ArgumentParser(description="Seed buyers/sellers/categories/foods/orders via Coziyoo API + PostgreSQL.")
    parser.add_argument("--base-url", default="https://api.coziyoo.com", help="API base URL")
    parser.add_argument("--database-url", default=os.environ.get("DATABASE_URL"), help="PostgreSQL DSN (or use DATABASE_URL env)")
    parser.add_argument("--buyers", type=int, default=10, help="Buyer users to create")
    parser.add_argument("--sellers", type=int, default=10, help="Seller users to create")
    parser.add_argument("--categories", type=int, default=5, help="Categories to create")
    parser.add_argument("--foods-per-seller", type=int, default=5, help="Foods to create for each new seller")
    parser.add_argument("--orders-per-buyer", type=int, default=5, help="Orders to create for each buyer")
    parser.add_argument("--admin-email", default="admin@coziyoo.com", help="Admin email for auth check")
    parser.add_argument("--admin-password", default="12345", help="Admin password for auth check")
    parser.add_argument("--buyer-password", default="Buyer12345!", help="Password used for new buyers")
    parser.add_argument("--seller-password", default="Seller12345!", help="Password used for new sellers")
    parser.add_argument("--seed", default=None, help="Deterministic seed string")
    parser.add_argument("--order-interval-seconds", type=float, default=1.2, help="Delay between order requests")
    parser.add_argument(
        "--out",
        default="scripts/seed_api_sample_load_output.json",
        help="Path to write created account/food/order summary",
    )
    args = parser.parse_args()

    if not args.database_url:
        raise RuntimeError("DATABASE_URL is required. Pass --database-url or export DATABASE_URL.")

    seed_id = args.seed or f"{now_stamp()}-{rand_suffix()}"
    random.seed(seed_id)
    print(f"seed run: {seed_id}")
    print(
        f"target: buyers={args.buyers} sellers={args.sellers} categories={args.categories} "
        f"foods_per_seller={args.foods_per_seller} orders_per_buyer={args.orders_per_buyer}"
    )

    _admin_token = admin_login(args.base_url, email=args.admin_email, password=args.admin_password)

    buyers: list[UserAccount] = []
    sellers: list[UserAccount] = []

    for i in range(args.buyers):
        handle, full_name = profile_for(i, TURKISH_BUYER_NAMES)
        email = f"{handle}.{seed_id}.{i + 1}@coziyoo.local"
        display_name = f"{handle}_{seed_id.replace('-', '')}_{i + 1}"
        account = register_user(
            args.base_url,
            email=email,
            password=args.buyer_password,
            display_name=display_name,
            full_name=full_name,
            user_type="buyer",
        )
        buyers.append(account)
        print(f"[buyer {i + 1}/{args.buyers}] {account.email} ({account.user_id})")

    for i in range(args.sellers):
        handle, full_name = profile_for(i, TURKISH_SELLER_NAMES)
        email = f"{handle}.{seed_id}.{i + 1}@coziyoo.local"
        display_name = f"{handle}_{seed_id.replace('-', '')}_{i + 1}"
        account = register_user(
            args.base_url,
            email=email,
            password=args.seller_password,
            display_name=display_name,
            full_name=full_name,
            user_type="seller",
        )
        sellers.append(account)
        print(f"[seller {i + 1}/{args.sellers}] {account.email} ({account.user_id})")

    conn, db_driver = open_db(args.database_url)
    print(f"connected to postgres with driver={db_driver}")
    try:
        ensure_user_gps_columns(conn)
        categories = seed_categories(conn, count=args.categories)
        buyer_geo = backfill_users(conn, buyers, role="buyer")
        seller_geo = backfill_users(conn, sellers, role="seller")
        foods_by_seller = seed_foods(
            conn,
            sellers=sellers,
            categories=categories,
            foods_per_seller=args.foods_per_seller,
        )
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()

    seller_ids = [s.user_id for s in sellers if s.user_id in foods_by_seller]
    created_orders: list[dict[str, Any]] = []
    if not seller_ids:
        raise RuntimeError("No seller foods created; cannot create orders.")

    for buyer_idx, buyer in enumerate(buyers):
        seller_rotation = random.sample(seller_ids, k=min(len(seller_ids), args.orders_per_buyer))
        while len(seller_rotation) < args.orders_per_buyer:
            seller_rotation.append(random.choice(seller_ids))

        b_geo = buyer_geo.get(buyer.user_id, {})
        for order_idx in range(args.orders_per_buyer):
            seller_id = seller_rotation[order_idx]
            items = build_items_for_seller(foods_by_seller[seller_id])
            idem_key = f"api-seed-order-{seed_id}-{buyer_idx + 1}-{order_idx + 1}"
            address = {
                "country": "TR",
                "city": b_geo.get("city", "İstanbul"),
                "district": "Merkez",
                "line": f"Deneme Sokak No:{order_idx + 1}",
                "postalCode": "34000",
                "latitude": b_geo.get("latitude"),
                "longitude": b_geo.get("longitude"),
            }
            result = create_order(
                args.base_url,
                buyer_token=buyer.access_token,
                seller_id=seller_id,
                items=items,
                delivery_address=address,
                idempotency_key=idem_key,
            )
            order_id = result["data"]["orderId"]
            created_orders.append(
                {
                    "orderId": order_id,
                    "buyerId": buyer.user_id,
                    "sellerId": seller_id,
                    "items": items,
                }
            )
            order_no = buyer_idx * args.orders_per_buyer + order_idx + 1
            total_orders = args.buyers * args.orders_per_buyer
            print(f"[order {order_no}/{total_orders}] orderId={order_id} buyer={buyer.user_id} seller={seller_id}")
            time.sleep(max(0.0, args.order_interval_seconds))

    summary = {
        "seedId": seed_id,
        "baseUrl": args.base_url,
        "counts": {
            "buyers": len(buyers),
            "sellers": len(sellers),
            "categories": len(categories),
            "foods": sum(len(rows) for rows in foods_by_seller.values()),
            "orders": len(created_orders),
        },
        "buyersCreated": [
            {
                "email": b.email,
                "userId": b.user_id,
                "fullName": b.full_name,
                "gps": buyer_geo.get(b.user_id),
            }
            for b in buyers
        ],
        "sellersCreated": [
            {
                "email": s.email,
                "userId": s.user_id,
                "fullName": s.full_name,
                "gps": seller_geo.get(s.user_id),
            }
            for s in sellers
        ],
        "categoriesCreated": categories,
        "foodsBySeller": foods_by_seller,
        "ordersCreated": created_orders,
    }
    with open(args.out, "w", encoding="utf-8") as fh:
        json.dump(summary, fh, ensure_ascii=False, indent=2)

    print(f"done. summary written to: {args.out}")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        raise SystemExit(1)
