"""
seed_data.py

Run with: python seed_data.py

Populates the database with realistic demo data that produces interesting
outputs on the dashboard.

Creates:
  - 1 demo seller (Riya Sharma)
  - 2 SKUs (Blue Floral Kurti, Cotton Palazzo Set)
  - 30 days of synthetic order history for each SKU
  - Pre-warmed Thompson Sampling belief states for each SKU
  - Default seller settings

The order history is NOT random -- it is deterministically seeded (numpy
default_rng(42)) so that:
  - Blue Floral Kurti: lambda ~= 1.4 orders/day, current stock = 6 -> URGENT forecast
  - Cotton Palazzo Set: lambda ~= 2.0 orders/day, current stock = 40 -> SAFE forecast

The price_arms are pre-warmed with ~15 days of simulated exploration history
so the bar chart on the dashboard already shows the expected distribution
shape (concentrated at Rs 410-430 for Blue Floral Kurti, tapering at extremes).

Requires SUPABASE_DB_URL to already point at the target Supabase/Postgres
instance -- this script does not manage that connection itself, it just
calls into database.py.
"""

import uuid
import os
from datetime import datetime, date, timedelta, timezone
import numpy as np

import database
from models import Seller, SKU, Order, PriceArm, SellerSettings

# Use DEMO_SELLER_PHONE env var so this works without hardcoding a real number
DEMO_PHONE = os.environ.get("DEMO_SELLER_PHONE", "+919999999999")

# --- Seeded data constants (single source of truth for both initial seed and reset) ---

KURTI_SKU_DATA = {
    "sku_id": "blue_kurti",
    "sku_name": "Blue Floral Kurti",
    "current_stock": 6,
    "reorder_point": 15,
    "unit_cost": 280,
    "price_floor": 370,
    "price_ceiling": 490,
    "current_chosen_price": 410,
}

PALAZZO_SKU_DATA = {
    "sku_id": "cotton_palazzo",
    "sku_name": "Cotton Palazzo Set",
    "current_stock": 40,
    "reorder_point": 20,
    "unit_cost": 360,
    "price_floor": 490,
    "price_ceiling": 650,
    "current_chosen_price": 550,
}

KURTI_PRICES_30_DAYS = [
    370, 390, 390, 410, 410, 410, 410, 430, 410, 410,
    410, 430, 430, 410, 390, 410, 410, 430, 410, 410,
    430, 410, 410, 390, 410, 410, 430, 410, 410, 410
]

PALAZZO_PRICES_30_DAYS = [
    490, 510, 530, 550, 550, 550, 570, 550, 550, 530,
    550, 550, 570, 550, 550, 530, 550, 550, 550, 570,
    550, 550, 530, 550, 570, 550, 550, 550, 530, 550
]

KURTI_ARMS = [
    (370, 3.0, 5.0, 4),
    (390, 5.0, 4.0, 6),
    (410, 8.0, 4.0, 9),
    (430, 6.0, 4.0, 7),
    (450, 3.0, 5.0, 4),
    (470, 2.0, 5.0, 3),
    (490, 2.0, 6.0, 3),
]

PALAZZO_ARMS = [
    (490, 2.0, 5.0, 3),
    (510, 3.0, 4.0, 4),
    (530, 4.0, 4.0, 5),
    (550, 7.0, 3.0, 8),
    (570, 6.0, 4.0, 7),
    (590, 3.0, 5.0, 4),
    (610, 2.0, 5.0, 3),
    (630, 2.0, 6.0, 3),
    (650, 1.0, 5.0, 2),
]


