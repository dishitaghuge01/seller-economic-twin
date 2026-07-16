import os
import sys
import uuid
from datetime import date, datetime, time, timezone
from zoneinfo import ZoneInfo

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

os.environ.setdefault("SUPABASE_DB_URL", os.environ.get("SUPABASE_DB_URL", "postgresql://postgres@localhost:5432/postgres"))
os.environ.setdefault("SUPABASE_JWT_SECRET", "test-secret")
os.environ.setdefault("FRONTEND_URL", "http://localhost:3000")
os.environ.setdefault("TWILIO_ACCOUNT_SID", "test-account")
os.environ.setdefault("TWILIO_AUTH_TOKEN", "test-token")
os.environ.setdefault("TWILIO_WHATSAPP_NUMBER", "whatsapp:+14155238886")
os.environ.setdefault("INTERNAL_API_KEY", "test-internal-key")

import database
import scheduler as scheduler_module
from agent_core import AgentCoreError
from models import AgentAction, Seller, SellerSettings, SKU


@pytest.fixture(autouse=True)
def fresh_db(monkeypatch):
    monkeypatch.setenv("SUPABASE_DB_URL", os.environ.get("SUPABASE_DB_URL", "postgresql://postgres@localhost:5432/postgres"))
    monkeypatch.setenv("SUPABASE_JWT_SECRET", "test-secret")
    monkeypatch.setenv("FRONTEND_URL", "http://localhost:3000")
    monkeypatch.setenv("TWILIO_ACCOUNT_SID", "test-account")
    monkeypatch.setenv("TWILIO_AUTH_TOKEN", "test-token")
    monkeypatch.setenv("TWILIO_WHATSAPP_NUMBER", "whatsapp:+14155238886")
    monkeypatch.setenv("INTERNAL_API_KEY", "test-internal-key")
    database.create_tables()
    database.create_local_auth_stub()
    try:
        database.enable_rls()
    except Exception:
        pass
    with database.get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                TRUNCATE sellers, skus, orders, price_arms, agent_actions,
                         conversations, seller_settings CASCADE
                """
            )
    yield


def _seed_seller(seller_id: str = "s1", sku_ids: list[str] | None = None) -> Seller:
    seller = Seller(
        seller_id=seller_id,
        seller_name="Riya Sharma",
        phone_number=f"+911111111{seller_id[-1]}",
        language_preference="hi",
        auth_user_id=str(uuid.uuid4()),
    )
    database.insert_seller(seller)
    database.upsert_seller_settings(SellerSettings(seller_id=seller.seller_id, daily_alert_time="08:00"))
    if sku_ids is None:
        sku_ids = [f"{seller_id}-sku-1"]
    for sku_id in sku_ids:
        sku = SKU(
            sku_id=sku_id,
            seller_id=seller.seller_id,
            sku_name=f"SKU {sku_id}",
            current_stock=5,
            reorder_point=2,
            unit_cost=100,
            price_floor=120,
            price_ceiling=180,
            current_chosen_price=140,
        )
        database.insert_sku(sku)
    return seller


def test_tick_skips_seller_outside_window(monkeypatch):
    seller = _seed_seller()
    calls = []

    def fake_run_agent_cycle(*args, **kwargs):
        calls.append(args)
        return {"seller_message": "hello", "chosen_price": 140, "stockout_severity": "watch"}

    monkeypatch.setattr(scheduler_module, "run_agent_cycle", fake_run_agent_cycle)
    scheduler_module.run_scheduler_tick_now(now=datetime(2026, 7, 15, 14, 0, tzinfo=ZoneInfo("Asia/Kolkata")))

    assert calls == []


def test_tick_runs_seller_inside_window(monkeypatch):
    seller = _seed_seller(sku_ids=["s1-sku-1", "s1-sku-2"])
    calls = []

    def fake_run_agent_cycle(*args, **kwargs):
        calls.append(args)
        return {"seller_message": "hello", "chosen_price": 140, "stockout_severity": "watch"}

    monkeypatch.setattr(scheduler_module, "run_agent_cycle", fake_run_agent_cycle)
    monkeypatch.setattr(scheduler_module, "send_whatsapp_message", lambda seller_id, message_body: {"status": "sent", "message_sid": "SM1"})

    scheduler_module.run_scheduler_tick_now(now=datetime(2026, 7, 15, 8, 5, tzinfo=ZoneInfo("Asia/Kolkata")))

    assert len(calls) == 2
    assert {call[1] for call in calls} == {"s1-sku-1", "s1-sku-2"}


def test_tick_dedupe_skips_already_run_today(monkeypatch):
    seller = _seed_seller(sku_ids=["s1-sku-1", "s1-sku-2"])
    database.insert_agent_action(
        AgentAction(
            action_id=str(uuid.uuid4()),
            sku_id="s1-sku-1",
            seller_id=seller.seller_id,
            action_date=date.today(),
            tool_called="forecasting",
            trigger="scheduled",
            seller_message="already sent",
            created_at=datetime.now(timezone.utc),
        )
    )
    calls = []

    def fake_run_agent_cycle(*args, **kwargs):
        calls.append(args)
        return {"seller_message": "hello", "chosen_price": 140, "stockout_severity": "watch"}

    monkeypatch.setattr(scheduler_module, "run_agent_cycle", fake_run_agent_cycle)
    monkeypatch.setattr(scheduler_module, "send_whatsapp_message", lambda seller_id, message_body: {"status": "sent", "message_sid": "SM1"})

    scheduler_module.run_scheduler_tick_now(now=datetime(2026, 7, 15, 8, 5, tzinfo=ZoneInfo("Asia/Kolkata")))

    assert len(calls) == 1
    assert calls[0][1] == "s1-sku-2"


def test_tick_continues_after_one_seller_fails(monkeypatch):
    seller_1 = _seed_seller(seller_id="s1", sku_ids=["s1-sku-1"])
    seller_2 = _seed_seller(seller_id="s2", sku_ids=["s2-sku-1"])
    calls = []

    def fake_run_agent_cycle(seller_id, sku_id, trigger, message_text=None):
        if seller_id == seller_1.seller_id:
            raise AgentCoreError("boom")
        calls.append((seller_id, sku_id))
        return {"seller_message": "hello", "chosen_price": 140, "stockout_severity": "watch"}

    monkeypatch.setattr(scheduler_module, "run_agent_cycle", fake_run_agent_cycle)
    monkeypatch.setattr(scheduler_module, "send_whatsapp_message", lambda seller_id, message_body: {"status": "sent", "message_sid": "SM1"})

    scheduler_module.run_scheduler_tick_now(now=datetime(2026, 7, 15, 8, 5, tzinfo=ZoneInfo("Asia/Kolkata")))

    assert calls == [(seller_2.seller_id, "s2-sku-1")]


def test_tick_calls_send_whatsapp_message_with_correct_args(monkeypatch):
    seller = _seed_seller()
    sent = []

    def fake_run_agent_cycle(*args, **kwargs):
        return {"seller_message": "hello-from-agent", "chosen_price": 140, "stockout_severity": "watch"}

    def fake_send(seller_id, message_body):
        sent.append((seller_id, message_body))
        return {"status": "sent", "message_sid": "SM1"}

    monkeypatch.setattr(scheduler_module, "run_agent_cycle", fake_run_agent_cycle)
    monkeypatch.setattr(scheduler_module, "send_whatsapp_message", fake_send)

    scheduler_module.run_scheduler_tick_now(now=datetime(2026, 7, 15, 8, 5, tzinfo=ZoneInfo("Asia/Kolkata")))

    assert sent == [(seller.seller_id, "hello-from-agent")]


def test_tick_handles_send_failure_gracefully(monkeypatch, caplog):
    seller = _seed_seller()

    def fake_run_agent_cycle(*args, **kwargs):
        return {"seller_message": "hello", "chosen_price": 140, "stockout_severity": "watch"}

    def fake_send(seller_id, message_body):
        return {"status": "skipped", "reason": "outside 24h window"}

    monkeypatch.setattr(scheduler_module, "run_agent_cycle", fake_run_agent_cycle)
    monkeypatch.setattr(scheduler_module, "send_whatsapp_message", fake_send)

    scheduler_module.run_scheduler_tick_now(now=datetime(2026, 7, 15, 8, 5, tzinfo=ZoneInfo("Asia/Kolkata")))

    assert "outside 24h window" in caplog.text
