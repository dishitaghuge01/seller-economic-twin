import asyncio
import os
import sys
from types import SimpleNamespace

BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, BACKEND_DIR)

os.environ.setdefault("SUPABASE_DB_URL", "postgresql://postgres@localhost:5432/seller_economic_twin_test")
os.environ.setdefault("DEMO_SELLER_ID", "demo_seller")
os.environ.setdefault("DEMO_LOGIN_ENABLED", "true")

import demo


def test_demo_step_runs_both_arcs_and_preserves_order(monkeypatch):
    monkeypatch.setattr(demo, "_check_demo_access", lambda seller_id: None)
    monkeypatch.setattr(
        demo.database,
        "get_demo_state",
        lambda seller_id, conn=None: demo.DemoState(
            seller_id="demo_seller",
            current_day=0,
            max_days=6,
            shock_sku_id="shock-sku",
            depletion_sku_id="depletion-sku",
            shock_triggered=False,
        ),
    )
    monkeypatch.setattr(
        demo.database,
        "get_sku_by_id",
        lambda sku_id, conn=None: SimpleNamespace(current_stock=10, current_chosen_price=100, price_floor=80, unit_cost=60),
    )
    monkeypatch.setattr(demo.database, "update_sku_stock", lambda sku_id, new_stock, conn=None: None)
    monkeypatch.setattr(demo.database, "get_order_history", lambda sku_id, days=30, conn=None: [])
    monkeypatch.setattr(demo.database, "insert_order", lambda order, conn=None: None)
    monkeypatch.setattr(demo.database, "upsert_demo_state", lambda state, conn=None: None)
    monkeypatch.setattr(demo, "_get_sku_snapshot", lambda sku_id, conn=None: {"sku_id": sku_id})

    def fake_run_agent_cycle(seller_id, sku_id, trigger):
        return {
            "seller_message": f"message for {sku_id}",
            "reasoning_trace": f"trace for {sku_id}",
            "notification_suppressed": False,
        }

    monkeypatch.setattr(demo, "run_agent_cycle", fake_run_agent_cycle)
    monkeypatch.setattr(demo, "send_whatsapp_message", lambda seller_id, message: {"status": "sent"})

    response = asyncio.run(demo.demo_step("demo_seller", current_seller=SimpleNamespace(seller_id="demo_seller")))

    assert [message.sku_id for message in response.agent_messages] == ["depletion-sku", "shock-sku"]
    assert [notification.sku_id for notification in response.notifications] == ["depletion-sku", "shock-sku"]
    assert response.day == 1
    assert response.shock_event_triggered_today is False