def seed_seller_data(seller_id: str) -> None:
    """
    Seed order history, price arms, and settings for a specific seller.
    This is called by both the initial seed() and reset_demo_seller_data().
    Assumes the seller and SKUs already exist in the database.
    """
    rng = np.random.default_rng(42)
    today = date.today()
    
    # --- Order history: Blue Floral Kurti ---
    kurti_orders = []
    for i, price in enumerate(KURTI_PRICES_30_DAYS):
        day = today - timedelta(days=30 - i)
        units = int(rng.poisson(1.4))
        rev = units * price
        margin = units * (price - KURTI_SKU_DATA["unit_cost"])
        order = Order(
            order_id=str(uuid.uuid4()),
            sku_id=KURTI_SKU_DATA["sku_id"],
            seller_id=seller_id,
            order_date=day,
            units_sold=units,
            price_charged=price,
            revenue=rev,
            margin=margin
        )
        kurti_orders.append(order)
    database.insert_orders_bulk(kurti_orders)

    # --- Order history: Cotton Palazzo Set ---
    palazzo_orders = []
    for i, price in enumerate(PALAZZO_PRICES_30_DAYS):
        day = today - timedelta(days=30 - i)
        units = int(rng.poisson(2.0))
        rev = units * price
        margin = units * (price - PALAZZO_SKU_DATA["unit_cost"])
        order = Order(
            order_id=str(uuid.uuid4()),
            sku_id=PALAZZO_SKU_DATA["sku_id"],
            seller_id=seller_id,
            order_date=day,
            units_sold=units,
            price_charged=price,
            revenue=rev,
            margin=margin
        )
        palazzo_orders.append(order)
    database.insert_orders_bulk(palazzo_orders)

    # --- Price arms: Blue Floral Kurti ---
    kurti_arms = []
    for price_val, alpha, beta_p, times in KURTI_ARMS:
        arm = PriceArm(
            arm_id=str(uuid.uuid4()),
            sku_id=KURTI_SKU_DATA["sku_id"],
            price_value=price_val,
            alpha=alpha,
            beta_param=beta_p,
            times_chosen=times,
            is_active=True,
            last_updated=datetime.now(timezone.utc)
        )
        kurti_arms.append(arm)
    database.insert_price_arms_bulk(kurti_arms)

    # --- Price arms: Cotton Palazzo Set ---
    palazzo_arms = []
    for price_val, alpha, beta_p, times in PALAZZO_ARMS:
        arm = PriceArm(
            arm_id=str(uuid.uuid4()),
            sku_id=PALAZZO_SKU_DATA["sku_id"],
            price_value=price_val,
            alpha=alpha,
            beta_param=beta_p,
            times_chosen=times,
            is_active=True,
            last_updated=datetime.now(timezone.utc)
        )
        palazzo_arms.append(arm)
    database.insert_price_arms_bulk(palazzo_arms)

    # --- Seller settings ---
    settings = SellerSettings(
        seller_id=seller_id,
        daily_alert_time="08:00",
        alert_language="hi",
        notify_on_price_change=True,
        notify_on_stockout_risk=True,
        price_change_threshold=0.05,
        updated_at=datetime.now(timezone.utc)
    )
    database.upsert_seller_settings(settings)


def seed():
    database.create_tables()

    with database.get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM agent_actions WHERE seller_id = %s", ("riya_sharma",))
            cur.execute("DELETE FROM orders WHERE seller_id = %s", ("riya_sharma",))
            cur.execute("DELETE FROM seller_settings WHERE seller_id = %s", ("riya_sharma",))
            cur.execute("DELETE FROM price_arms WHERE sku_id IN (SELECT sku_id FROM skus WHERE seller_id = %s)", ("riya_sharma",))
            cur.execute("DELETE FROM skus WHERE seller_id = %s", ("riya_sharma",))
            cur.execute("DELETE FROM sellers WHERE seller_id = %s", ("riya_sharma",))

    # --- Seller ---
    seller = Seller(
        seller_id="riya_sharma",
        seller_name="Riya Sharma",
        phone_number=DEMO_PHONE,
        language_preference="hi",
        auth_user_id=str(uuid.uuid5(uuid.NAMESPACE_URL, "seller:riya_sharma")),
        created_at=datetime.now(timezone.utc)
    )
    database.insert_seller(seller)

    # --- SKU 1: Blue Floral Kurti (URGENT scenario) ---
    kurti = SKU(
        sku_id=KURTI_SKU_DATA["sku_id"],
        seller_id="riya_sharma",
        sku_name=KURTI_SKU_DATA["sku_name"],
        current_stock=KURTI_SKU_DATA["current_stock"],
        reorder_point=KURTI_SKU_DATA["reorder_point"],
        unit_cost=KURTI_SKU_DATA["unit_cost"],
        price_floor=KURTI_SKU_DATA["price_floor"],
        price_ceiling=KURTI_SKU_DATA["price_ceiling"],
        current_chosen_price=KURTI_SKU_DATA["current_chosen_price"],
        created_at=datetime.now(timezone.utc)
    )
    database.insert_sku(kurti)

    # --- SKU 2: Cotton Palazzo Set (SAFE scenario) ---
    palazzo = SKU(
        sku_id=PALAZZO_SKU_DATA["sku_id"],
        seller_id="riya_sharma",
        sku_name=PALAZZO_SKU_DATA["sku_name"],
        current_stock=PALAZZO_SKU_DATA["current_stock"],
        reorder_point=PALAZZO_SKU_DATA["reorder_point"],
        unit_cost=PALAZZO_SKU_DATA["unit_cost"],
        price_floor=PALAZZO_SKU_DATA["price_floor"],
        price_ceiling=PALAZZO_SKU_DATA["price_ceiling"],
        current_chosen_price=PALAZZO_SKU_DATA["current_chosen_price"],
        created_at=datetime.now(timezone.utc)
    )
    database.insert_sku(palazzo)

    # Seed the data
    seed_seller_data("riya_sharma")

    print("Seed complete.")
    print(f"  Seller: Riya Sharma ({DEMO_PHONE})")
    print(f"  SKU 1: Blue Floral Kurti - stock=6, URGENT forecast expected")
    print(f"  SKU 2: Cotton Palazzo Set - stock=40, SAFE forecast expected")
    print(f"  Price arms seeded for both SKUs")
    print(f"  Seller settings: alert at 08:00, language=hi")



if __name__ == "__main__":
    seed()