"""
database.py

Connection management, table creation, and every query the rest of the
system needs, each as a named function. No raw SQL strings appear
anywhere outside this file.

Backed by Supabase (hosted Postgres). Connects via psycopg2 using a
pooled connection sourced from SUPABASE_DB_URL (the Postgres connection
string from the Supabase project's Database settings -> Connection
string -> URI). Use the "Connection pooling" string (port 6543) rather
than the direct connection (port 5432) when deploying to a
serverless/autoscaling environment.
"""

import os
import uuid
from contextlib import contextmanager
from datetime import datetime, date, timezone
from typing import Optional, List, Dict, Any

import psycopg2
import psycopg2.extras
from psycopg2.pool import SimpleConnectionPool

from models import Seller, SKU, Order, PriceArm, AgentAction, Conversation, SellerSettings

DATABASE_URL = os.environ["SUPABASE_DB_URL"]

_pool = SimpleConnectionPool(minconn=1, maxconn=10, dsn=DATABASE_URL)


def _normalize_datetime(value: Any) -> Any:
    if isinstance(value, datetime):
        if value.tzinfo is None:
            return value.replace(tzinfo=timezone.utc)
        return value.astimezone(timezone.utc)
    return value


@contextmanager
def get_connection():
    """
    Context manager for pooled Postgres connections via psycopg2.
    Commits on clean exit, rolls back on exception.
    Always returns the connection to the pool, never leaves one checked out.

    Usage:
        with get_connection() as conn:
            with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                cur.execute("SELECT ...")
    """
    conn = _pool.getconn()
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        _pool.putconn(conn)


@contextmanager
def get_cursor(conn):
    """
    Convenience wrapper: every query function below opens a RealDictCursor
    so rows come back as dict-like objects (mirrors the sqlite3.Row
    behaviour the original design was written against).
    """
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        yield cur


# ---------------------------------------------------------------------------
# Table Creation
# ---------------------------------------------------------------------------

CREATE_TABLES_SQL = """
    CREATE TABLE IF NOT EXISTS sellers (
        seller_id           TEXT PRIMARY KEY,
        seller_name         TEXT NOT NULL,
        phone_number        TEXT NOT NULL UNIQUE,
        language_preference TEXT NOT NULL DEFAULT 'hi',
        auth_user_id        UUID REFERENCES auth.users(id),
        created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS skus (
        sku_id                  TEXT PRIMARY KEY,
        seller_id               TEXT NOT NULL REFERENCES sellers(seller_id),
        sku_name                TEXT NOT NULL,
        current_stock           INTEGER NOT NULL,
        reorder_point            INTEGER NOT NULL,
        unit_cost               INTEGER NOT NULL,
        price_floor             INTEGER NOT NULL,
        price_ceiling           INTEGER NOT NULL,
        current_chosen_price    INTEGER,
        is_active               BOOLEAN NOT NULL DEFAULT TRUE,
        created_at              TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS orders (
        order_id        TEXT PRIMARY KEY,
        sku_id          TEXT NOT NULL REFERENCES skus(sku_id),
        seller_id       TEXT NOT NULL REFERENCES sellers(seller_id),
        order_date      DATE NOT NULL,
        units_sold      INTEGER NOT NULL,
        price_charged   INTEGER NOT NULL,
        revenue         INTEGER NOT NULL,
        margin          INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS price_arms (
        arm_id          TEXT PRIMARY KEY,
        sku_id          TEXT NOT NULL REFERENCES skus(sku_id),
        price_value     INTEGER NOT NULL,
        alpha           REAL NOT NULL DEFAULT 1.0,
        beta_param      REAL NOT NULL DEFAULT 1.0,
        times_chosen    INTEGER NOT NULL DEFAULT 0,
        is_active       BOOLEAN NOT NULL DEFAULT TRUE,
        last_updated    TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE(sku_id, price_value)
    );

    CREATE TABLE IF NOT EXISTS agent_actions (
        action_id                   TEXT PRIMARY KEY,
        sku_id                      TEXT NOT NULL REFERENCES skus(sku_id),
        seller_id                   TEXT NOT NULL REFERENCES sellers(seller_id),
        action_date                 DATE NOT NULL,
        tool_called                 TEXT NOT NULL,
        trigger                     TEXT NOT NULL,
        chosen_price                INTEGER,
        stockout_probability_5d     REAL,
        stockout_probability_10d    REAL,
        stockout_severity           TEXT,
        seller_message              TEXT,
        reasoning_trace             TEXT,
        delivered_via               TEXT,
        created_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS conversations (
        message_id      TEXT PRIMARY KEY,
        seller_id       TEXT NOT NULL REFERENCES sellers(seller_id),
        direction       TEXT NOT NULL,
        message_body    TEXT NOT NULL,
        message_sid     TEXT,
        created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS seller_settings (
        seller_id               TEXT PRIMARY KEY REFERENCES sellers(seller_id),
        daily_alert_time        TEXT NOT NULL DEFAULT '08:00',
        alert_language           TEXT NOT NULL DEFAULT 'hi',
        notify_on_price_change  BOOLEAN NOT NULL DEFAULT TRUE,
        notify_on_stockout_risk BOOLEAN NOT NULL DEFAULT TRUE,
        price_change_threshold  REAL NOT NULL DEFAULT 0.05,
        updated_at               TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE INDEX IF NOT EXISTS idx_orders_sku_date
        ON orders(sku_id, order_date DESC);

    CREATE INDEX IF NOT EXISTS idx_price_arms_sku
        ON price_arms(sku_id, is_active);

    CREATE INDEX IF NOT EXISTS idx_agent_actions_sku
        ON agent_actions(sku_id, action_date DESC);

    CREATE INDEX IF NOT EXISTS idx_conversations_seller
        ON conversations(seller_id, created_at DESC);
"""


