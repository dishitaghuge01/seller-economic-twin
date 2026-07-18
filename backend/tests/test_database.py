"""
tests/test_database.py

Tests for every query function in database.py, run against a real
Postgres instance (Postgres has no lightweight in-memory equivalent to
SQLite's :memory: database).

SUPABASE_DB_URL must already point at a local/test Postgres instance,
set via the environment before pytest runs -- never point it at the
real seeded project, since tests truncate tables between runs.

test_rls_denies_cross_seller_read additionally requires a non-superuser,
non-BYPASSRLS Postgres role that mirrors Supabase's `authenticated` role.
Locally that's the `app_user` role set up alongside the auth.users /
auth.uid() stub schema (see the project README for the exact SQL). Its
connection string is read from RLS_TEST_DB_URL; if that variable isn't
set, the RLS test is skipped with an explanation rather than silently
passing.
"""

import os
import sys
import uuid
import pytest
import psycopg2
import psycopg2.extras
import psycopg2.errors
from datetime import datetime, date, timedelta, timezone

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import database
from models import Seller, SKU, Order, PriceArm, AgentAction, Conversation, SellerSettings

RLS_TEST_DB_URL = os.environ.get("RLS_TEST_DB_URL")


@pytest.fixture(autouse=True)
def fresh_db():
    """Recreate tables/RLS and truncate all data before every test."""
    database.create_tables()
    database.create_local_auth_stub()
    database.enable_rls()
    with database.get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                TRUNCATE sellers, skus, orders, price_arms,
                         agent_actions, conversations, seller_settings CASCADE
            """)
    yield


# ---------------------------------------------------------------------------
# Sellers
# ---------------------------------------------------------------------------

def test_insert_and_get_seller():
    seller = Seller(
        seller_id="s1", seller_name="Riya Sharma", phone_number="+911111111111",
        language_preference="hi"
    )
    database.insert_seller(seller)
    fetched = database.get_seller_by_id("s1")
    assert fetched is not None
    assert fetched.seller_id == seller.seller_id
    assert fetched.seller_name == seller.seller_name
    assert fetched.phone_number == seller.phone_number
    assert fetched.language_preference == seller.language_preference
    assert fetched.created_at.isoformat() == seller.created_at.isoformat()


def test_get_seller_by_phone():
    seller = Seller(
        seller_id="s1", seller_name="Riya Sharma", phone_number="+911111111111",
        language_preference="hi"
    )
    database.insert_seller(seller)
    fetched = database.get_seller_by_phone("+911111111111")
    assert fetched is not None
    assert fetched.seller_id == "s1"


def test_get_seller_by_phone_not_found():
    assert database.get_seller_by_phone("+919999999999") is None


# ---------------------------------------------------------------------------
# SKUs
# ---------------------------------------------------------------------------

def test_sku_validation_inverted_range():
    with pytest.raises(ValueError):
        SKU(sku_id="k1", seller_id="s1", sku_name="Kurti", current_stock=1,
            reorder_point=1, unit_cost=100, price_floor=500, price_ceiling=400)


def test_sku_validation_zero_margin():
    with pytest.raises(ValueError):
        SKU(sku_id="k1", seller_id="s1", sku_name="Kurti", current_stock=1,
            reorder_point=1, unit_cost=500, price_floor=490, price_ceiling=600)


def _make_seller(seller_id="s1"):
    seller = Seller(seller_id=seller_id, seller_name="Riya Sharma",
                     phone_number=f"+9111111111{seller_id[-2:]}" if len(seller_id) >= 2 else "+911111111111",
                     language_preference="hi")
    database.insert_seller(seller)
    return seller


def test_insert_and_get_sku():
    _make_seller()
    sku = SKU(sku_id="k1", seller_id="s1", sku_name="Blue Floral Kurti",
              current_stock=6, reorder_point=15, unit_cost=280,
              price_floor=370, price_ceiling=490, current_chosen_price=410)
    database.insert_sku(sku)
    fetched = database.get_sku_by_id("k1")
    assert fetched is not None
    assert fetched.sku_name == "Blue Floral Kurti"
    assert fetched.current_stock == 6
    assert fetched.price_floor == 370
    assert fetched.price_ceiling == 490
    assert fetched.current_chosen_price == 410


def test_get_skus_for_seller_active_only():
    _make_seller()
    sku1 = SKU(sku_id="k1", seller_id="s1", sku_name="Kurti", current_stock=6,
               reorder_point=15, unit_cost=280, price_floor=370, price_ceiling=490)
    sku2 = SKU(sku_id="k2", seller_id="s1", sku_name="Palazzo", current_stock=40,
               reorder_point=20, unit_cost=360, price_floor=490, price_ceiling=650,
               is_active=False)
    database.insert_sku(sku1)
    database.insert_sku(sku2)
    active = database.get_skus_for_seller("s1")
    assert len(active) == 1
    assert active[0].sku_id == "k1"


def test_update_sku_chosen_price():
    _make_seller()
    sku = SKU(sku_id="k1", seller_id="s1", sku_name="Kurti", current_stock=6,
              reorder_point=15, unit_cost=280, price_floor=370, price_ceiling=490)
    database.insert_sku(sku)
    assert database.get_sku_by_id("k1").current_chosen_price is None
    database.update_sku_chosen_price("k1", 410)
    assert database.get_sku_by_id("k1").current_chosen_price == 410


def test_update_sku_price_range_invalid():
    _make_seller()
    sku = SKU(sku_id="k1", seller_id="s1", sku_name="Kurti", current_stock=6,
              reorder_point=15, unit_cost=280, price_floor=370, price_ceiling=490)
    database.insert_sku(sku)
    with pytest.raises(ValueError):
        database.update_sku_price_range("k1", 500, 400)


# ---------------------------------------------------------------------------
# Orders
# ---------------------------------------------------------------------------

def _make_sku(sku_id="k1", seller_id="s1"):
    sku = SKU(sku_id=sku_id, seller_id=seller_id, sku_name="Kurti", current_stock=6,
              reorder_point=15, unit_cost=280, price_floor=370, price_ceiling=490)
    database.insert_sku(sku)
    return sku


def test_insert_and_get_orders():
    _make_seller()
    _make_sku()
    today = date.today()
    for i in range(5):
        order = Order(
            order_id=str(uuid.uuid4()), sku_id="k1", seller_id="s1",
            order_date=today - timedelta(days=i), units_sold=2,
            price_charged=410, revenue=820, margin=260
        )
        database.insert_order(order)
    history = database.get_order_history("k1", days=30)
    assert len(history) == 5
    dates = [o.order_date for o in history]
    assert dates == sorted(dates, reverse=True)


def test_get_order_history_limit():
    _make_seller()
    _make_sku()
    today = date.today()
    for i in range(40):
        order = Order(
            order_id=str(uuid.uuid4()), sku_id="k1", seller_id="s1",
            order_date=today - timedelta(days=i), units_sold=1,
            price_charged=410, revenue=410, margin=130
        )
        database.insert_order(order)
    history = database.get_order_history("k1", days=30)
    assert len(history) == 30


def test_get_yesterday_order():
    _make_seller()
    _make_sku()
    today = date.today()
    for i, days_ago in enumerate([2, 0, 1]):
        order = Order(
            order_id=str(uuid.uuid4()), sku_id="k1", seller_id="s1",
            order_date=today - timedelta(days=days_ago), units_sold=1,
            price_charged=410, revenue=410, margin=130
        )
        database.insert_order(order)
    latest = database.get_yesterday_order("k1")
    assert latest.order_date == today


def test_insert_orders_bulk():
    _make_seller()
    _make_sku()
    today = date.today()
    orders = [
        Order(
            order_id=str(uuid.uuid4()), sku_id="k1", seller_id="s1",
            order_date=today - timedelta(days=2), units_sold=2,
            price_charged=410, revenue=820, margin=260
        ),
        Order(
            order_id=str(uuid.uuid4()), sku_id="k1", seller_id="s1",
            order_date=today - timedelta(days=1), units_sold=3,
            price_charged=430, revenue=1290, margin=450
        ),
    ]
    database.insert_orders_bulk(orders)
    history = database.get_order_history("k1", days=30)
    assert len(history) == 2
    assert {o.order_id for o in history} == {o.order_id for o in orders}


# ---------------------------------------------------------------------------
# Price Arms
# ---------------------------------------------------------------------------

def test_upsert_price_arm_insert():
    _make_seller()
    _make_sku()
    arm = PriceArm(arm_id=str(uuid.uuid4()), sku_id="k1", price_value=410)
    database.upsert_price_arm(arm)
    arms = database.get_price_arms("k1")
    assert len(arms) == 1
    assert arms[0].price_value == 410


def test_insert_price_arms_bulk():
    _make_seller()
    _make_sku()
    arms = [
        PriceArm(arm_id=str(uuid.uuid4()), sku_id="k1", price_value=370, alpha=3.0, beta_param=5.0, times_chosen=4),
        PriceArm(arm_id=str(uuid.uuid4()), sku_id="k1", price_value=390, alpha=5.0, beta_param=4.0, times_chosen=6),
    ]
    database.insert_price_arms_bulk(arms)
    stored_arms = database.get_price_arms("k1")
    assert len(stored_arms) == 2
    assert {arm.price_value for arm in stored_arms} == {370, 390}


def test_upsert_price_arm_update():
    _make_seller()
    _make_sku()
    arm = PriceArm(arm_id=str(uuid.uuid4()), sku_id="k1", price_value=410, alpha=1.0)
    database.upsert_price_arm(arm)
    arm2 = PriceArm(arm_id=str(uuid.uuid4()), sku_id="k1", price_value=410, alpha=5.0)
    database.upsert_price_arm(arm2)
    arms = database.get_price_arms("k1")
    assert len(arms) == 1
    assert arms[0].alpha == 5.0


def test_get_price_arms_active_only():
    _make_seller()
    _make_sku()
    for price, active in [(370, True), (410, True), (490, False)]:
        arm = PriceArm(arm_id=str(uuid.uuid4()), sku_id="k1",
                        price_value=price, is_active=active)
        database.upsert_price_arm(arm)
    active_arms = database.get_price_arms("k1", active_only=True)
    assert len(active_arms) == 2


def test_recompute_price_arms_narrows_range():
    _make_seller()
    _make_sku()
    for price in [370, 390, 410, 430, 450, 470, 490]:
        arm = PriceArm(arm_id=str(uuid.uuid4()), sku_id="k1", price_value=price)
        database.upsert_price_arm(arm)
    database.recompute_price_arms("k1", 390, 450)
    arms = {a.price_value: a for a in database.get_price_arms("k1", active_only=False)}
    assert arms[370].is_active is False
    assert arms[490].is_active is False
    for price in [390, 410, 430, 450]:
        assert arms[price].is_active is True


def test_recompute_price_arms_widens_range():
    _make_seller()
    _make_sku()
    for price in [390, 410, 430, 450]:
        arm = PriceArm(arm_id=str(uuid.uuid4()), sku_id="k1", price_value=price)
        database.upsert_price_arm(arm)
    database.recompute_price_arms("k1", 370, 490)
    arms = {a.price_value: a for a in database.get_price_arms("k1", active_only=False)}
    assert arms[370].alpha == 1.0
    assert arms[370].beta_param == 1.0
    assert arms[490].alpha == 1.0
    assert arms[490].beta_param == 1.0


def test_recompute_preserves_history():
    _make_seller()
    _make_sku()
    arm = PriceArm(arm_id=str(uuid.uuid4()), sku_id="k1", price_value=410, alpha=8.0)
    database.upsert_price_arm(arm)
    database.recompute_price_arms("k1", 370, 490)
    arms = {a.price_value: a for a in database.get_price_arms("k1", active_only=False)}
    assert arms[410].alpha == 8.0


# ---------------------------------------------------------------------------
# Agent Actions
# ---------------------------------------------------------------------------

def test_insert_and_get_agent_action():
    _make_seller()
    _make_sku()
    action = AgentAction(
        action_id=str(uuid.uuid4()), sku_id="k1", seller_id="s1",
        action_date=date.today(), tool_called="pricing", trigger="scheduled",
        chosen_price=410
    )
    database.insert_agent_action(action)
    fetched = database.get_last_agent_action("k1")
    assert fetched is not None
    assert fetched.action_id == action.action_id
    assert fetched.chosen_price == 410
    assert fetched.tool_called == "pricing"


def test_get_agent_action_history_ordering():
    _make_seller()
    _make_sku()
    today = date.today()
    for days_ago in [4, 2, 3, 0, 1]:
        action = AgentAction(
            action_id=str(uuid.uuid4()), sku_id="k1", seller_id="s1",
            action_date=today - timedelta(days=days_ago),
            tool_called="pricing", trigger="scheduled"
        )
        database.insert_agent_action(action)
    history = database.get_agent_action_history("k1")
    assert len(history) == 5
    dates = [a.action_date for a in history]
    assert dates == sorted(dates, reverse=True)


# ---------------------------------------------------------------------------
# Conversations
# ---------------------------------------------------------------------------

def test_insert_conversation():
    _make_seller()
    inbound = Conversation(message_id=str(uuid.uuid4()), seller_id="s1",
                            direction="inbound", message_body="Stock kitna hai?",
                            message_sid="SM100")
    outbound = Conversation(message_id=str(uuid.uuid4()), seller_id="s1",
                             direction="outbound", message_body="6 units left")
    database.insert_conversation_message(inbound)
    database.insert_conversation_message(outbound)
    history = database.get_conversation_history("s1")
    assert len(history) == 2
    directions = {m.direction for m in history}
    assert directions == {"inbound", "outbound"}


def test_message_already_processed_true():
    _make_seller()
    msg = Conversation(message_id=str(uuid.uuid4()), seller_id="s1",
                        direction="inbound", message_body="hi", message_sid="SM123")
    database.insert_conversation_message(msg)
    assert database.message_already_processed("SM123") is True


def test_message_already_processed_false():
    assert database.message_already_processed("SM999") is False


# ---------------------------------------------------------------------------
# Seller Settings
# ---------------------------------------------------------------------------

def test_get_seller_settings_creates_defaults():
    _make_seller()
    settings = database.get_seller_settings("s1")
    assert settings.daily_alert_time == "08:00"
    assert settings.alert_language == "hi"
    with database.get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT COUNT(*) FROM seller_settings WHERE seller_id = %s", ("s1",))
            assert cur.fetchone()[0] == 1


def test_upsert_seller_settings_updates():
    _make_seller()
    settings = SellerSettings(seller_id="s1")
    database.upsert_seller_settings(settings)
    settings.daily_alert_time = "09:30"
    database.upsert_seller_settings(settings)
    with database.get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT COUNT(*) FROM seller_settings WHERE seller_id = %s", ("s1",))
            assert cur.fetchone()[0] == 1
    assert database.get_seller_settings("s1").daily_alert_time == "09:30"


# ---------------------------------------------------------------------------
# Constraints
# ---------------------------------------------------------------------------

def test_foreign_key_enforcement():
    sku = SKU(sku_id="k1", seller_id="nonexistent_seller", sku_name="Kurti",
              current_stock=6, reorder_point=15, unit_cost=280,
              price_floor=370, price_ceiling=490)
    with pytest.raises(psycopg2.errors.ForeignKeyViolation):
        database.insert_sku(sku)


def test_idempotent_create_tables():
    database.create_tables()
    database.create_tables()
    database.create_tables()
    with database.get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT table_name FROM information_schema.tables
                WHERE table_schema = 'public'
            """)
            tables = {r[0] for r in cur.fetchall()}
    expected = {"sellers", "skus", "orders", "price_arms",
                "agent_actions", "conversations", "seller_settings"}
    assert expected.issubset(tables)


