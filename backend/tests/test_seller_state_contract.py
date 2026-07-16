import importlib
import os
import sys
import uuid
from datetime import date, timedelta

import psycopg2
import pytest

BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, BACKEND_DIR)

TEST_DB_URL = "postgresql://postgres@localhost:5432/seller_economic_twin_test"
os.environ.setdefault("SUPABASE_DB_URL", TEST_DB_URL)


def _import_backend_modules():
    import database as database_module
    import models as models_module
    import forecasting_tool as forecasting_tool_module
    import pricing_tool as pricing_tool_module

    return database_module, models_module, forecasting_tool_module, pricing_tool_module


@pytest.fixture(autouse=True)
def fresh_db():
    """Create a disposable local Postgres database for each test."""
    admin_conn = psycopg2.connect("postgresql://postgres@localhost:5432/postgres")
    admin_conn.autocommit = True
    with admin_conn.cursor() as cur:
        cur.execute(
            "SELECT 1 FROM pg_database WHERE datname = %s",
            ("seller_economic_twin_test",),
        )
        if cur.fetchone() is None:
            cur.execute("CREATE DATABASE seller_economic_twin_test")
    admin_conn.close()

    database, models, forecasting_tool, pricing_tool = _import_backend_modules()
    importlib.reload(database)
    importlib.reload(models)
    importlib.reload(forecasting_tool)
    importlib.reload(pricing_tool)

    globals()["database"] = database
    globals()["models"] = models
    globals()["forecasting_tool"] = forecasting_tool
    globals()["pricing_tool"] = pricing_tool

    with database.get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("CREATE SCHEMA IF NOT EXISTS auth")
            cur.execute("CREATE TABLE IF NOT EXISTS auth.users (id UUID PRIMARY KEY)")
            cur.execute(
                """
                CREATE OR REPLACE FUNCTION auth.uid()
                RETURNS UUID
                LANGUAGE SQL
                AS $$ SELECT '00000000-0000-0000-0000-000000000000'::UUID $$;
                """
            )

    database.create_tables()

    with database.get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                TRUNCATE sellers, skus, orders, price_arms,
                         agent_actions, conversations, seller_settings CASCADE
                """
            )

    database.enable_rls()
    yield


def _seed_seller_and_sku(seller_id="s1", sku_id="k1", days_of_history=10):
    seller = models.Seller(
        seller_id=seller_id,
        seller_name="Riya Sharma",
        phone_number="+911111111111",
        language_preference="hi",
    )
    database.insert_seller(seller)

    sku = models.SKU(
        sku_id=sku_id,
        seller_id=seller_id,
        sku_name="Blue Floral Kurti",
        current_stock=6,
        reorder_point=15,
        unit_cost=280,
        price_floor=370,
        price_ceiling=490,
    )
    database.insert_sku(sku)

    for price_value in range(370, 491, 20):
        database.upsert_price_arm(
            models.PriceArm(
                arm_id=str(uuid.uuid4()),
                sku_id=sku_id,
                price_value=price_value,
                alpha=2.0,
                beta_param=3.0,
                times_chosen=1,
                is_active=True,
            )
        )

    today = date.today()
    for offset in range(days_of_history):
        order = models.Order(
            order_id=str(uuid.uuid4()),
            sku_id=sku_id,
            seller_id=seller_id,
            order_date=today - timedelta(days=offset),
            units_sold=2 if offset % 2 == 0 else 1,
            price_charged=410,
            revenue=410 * (2 if offset % 2 == 0 else 1),
            margin=260 if offset % 2 == 0 else 130,
        )
        database.insert_order(order)

    return seller, sku


def test_build_seller_state_is_accepted_by_both_statistical_tools():
    _seed_seller_and_sku(days_of_history=10)

    seller_state = database.build_seller_state("s1", "k1")

    assert seller_state["seller_id"] == "s1"
    assert seller_state["sku_id"] == "k1"
    assert seller_state["sku_name"] == "Blue Floral Kurti"
    assert seller_state["order_history"][0]["date"] == (date.today().isoformat())
    assert isinstance(seller_state["order_history"][0]["date"], str)
    assert seller_state["price_arms"][0]["price_value"] == 370
    assert seller_state["price_arms"][0]["beta_param"] == 3.0

    pricing_result = pricing_tool.run_pricing_tool(seller_state, rng_seed=7)
    forecast_result = forecasting_tool.run_forecasting_tool(seller_state, n_simulations=25, rng_seed=7)

    assert isinstance(pricing_result, dict)
    assert pricing_result["days_of_history"] == 10
    assert pricing_result["cold_start"] is False
    assert pricing_result["chosen_price"] in range(370, 491)

    assert isinstance(forecast_result, dict)
    assert forecast_result["days_of_history"] == 10
    assert forecast_result["starting_stock"] == 6
    assert forecast_result["lambda_source"] == "estimated"
    assert len(forecast_result["fan_chart"]) == 30


def test_build_seller_state_handles_cold_start_without_orders():
    _seed_seller_and_sku(days_of_history=0)

    seller_state = database.build_seller_state("s1", "k1")

    assert seller_state["order_history"] == []
    assert seller_state["yesterday_price"] is None
    assert seller_state["yesterday_units_sold"] is None
    assert seller_state["yesterday_margin"] is None

    pricing_result = pricing_tool.run_pricing_tool(seller_state, rng_seed=11)
    forecast_result = forecasting_tool.run_forecasting_tool(seller_state, n_simulations=20, rng_seed=11)

    assert pricing_result["cold_start"] is True
    assert pricing_result["days_of_history"] == 0
    assert forecast_result["lambda_source"] == "prior"
    assert forecast_result["days_of_history"] == 0


def test_build_seller_state_exposes_yesterday_order_branches():
    _seed_seller_and_sku(days_of_history=1)
    with_yesterday = database.build_seller_state("s1", "k1")

    assert with_yesterday["yesterday_price"] == 410
    assert with_yesterday["yesterday_units_sold"] == 2
    assert with_yesterday["yesterday_margin"] == 260

    seller = models.Seller(
        seller_id="s2",
        seller_name="Asha Mehta",
        phone_number="+911111111112",
        language_preference="en",
    )
    database.insert_seller(seller)

    sku = models.SKU(
        sku_id="k2",
        seller_id="s2",
        sku_name="Green Dupatta",
        current_stock=8,
        reorder_point=10,
        unit_cost=240,
        price_floor=350,
        price_ceiling=470,
    )
    database.insert_sku(sku)

    for price_value in range(350, 471, 20):
        database.upsert_price_arm(
            models.PriceArm(
                arm_id=str(uuid.uuid4()),
                sku_id="k2",
                price_value=price_value,
                alpha=2.0,
                beta_param=3.0,
                times_chosen=1,
                is_active=True,
            )
        )

    without_yesterday = database.build_seller_state("s2", "k2")

    assert without_yesterday["yesterday_price"] is None
    assert without_yesterday["yesterday_units_sold"] is None
    assert without_yesterday["yesterday_margin"] is None