def create_tables() -> None:
    """
    Create the application's own tables if they do not already exist.
    Safe to call on every application startup -- idempotent.

    This function must never attempt to create or modify Supabase's native
    auth.users table; production deployments should rely on Supabase's
    built-in auth schema. Local-only test fixtures should call
    create_local_auth_stub() explicitly when they need the auth.users stub.
    """
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(CREATE_TABLES_SQL)


def create_local_auth_stub() -> None:
    """
    Creates a minimal stand-in for Supabase's auth.users table, needed only
    when running against a plain local/test Postgres instance that does not
    have Supabase's built-in auth schema (e.g. local dev, CI, or a bare
    supabase start alternative).

    NEVER call this against a real Supabase-hosted database -- auth.users
    already exists there, is owned by Supabase's internal auth service, and
    the application's database role does not have permission to modify it.
    Calling this against real Supabase will raise
    psycopg2.errors.InsufficientPrivilege, which is the correct behavior.
    """
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                CREATE SCHEMA IF NOT EXISTS auth;
                CREATE TABLE IF NOT EXISTS auth.users (
                    id UUID PRIMARY KEY
                );
            """)


# ---------------------------------------------------------------------------
# Row Level Security
#
# Every table has RLS enabled, with policies scoping access to the
# requesting user's own data via sellers.auth_user_id. This is the real
# authentication/authorization layer -- without it, the Supabase anon key
# (which the frontend legitimately needs for login) could read or write
# any seller's rows.
#
# This is run once against the real Supabase project (via the SQL editor
# in the dashboard, or by executing ENABLE_RLS_SQL below from a local
# script) -- it is not something psycopg2 needs to run on every app
# startup the way create_tables() does, but enable_rls() is provided here
# for convenience / for use against local test stacks.
#
# All backend-only operations (the scheduler, seed_data.py, any Agent Core
# cycle not triggered by a live user session) connect using the Supabase
# service role key, which bypasses RLS entirely by design -- that is the
# intended mechanism for privileged backend writes, not a workaround.
# ---------------------------------------------------------------------------

ENABLE_RLS_SQL = """
    ALTER TABLE sellers ENABLE ROW LEVEL SECURITY;
    ALTER TABLE skus ENABLE ROW LEVEL SECURITY;
    ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
    ALTER TABLE price_arms ENABLE ROW LEVEL SECURITY;
    ALTER TABLE agent_actions ENABLE ROW LEVEL SECURITY;
    ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
    ALTER TABLE seller_settings ENABLE ROW LEVEL SECURITY;

    -- sellers: a seller can only see their own row
    DROP POLICY IF EXISTS seller_self_access ON sellers;
    CREATE POLICY seller_self_access ON sellers
        FOR ALL USING (auth_user_id = auth.uid());

    -- skus, orders, price_arms, agent_actions, conversations,
    -- seller_settings: all scoped through a join back to
    -- sellers.auth_user_id, since none of these tables carry
    -- auth_user_id directly.
    DROP POLICY IF EXISTS sku_owner_access ON skus;
    CREATE POLICY sku_owner_access ON skus
        FOR ALL USING (
            seller_id IN (
                SELECT seller_id FROM sellers WHERE auth_user_id = auth.uid()
            )
        );

    DROP POLICY IF EXISTS order_owner_access ON orders;
    CREATE POLICY order_owner_access ON orders
        FOR ALL USING (
            seller_id IN (
                SELECT seller_id FROM sellers WHERE auth_user_id = auth.uid()
            )
        );

    DROP POLICY IF EXISTS price_arm_owner_access ON price_arms;
    CREATE POLICY price_arm_owner_access ON price_arms
        FOR ALL USING (
            sku_id IN (
                SELECT sku_id FROM skus WHERE seller_id IN (
                    SELECT seller_id FROM sellers WHERE auth_user_id = auth.uid()
                )
            )
        );

    DROP POLICY IF EXISTS agent_action_owner_access ON agent_actions;
    CREATE POLICY agent_action_owner_access ON agent_actions
        FOR ALL USING (
            seller_id IN (
                SELECT seller_id FROM sellers WHERE auth_user_id = auth.uid()
            )
        );

    DROP POLICY IF EXISTS conversation_owner_access ON conversations;
    CREATE POLICY conversation_owner_access ON conversations
        FOR ALL USING (
            seller_id IN (
                SELECT seller_id FROM sellers WHERE auth_user_id = auth.uid()
            )
        );

    DROP POLICY IF EXISTS seller_settings_owner_access ON seller_settings;
    CREATE POLICY seller_settings_owner_access ON seller_settings
        FOR ALL USING (
            seller_id IN (
                SELECT seller_id FROM sellers WHERE auth_user_id = auth.uid()
            )
        );