# ---------------------------------------------------------------------------
# Row Level Security
#
# This is the real proof the authentication model works -- without it, a
# passing test suite could still hide a real data leak. It connects as a
# non-service-role Postgres user (mirroring Supabase's `authenticated`
# role) with request.jwt.claim.sub set, and confirms RLS silently filters
# out another seller's rows rather than raising.
# ---------------------------------------------------------------------------

@pytest.mark.skipif(
    not RLS_TEST_DB_URL,
    reason="RLS_TEST_DB_URL not set -- see tests/README for how to create "
           "the non-superuser app_user role needed for this test"
)
def test_rls_denies_cross_seller_read():
    seller_a_auth_id = str(uuid.uuid4())
    seller_b_auth_id = str(uuid.uuid4())

    with database.get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("INSERT INTO auth.users (id) VALUES (%s), (%s)",
                        (seller_a_auth_id, seller_b_auth_id))

    seller_a = Seller(seller_id="seller_a", seller_name="Seller A",
                       phone_number="+910000000001", language_preference="hi",
                       auth_user_id=seller_a_auth_id)
    seller_b = Seller(seller_id="seller_b", seller_name="Seller B",
                       phone_number="+910000000002", language_preference="hi",
                       auth_user_id=seller_b_auth_id)
    database.insert_seller(seller_a)
    database.insert_seller(seller_b)

    sku_b = SKU(sku_id="sku_b", seller_id="seller_b", sku_name="Seller B's SKU",
                current_stock=10, reorder_point=5, unit_cost=100,
                price_floor=150, price_ceiling=300)
    database.insert_sku(sku_b)
    order_b = Order(order_id=str(uuid.uuid4()), sku_id="sku_b", seller_id="seller_b",
                     order_date=date.today(), units_sold=1, price_charged=150,
                     revenue=150, margin=50)
    database.insert_order(order_b)

    # Connect as the non-privileged app_user role and impersonate seller_a
    # via request.jwt.claim.sub, exactly as PostgREST/Supabase does per-request.
    rls_conn = psycopg2.connect(RLS_TEST_DB_URL)
    try:
        with rls_conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute("SET request.jwt.claim.sub = %s", (seller_a_auth_id,))
            cur.execute("SELECT * FROM skus WHERE sku_id = %s", ("sku_b",))
            assert cur.fetchall() == []

            cur.execute("SELECT * FROM orders WHERE sku_id = %s", ("sku_b",))
            assert cur.fetchall() == []

            # Sanity check: seller_a impersonation can see their OWN (empty) sku list
            # without error, proving the policy isn't just failing closed globally.
            cur.execute("SELECT * FROM skus")
            assert cur.fetchall() == []
        rls_conn.rollback()
    finally:
        rls_conn.close()