"""


def enable_rls() -> None:
    """
    Enables RLS and (re)creates all ownership policies. Idempotent via
    DROP POLICY IF EXISTS before each CREATE POLICY. Run once against the
    real Supabase project, and against any local/test stack used by
    test_rls_denies_cross_seller_read.
    """
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(ENABLE_RLS_SQL)


# ---------------------------------------------------------------------------
# Query Helper Functions -- Sellers
# ---------------------------------------------------------------------------

def insert_seller(seller: Seller) -> None:
    with get_connection() as conn:
        with get_cursor(conn) as cur:
            if seller.auth_user_id:
                cur.execute(
                    "INSERT INTO auth.users (id) VALUES (%s) ON CONFLICT (id) DO NOTHING",
                    (seller.auth_user_id,)
                )
            cur.execute(
                """INSERT INTO sellers
                   (seller_id, seller_name, phone_number, language_preference,
                    auth_user_id, created_at)
                   VALUES (%s,%s,%s,%s,%s,%s)""",
                (seller.seller_id, seller.seller_name, seller.phone_number,
                 seller.language_preference, seller.auth_user_id, seller.created_at)
            )


def get_seller_by_id(seller_id: str) -> Optional[Seller]:
    with get_connection() as conn:
        with get_cursor(conn) as cur:
            cur.execute("SELECT * FROM sellers WHERE seller_id = %s", (seller_id,))
            row = cur.fetchone()
    return _row_to_seller(row) if row else None


def get_seller_by_phone(phone_number: str) -> Optional[Seller]:
    """Used by the Twilio webhook handler to look up seller from incoming number."""
    with get_connection() as conn:
        with get_cursor(conn) as cur:
            cur.execute("SELECT * FROM sellers WHERE phone_number = %s", (phone_number,))
            row = cur.fetchone()
    return _row_to_seller(row) if row else None


def get_seller_by_auth_user_id(auth_user_id: str) -> Optional[Seller]:
    """Used by the FastAPI auth dependency to resolve a seller from a JWT subject."""
    with get_connection() as conn:
        with get_cursor(conn) as cur:
            cur.execute("SELECT * FROM sellers WHERE auth_user_id = %s", (auth_user_id,))
            row = cur.fetchone()
    return _row_to_seller(row) if row else None


def get_all_active_sellers() -> List[Seller]:
    """Used by the scheduler to iterate over all sellers for the daily cycle."""
    with get_connection() as conn:
        with get_cursor(conn) as cur:
            cur.execute("SELECT * FROM sellers")
            rows = cur.fetchall()
    return [_row_to_seller(r) for r in rows]


def _row_to_seller(row: Dict[str, Any]) -> Seller:
    return Seller(
        seller_id=row["seller_id"],
        seller_name=row["seller_name"],
        phone_number=row["phone_number"],
        language_preference=row["language_preference"],
        auth_user_id=row["auth_user_id"],
        created_at=_normalize_datetime(row["created_at"])
    )


# ---------------------------------------------------------------------------
# Query Helper Functions -- SKUs
# ---------------------------------------------------------------------------

def insert_sku(sku: SKU) -> None:
    with get_connection() as conn:
        with get_cursor(conn) as cur:
            cur.execute(
                """INSERT INTO skus
                   (sku_id, seller_id, sku_name, current_stock, reorder_point,
                    unit_cost, price_floor, price_ceiling, current_chosen_price,
                    is_active, created_at)
                   VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
                (sku.sku_id, sku.seller_id, sku.sku_name, sku.current_stock,
                 sku.reorder_point, sku.unit_cost, sku.price_floor, sku.price_ceiling,
                 sku.current_chosen_price, sku.is_active, sku.created_at)
            )


def get_skus_for_seller(seller_id: str) -> List[SKU]:
    with get_connection() as conn:
        with get_cursor(conn) as cur:
            cur.execute(
                "SELECT * FROM skus WHERE seller_id = %s AND is_active = TRUE",
                (seller_id,)
            )
            rows = cur.fetchall()
    return [_row_to_sku(r) for r in rows]


def get_sku_by_id(sku_id: str) -> Optional[SKU]:
    with get_connection() as conn:
        with get_cursor(conn) as cur:
            cur.execute("SELECT * FROM skus WHERE sku_id = %s", (sku_id,))
            row = cur.fetchone()
    return _row_to_sku(row) if row else None


def update_sku_stock(sku_id: str, new_stock: int) -> None:
    with get_connection() as conn:
        with get_cursor(conn) as cur:
            cur.execute(
                "UPDATE skus SET current_stock = %s WHERE sku_id = %s",
                (new_stock, sku_id)
            )


def update_sku_chosen_price(sku_id: str, price: int) -> None:
    """Called by Agent Core after each pricing cycle."""
    with get_connection() as conn:
        with get_cursor(conn) as cur:
            cur.execute(
                "UPDATE skus SET current_chosen_price = %s WHERE sku_id = %s",
                (price, sku_id)
            )


def update_sku_price_range(sku_id: str, new_floor: int, new_ceiling: int) -> None:
    """
    Updates floor and ceiling. Called from the settings endpoint.
    Does NOT recompute price arms -- that is handled by recompute_price_arms().
    """
    if new_floor >= new_ceiling:
        raise ValueError("price_floor must be less than price_ceiling")
    with get_connection() as conn:
        with get_cursor(conn) as cur:
            cur.execute(
                "UPDATE skus SET price_floor = %s, price_ceiling = %s WHERE sku_id = %s",
                (new_floor, new_ceiling, sku_id)
            )


def _row_to_sku(row: Dict[str, Any]) -> SKU:
    return SKU(
        sku_id=row["sku_id"], seller_id=row["seller_id"], sku_name=row["sku_name"],
        current_stock=row["current_stock"], reorder_point=row["reorder_point"],
        unit_cost=row["unit_cost"], price_floor=row["price_floor"],
        price_ceiling=row["price_ceiling"],
        current_chosen_price=row["current_chosen_price"],
        is_active=bool(row["is_active"]),
        created_at=_normalize_datetime(row["created_at"])
    )


# ---------------------------------------------------------------------------
# Query Helper Functions -- Orders
# ---------------------------------------------------------------------------

def insert_order(order: Order) -> None:
    with get_connection() as conn:
        with get_cursor(conn) as cur:
            cur.execute(
                """INSERT INTO orders
                   (order_id, sku_id, seller_id, order_date,
                    units_sold, price_charged, revenue, margin)
                   VALUES (%s,%s,%s,%s,%s,%s,%s,%s)""",
                (order.order_id, order.sku_id, order.seller_id, order.order_date,
                 order.units_sold, order.price_charged, order.revenue, order.margin)
            )


def get_order_history(sku_id: str, days: int = 30) -> List[Order]:
    """
    Returns the last `days` days of orders for a SKU, newest first.
    This is the primary data source for both statistical tools.
    """
    with get_connection() as conn:
        with get_cursor(conn) as cur:
            cur.execute(
                """SELECT * FROM orders
                   WHERE sku_id = %s
                   ORDER BY order_date DESC
                   LIMIT %s""",
                (sku_id, days)
            )
            rows = cur.fetchall()
    return [_row_to_order(r) for r in rows]


def get_yesterday_order(sku_id: str) -> Optional[Order]:
    """
    Returns the single most recent order record for a SKU, if it exists.
    Used by the Pricing Tool to classify yesterday's outcome.
    """
    with get_connection() as conn:
        with get_cursor(conn) as cur:
            cur.execute(
                """SELECT * FROM orders
                   WHERE sku_id = %s
                   ORDER BY order_date DESC
                   LIMIT 1""",
                (sku_id,)
            )
            row = cur.fetchone()
    return _row_to_order(row) if row else None


def _row_to_order(row: Dict[str, Any]) -> Order:
    return Order(
        order_id=row["order_id"], sku_id=row["sku_id"], seller_id=row["seller_id"],
        order_date=row["order_date"],
        units_sold=row["units_sold"], price_charged=row["price_charged"],
        revenue=row["revenue"], margin=row["margin"]
    )


# ---------------------------------------------------------------------------
# Query Helper Functions -- Price Arms
# ---------------------------------------------------------------------------

def get_price_arms(sku_id: str, active_only: bool = True) -> List[PriceArm]:
    query = "SELECT * FROM price_arms WHERE sku_id = %s"
    params: List[Any] = [sku_id]
    if active_only:
        query += " AND is_active = TRUE"
    query += " ORDER BY price_value ASC"
    with get_connection() as conn:
        with get_cursor(conn) as cur:
            cur.execute(query, params)
            rows = cur.fetchall()
    return [_row_to_arm(r) for r in rows]


def upsert_price_arm(arm: PriceArm) -> None:
    """
    Insert or update a price arm, keyed on the (sku_id, price_value)
    UNIQUE constraint. Called by Agent Core after each pricing cycle
    with the updated_arms list.
    """
    with get_connection() as conn:
        with get_cursor(conn) as cur:
            cur.execute(
                """INSERT INTO price_arms
                   (arm_id, sku_id, price_value, alpha, beta_param,
                    times_chosen, is_active, last_updated)
                   VALUES (%s,%s,%s,%s,%s,%s,%s,%s)
                   ON CONFLICT (sku_id, price_value) DO UPDATE SET
                       alpha=EXCLUDED.alpha,
                       beta_param=EXCLUDED.beta_param,
                       times_chosen=EXCLUDED.times_chosen,
                       is_active=EXCLUDED.is_active,
                       last_updated=EXCLUDED.last_updated""",
                (arm.arm_id, arm.sku_id, arm.price_value, arm.alpha, arm.beta_param,
                 arm.times_chosen, arm.is_active, arm.last_updated)
            )


def recompute_price_arms(sku_id: str, new_floor: int, new_ceiling: int) -> None:
    """
    Called when seller changes their price floor or ceiling. This is the
    *only* function permitted to reconcile the arm grid.
    - Deactivates arms outside the new range (preserves history)
    - Reactivates arms that were previously deactivated but are now in range
    - Creates new arms for prices not previously seen
    All new arms start with Beta(1,1) prior.
    """
    new_arm_values = list(range(new_floor, new_ceiling + 1, 20))
    existing_arms = get_price_arms(sku_id, active_only=False)
    existing_values = {a.price_value: a for a in existing_arms}

    now = datetime.now(timezone.utc)
    with get_connection() as conn:
        with get_cursor(conn) as cur:
            # Deactivate arms outside new range
            # Build a dynamic-length NOT IN (...) clause with %s placeholders
            placeholders = ",".join(["%s"] * len(new_arm_values))
            cur.execute(
                f"""UPDATE price_arms SET is_active = FALSE, last_updated = %s
                   WHERE sku_id = %s AND price_value NOT IN ({placeholders})""",
                ([now, sku_id] + new_arm_values)
            )
            # Reactivate or create arms within new range
            for price_val in sorted(new_arm_values):
                if price_val in existing_values:
                    cur.execute(
                        """UPDATE price_arms SET is_active = TRUE, last_updated = %s
                           WHERE sku_id = %s AND price_value = %s""",
                        (now, sku_id, price_val)
                    )
                else:
                    cur.execute(
                        """INSERT INTO price_arms
                           (arm_id, sku_id, price_value, alpha, beta_param,
                            times_chosen, is_active, last_updated)
                           VALUES (%s,%s,%s,1.0,1.0,0,TRUE,%s)""",
                        (str(uuid.uuid4()), sku_id, price_val, now)
                    )


def _row_to_arm(row: Dict[str, Any]) -> PriceArm:
    return PriceArm(
        arm_id=row["arm_id"], sku_id=row["sku_id"],
        price_value=row["price_value"], alpha=row["alpha"],
        beta_param=row["beta_param"], times_chosen=row["times_chosen"],
        is_active=bool(row["is_active"]),
        last_updated=_normalize_datetime(row["last_updated"])
    )


# ---------------------------------------------------------------------------
# Query Helper Functions -- Agent Actions
# ---------------------------------------------------------------------------

def insert_agent_action(action: AgentAction) -> None:
    with get_connection() as conn:
        with get_cursor(conn) as cur:
            cur.execute(
                """INSERT INTO agent_actions
                   (action_id, sku_id, seller_id, action_date, tool_called,
                    trigger, chosen_price, stockout_probability_5d,
                    stockout_probability_10d, stockout_severity, seller_message,
                    reasoning_trace, delivered_via, created_at)
                   VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
                (action.action_id, action.sku_id, action.seller_id,
                 action.action_date, action.tool_called, action.trigger,
                 action.chosen_price, action.stockout_probability_5d,
                 action.stockout_probability_10d, action.stockout_severity,
                 action.seller_message, action.reasoning_trace, action.delivered_via,
                 action.created_at)
            )


def get_agent_action_history(sku_id: str, limit: int = 30) -> List[AgentAction]:
    """Returns the last `limit` agent actions for a SKU, newest first."""
    with get_connection() as conn:
        with get_cursor(conn) as cur:
            cur.execute(
                """SELECT * FROM agent_actions
                   WHERE sku_id = %s
                   ORDER BY action_date DESC, created_at DESC
                   LIMIT %s""",
                (sku_id, limit)
            )
            rows = cur.fetchall()
    return [_row_to_action(r) for r in rows]


def get_last_agent_action(sku_id: str) -> Optional[AgentAction]:
    """Returns the single most recent agent action for a SKU."""
    with get_connection() as conn:
        with get_cursor(conn) as cur:
            cur.execute(
                """SELECT * FROM agent_actions
                   WHERE sku_id = %s
                   ORDER BY created_at DESC
                   LIMIT 1""",
                (sku_id,)
            )
            row = cur.fetchone()
    return _row_to_action(row) if row else None


def _row_to_action(row: Dict[str, Any]) -> AgentAction:
    return AgentAction(
        action_id=row["action_id"], sku_id=row["sku_id"],
        seller_id=row["seller_id"],
        action_date=row["action_date"],
        tool_called=row["tool_called"], trigger=row["trigger"],
        chosen_price=row["chosen_price"],
        stockout_probability_5d=row["stockout_probability_5d"],
        stockout_probability_10d=row["stockout_probability_10d"],
        stockout_severity=row["stockout_severity"],
        seller_message=row["seller_message"],
        reasoning_trace=row["reasoning_trace"],
        delivered_via=row["delivered_via"],
        created_at=_normalize_datetime(row["created_at"])
    )


# ---------------------------------------------------------------------------
# Query Helper Functions -- Conversations
# ---------------------------------------------------------------------------

def insert_conversation_message(msg: Conversation) -> None:
    with get_connection() as conn:
        with get_cursor(conn) as cur:
            cur.execute(
                """INSERT INTO conversations
                   (message_id, seller_id, direction, message_body, message_sid, created_at)
                   VALUES (%s,%s,%s,%s,%s,%s)""",
                (msg.message_id, msg.seller_id, msg.direction, msg.message_body,
                 msg.message_sid, msg.created_at)
            )


def get_conversation_history(seller_id: str, limit: int = 20) -> List[Conversation]:
    """Returns last `limit` messages, newest first."""
    with get_connection() as conn:
        with get_cursor(conn) as cur:
            cur.execute(
                """SELECT * FROM conversations
                   WHERE seller_id = %s
                   ORDER BY created_at DESC
                   LIMIT %s""",
                (seller_id, limit)
            )
            rows = cur.fetchall()
    return [_row_to_conversation(r) for r in rows]


def message_already_processed(message_sid: str) -> bool:
    """
    Idempotency check for the Twilio webhook. Twilio retries on timeout,
    so we must not process the same inbound message twice.
    Returns True if this message_sid already exists in conversations.
    """
    with get_connection() as conn:
        with get_cursor(conn) as cur:
            cur.execute(
                "SELECT 1 FROM conversations WHERE message_sid = %s", (message_sid,)
            )
            row = cur.fetchone()
    return row is not None


def _row_to_conversation(row: Dict[str, Any]) -> Conversation:
    return Conversation(
        message_id=row["message_id"], seller_id=row["seller_id"],
        direction=row["direction"], message_body=row["message_body"],
        message_sid=row["message_sid"],
        created_at=_normalize_datetime(row["created_at"])
    )


# ---------------------------------------------------------------------------
# Query Helper Functions -- Seller Settings
# ---------------------------------------------------------------------------

def get_seller_settings(seller_id: str) -> SellerSettings:
    """
    Returns settings for a seller. If no row exists (new seller),
    creates and returns default settings. Never returns None.
    """
    with get_connection() as conn:
        with get_cursor(conn) as cur:
            cur.execute(
                "SELECT * FROM seller_settings WHERE seller_id = %s", (seller_id,)
            )
            row = cur.fetchone()
    if row is None:
        defaults = SellerSettings(seller_id=seller_id)
        upsert_seller_settings(defaults)
        return defaults
    return _row_to_settings(row)


def upsert_seller_settings(settings: SellerSettings) -> None:
    with get_connection() as conn:
        with get_cursor(conn) as cur:
            cur.execute(
                """INSERT INTO seller_settings
                   (seller_id, daily_alert_time, alert_language,
                    notify_on_price_change, notify_on_stockout_risk,
                    price_change_threshold, updated_at)
                   VALUES (%s,%s,%s,%s,%s,%s,%s)
                   ON CONFLICT (seller_id) DO UPDATE SET
                       daily_alert_time=EXCLUDED.daily_alert_time,
                       alert_language=EXCLUDED.alert_language,
                       notify_on_price_change=EXCLUDED.notify_on_price_change,
                       notify_on_stockout_risk=EXCLUDED.notify_on_stockout_risk,
                       price_change_threshold=EXCLUDED.price_change_threshold,
                       updated_at=EXCLUDED.updated_at""",
                (settings.seller_id, settings.daily_alert_time, settings.alert_language,
                 settings.notify_on_price_change, settings.notify_on_stockout_risk,
                 settings.price_change_threshold, datetime.now(timezone.utc))
            )


def _row_to_settings(row: Dict[str, Any]) -> SellerSettings:
    return SellerSettings(
        seller_id=row["seller_id"],
        daily_alert_time=row["daily_alert_time"],
        alert_language=row["alert_language"],
        notify_on_price_change=bool(row["notify_on_price_change"]),
        notify_on_stockout_risk=bool(row["notify_on_stockout_risk"]),
        price_change_threshold=row["price_change_threshold"],
        updated_at=row["updated_at"]
    )


# ---------------------------------------------------------------------------
# Seller State Contract
#
# The dict that gets passed to the statistical tools (Component A) is
# built entirely from the functions in this module. Called by Agent Core.
# ---------------------------------------------------------------------------

def build_seller_state(seller_id: str, sku_id: str) -> Dict[str, Any]:
    """
    Assembles the full seller/SKU state dict from existing query
    functions. This is the data contract handed to the statistical
    tools (forecasting + pricing) in Component A -- everything they
    need must be derivable from this module alone.
    """
    seller = get_seller_by_id(seller_id)
    sku = get_sku_by_id(sku_id)
    order_history = get_order_history(sku_id, days=30)
    yesterday = get_yesterday_order(sku_id)
    price_arms = get_price_arms(sku_id, active_only=True)
    settings = get_seller_settings(seller_id)

    seller_state = {
        "seller_id": sku.seller_id if sku else seller_id,
        "sku_id": sku_id,
        "sku_name": sku.sku_name if sku else None,
        "current_stock": sku.current_stock if sku else None,
        "reorder_point": sku.reorder_point if sku else None,
        "unit_cost": sku.unit_cost if sku else None,
        "price_floor": sku.price_floor if sku else None,
        "price_ceiling": sku.price_ceiling if sku else None,
        "order_history": [
            {
                "date": o.order_date.isoformat(),
                "units_sold": o.units_sold,
                "price_charged": o.price_charged,
                "margin": o.margin
            }
            for o in order_history
        ],
        "price_arms": [
            {
                "price_value": a.price_value,
                "alpha": a.alpha,
                "beta_param": a.beta_param,
                "times_chosen": a.times_chosen
            }
            for a in price_arms
        ],
        "yesterday_price": (yesterday.price_charged if yesterday else None),
        "yesterday_units_sold": (yesterday.units_sold if yesterday else None),
        "yesterday_margin": (yesterday.margin if yesterday else None),
        "language_preference": seller.language_preference if seller else None,
    }

    return seller_state