import os
import sys
import uuid
from datetime import date, datetime, timedelta, timezone

import jwt
import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

os.environ.setdefault("SUPABASE_DB_URL", os.environ.get("SUPABASE_DB_URL", "postgresql://postgres@localhost:5432/postgres"))
os.environ.setdefault("SUPABASE_JWT_SECRET", "test-secret")
os.environ.setdefault("FRONTEND_URL", "http://localhost:3000")

import database
import main as api_module
from models import AgentAction, Conversation, Order, PriceArm, Seller, SKU, SellerSettings


@pytest.fixture(autouse=True)
def fresh_db(monkeypatch):
    monkeypatch.setenv("SUPABASE_DB_URL", os.environ.get("SUPABASE_DB_URL", "postgresql://postgres@localhost:5432/postgres"))
    monkeypatch.setenv("SUPABASE_JWT_SECRET", "test-secret")
    monkeypatch.setenv("FRONTEND_URL", "http://localhost:3000")
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
    api_module._forecast_cache.clear()
    yield


@pytest.fixture
def client():
    return TestClient(api_module.app)


def _make_token(auth_user_id: str) -> str:
    payload = {
        "sub": auth_user_id,
        "aud": "authenticated",
        "exp": datetime.now(tz=timezone.utc).timestamp() + 3600,
    }
    return jwt.encode(payload, os.environ["SUPABASE_JWT_SECRET"], algorithm="HS256")


def _auth_header(auth_user_id: str) -> dict:
    return {"Authorization": f"Bearer {_make_token(auth_user_id)}"}


def _seed_seller(seller_id: str = "s1", sku_id: str = "k1", auth_user_id: str | None = None) -> tuple[Seller, SKU]:
    if auth_user_id is None:
        auth_user_id = str(uuid.uuid4())
    seller = Seller(
        seller_id=seller_id,
        seller_name="Riya Sharma",
        phone_number=f"+9111111111{seller_id[-1]}",
        language_preference="hi",
        auth_user_id=auth_user_id,
    )
    database.insert_seller(seller)
    sku = SKU(
        sku_id=sku_id,
        seller_id=seller_id,
        sku_name="Blue Floral Kurti",
        current_stock=8,
        reorder_point=3,
        unit_cost=250,
        price_floor=300,
        price_ceiling=400,
        current_chosen_price=340,
    )
    database.insert_sku(sku)
    database.upsert_seller_settings(SellerSettings(seller_id=seller_id))
    return seller, sku


def test_ping(client):
    response = client.get("/ping")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_seller_me_requires_auth(client):
    response = client.get("/seller/me")
    assert response.status_code == 401


def test_seller_me_invalid_jwt(client):
    response = client.get("/seller/me", headers={"Authorization": "Bearer not-a-real-token"})
    assert response.status_code == 401


def test_seller_me_success(client):
    seller, _ = _seed_seller()
    response = client.get("/seller/me", headers=_auth_header(seller.auth_user_id))
    assert response.status_code == 200
    assert response.json() == {
        "seller_id": seller.seller_id,
        "seller_name": seller.seller_name,
        "language_preference": seller.language_preference,
    }


def test_seller_me_unonboarded_user(client):
    unknown_auth_user_id = str(uuid.uuid4())
    response = client.get("/seller/me", headers=_auth_header(unknown_auth_user_id))
    assert response.status_code == 404
    assert response.json()["detail"] == "account not found"


def test_get_seller_cross_seller_forbidden(client):
    seller_a, _ = _seed_seller(seller_id="s1", sku_id="k1", auth_user_id=str(uuid.uuid4()))
    seller_b, _ = _seed_seller(seller_id="s2", sku_id="k2", auth_user_id=str(uuid.uuid4()))
    response = client.get(f"/seller/{seller_b.seller_id}", headers=_auth_header(seller_a.auth_user_id))
    assert response.status_code == 403


def test_get_seller_success(client):
    seller, sku = _seed_seller()
    action = AgentAction(
        action_id=str(uuid.uuid4()),
        sku_id=sku.sku_id,
        seller_id=seller.seller_id,
        action_date=date.today(),
        tool_called="forecasting",
        trigger="user_message",
        chosen_price=340,
        stockout_probability_5d=0.2,
        stockout_severity="watch",
        seller_message="Stock is low",
        delivered_via="dashboard",
    )
    database.insert_agent_action(action)
    response = client.get(f"/seller/{seller.seller_id}", headers=_auth_header(seller.auth_user_id))
    assert response.status_code == 200
    body = response.json()
    assert body["seller"]["seller_id"] == seller.seller_id
    assert body["skus"][0]["sku_id"] == sku.sku_id
    assert body["skus"][0]["last_action"]["seller_message"] == "Stock is low"


def test_get_sku_history_shape(client):
    seller, sku = _seed_seller()
    database.insert_order(
        Order(
            order_id=str(uuid.uuid4()),
            sku_id=sku.sku_id,
            seller_id=seller.seller_id,
            order_date=date.today(),
            units_sold=2,
            price_charged=340,
            revenue=680,
            margin=180,
        )
    )
    database.upsert_price_arm(PriceArm(arm_id=str(uuid.uuid4()), sku_id=sku.sku_id, price_value=340))
    database.insert_agent_action(
        AgentAction(
            action_id=str(uuid.uuid4()),
            sku_id=sku.sku_id,
            seller_id=seller.seller_id,
            action_date=date.today(),
            tool_called="pricing",
            trigger="scheduled",
            chosen_price=340,
            stockout_probability_5d=0.1,
            stockout_probability_10d=0.2,
            stockout_severity="safe",
            seller_message="Price updated",
            reasoning_trace="Reasoning",
            delivered_via="dashboard",
        )
    )
    response = client.get(f"/seller/{seller.seller_id}/sku/{sku.sku_id}/history", headers=_auth_header(seller.auth_user_id))
    assert response.status_code == 200
    body = response.json()
    assert "order_history" in body
    assert "price_arms" in body
    assert "agent_actions" in body
    assert body["agent_actions"][0]["seller_message"] == "Price updated"


def test_get_forecast_caching(client, monkeypatch):
    seller, sku = _seed_seller()
    calls = {"count": 0}

    def fake_forecast(seller_state, n_simulations=500, rng_seed=None):
        calls["count"] += 1
        return {
            "lambda_estimated": 1.0,
            "starting_stock": 8,
            "fan_chart": [{"day": i, "p_stockout": 0.0} for i in range(1, 31)],
            "p_stockout_5d": 0.1,
            "p_stockout_10d": 0.2,
            "median_stockout_day": 10,
            "stockout_ci_low": 5,
            "stockout_ci_high": 15,
            "severity": "watch",
            "confidence": "medium",
            "days_of_history": 1,
        }

    monkeypatch.setattr(api_module, "run_forecasting_tool", fake_forecast)
    first = client.get(f"/seller/{seller.seller_id}/sku/{sku.sku_id}/forecast", headers=_auth_header(seller.auth_user_id))
    second = client.get(f"/seller/{seller.seller_id}/sku/{sku.sku_id}/forecast", headers=_auth_header(seller.auth_user_id))
    assert first.status_code == 200
    assert second.status_code == 200
    assert calls["count"] == 1


def test_get_forecast_refresh_bypasses_cache(client, monkeypatch):
    seller, sku = _seed_seller()
    calls = {"count": 0}

    def fake_forecast(seller_state, n_simulations=500, rng_seed=None):
        calls["count"] += 1
        return {
            "lambda_estimated": 1.0,
            "starting_stock": 8,
            "fan_chart": [{"day": i, "p_stockout": 0.0} for i in range(1, 31)],
            "p_stockout_5d": 0.1,
            "p_stockout_10d": 0.2,
            "median_stockout_day": 10,
            "stockout_ci_low": 5,
            "stockout_ci_high": 15,
            "severity": "watch",
            "confidence": "medium",
            "days_of_history": 1,
        }

    monkeypatch.setattr(api_module, "run_forecasting_tool", fake_forecast)
    first = client.get(f"/seller/{seller.seller_id}/sku/{sku.sku_id}/forecast?refresh=true", headers=_auth_header(seller.auth_user_id))
    second = client.get(f"/seller/{seller.seller_id}/sku/{sku.sku_id}/forecast?refresh=true", headers=_auth_header(seller.auth_user_id))
    assert first.status_code == 200
    assert second.status_code == 200
    assert calls["count"] == 2


def test_post_message_calls_agent_core(client, monkeypatch):
    seller, sku = _seed_seller()

    def fake_run_agent_cycle(seller_id, sku_id, trigger, message_text=None):
        assert seller_id == seller.seller_id
        assert sku_id == sku.sku_id
        assert trigger == "user_message"
        assert message_text == "Hello"
        return {
            "seller_message": "Hi there",
            "reasoning_trace": "Reasoning",
            "action_summary": "Action",
            "tool_called": "forecasting",
            "chosen_price": 340,
            "stockout_severity": "watch",
        }

    monkeypatch.setattr(api_module, "run_agent_cycle", fake_run_agent_cycle)
    response = client.post(
        f"/seller/{seller.seller_id}/message",
        json={"message": "Hello"},
        headers=_auth_header(seller.auth_user_id),
    )
    assert response.status_code == 200
    assert response.json() == {
        "response_text": "Hi there",
        "reasoning_trace": "Reasoning",
        "action_summary": "Action",
    }


def test_post_message_agent_core_error_returns_503(client, monkeypatch):
    seller, _ = _seed_seller()

    def fake_run_agent_cycle(*args, **kwargs):
        raise api_module.AgentCoreError("boom")

    monkeypatch.setattr(api_module, "run_agent_cycle", fake_run_agent_cycle)
    response = client.post(
        f"/seller/{seller.seller_id}/message",
        json={"message": "Hello"},
        headers=_auth_header(seller.auth_user_id),
    )
    assert response.status_code == 503
    assert response.json()["detail"] == "The agent is temporarily unavailable. Please try again in a moment."
    assert "boom" not in response.text


def test_post_settings_validation_floor_ceiling(client):
    seller, _ = _seed_seller()
    response = client.post(
        f"/seller/{seller.seller_id}/settings",
        json={
            "price_floor": 400,
            "price_ceiling": 400,
            "daily_alert_time": "08:00",
            "alert_language": "hi",
            "notify_on_price_change": True,
            "notify_on_stockout_risk": True,
            "price_change_threshold": 0.1,
        },
        headers=_auth_header(seller.auth_user_id),
    )
    assert response.status_code == 400


def test_post_settings_success(client):
    seller, sku = _seed_seller()
    database.upsert_price_arm(PriceArm(arm_id=str(uuid.uuid4()), sku_id=sku.sku_id, price_value=320))
    response = client.post(
        f"/seller/{seller.seller_id}/settings",
        json={
            "price_floor": 300,
            "price_ceiling": 420,
            "daily_alert_time": "09:30",
            "alert_language": "en",
            "notify_on_price_change": False,
            "notify_on_stockout_risk": True,
            "price_change_threshold": 0.2,
        },
        headers=_auth_header(seller.auth_user_id),
    )
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "updated"
    assert body["arms_recomputed"] is True
    assert body["new_arm_count"] >= 1


def test_demo_login_disabled_returns_404(client, monkeypatch):
    monkeypatch.delenv("DEMO_LOGIN_ENABLED", raising=False)
    response = client.get("/auth/demo-login")
    assert response.status_code == 404


def test_demo_login_enabled_returns_valid_token(client, monkeypatch):
    monkeypatch.setenv("DEMO_LOGIN_ENABLED", "true")
    monkeypatch.setenv("DEMO_SELLER_ID", "riya_sharma")

    seller = Seller(
        seller_id="riya_sharma",
        seller_name="Riya Sharma",
        phone_number="+919999999999",
        language_preference="hi",
        auth_user_id=str(uuid.uuid4()),
    )
    database.insert_seller(seller)

    response = client.get("/auth/demo-login")
    assert response.status_code == 200
    body = response.json()
    assert body["seller_name"] == seller.seller_name

    me_response = client.get("/seller/me", headers={"Authorization": f"Bearer {body['token']}"})
    assert me_response.status_code == 200
    assert me_response.json()["seller_id"] == seller.seller_id


def test_demo_login_missing_seed_returns_500(client, monkeypatch):
    monkeypatch.setenv("DEMO_LOGIN_ENABLED", "true")
    monkeypatch.setenv("DEMO_SELLER_ID", "missing-demo-seller")

    response = client.get("/auth/demo-login")
    assert response.status_code == 500
    assert response.json()["detail"] == "Demo seller not seeded — run seed_data.py"


def test_create_sku_success(client):
    seller = Seller(
        seller_id="s1",
        seller_name="Riya Sharma",
        phone_number="+9111111111",
        language_preference="hi",
        auth_user_id=str(uuid.uuid4()),
    )
    database.insert_seller(seller)

    payload = {
        "sku_name": "Sunrise Saree",
        "current_stock": 12,
        "reorder_point": 4,
        "unit_cost": 210,
        "price_floor": 300,
        "price_ceiling": 420,
    }
    response = client.post(
        f"/seller/{seller.seller_id}/skus",
        json=payload,
        headers=_auth_header(seller.auth_user_id),
    )
    assert response.status_code == 201
    body = response.json()
    assert body["sku_name"] == payload["sku_name"]
    assert body["price_floor"] == payload["price_floor"]
    assert body["price_ceiling"] == payload["price_ceiling"]
    assert body["current_stock"] == payload["current_stock"]
    assert body["current_chosen_price"] is None

    sku = database.get_sku_by_id(body["sku_id"])
    assert sku is not None
    assert sku.seller_id == seller.seller_id

    arms = database.get_price_arms(body["sku_id"], active_only=False)
    assert len(arms) >= 1


def test_create_sku_validation_price_range(client):
    seller = Seller(
        seller_id="s2",
        seller_name="Riya Sharma",
        phone_number="+9111111112",
        language_preference="hi",
        auth_user_id=str(uuid.uuid4()),
    )
    database.insert_seller(seller)

    response = client.post(
        f"/seller/{seller.seller_id}/skus",
        json={
            "sku_name": "Evening Lehenga",
            "current_stock": 6,
            "reorder_point": 2,
            "unit_cost": 250,
            "price_floor": 500,
            "price_ceiling": 450,
        },
        headers=_auth_header(seller.auth_user_id),
    )
    assert response.status_code == 400
    assert "price_floor" in response.json()["detail"] or "price ceiling" in response.json()["detail"]


def test_create_sku_requires_auth(client):
    seller = Seller(
        seller_id="s3",
        seller_name="Riya Sharma",
        phone_number="+9111111113",
        language_preference="hi",
        auth_user_id=str(uuid.uuid4()),
    )
    database.insert_seller(seller)

    response = client.post(
        f"/seller/{seller.seller_id}/skus",
        json={
            "sku_name": "Festival Blouse",
            "current_stock": 5,
            "reorder_point": 1,
            "unit_cost": 190,
            "price_floor": 280,
            "price_ceiling": 360,
        },
    )
    assert response.status_code == 401


def test_create_sku_cross_seller_forbidden(client):
    seller_a = Seller(
        seller_id="s4",
        seller_name="Riya Sharma",
        phone_number="+9111111114",
        language_preference="hi",
        auth_user_id=str(uuid.uuid4()),
    )
    seller_b = Seller(
        seller_id="s5",
        seller_name="Riya Sharma",
        phone_number="+9111111115",
        language_preference="hi",
        auth_user_id=str(uuid.uuid4()),
    )
    database.insert_seller(seller_a)
    database.insert_seller(seller_b)

    response = client.post(
        f"/seller/{seller_b.seller_id}/skus",
        json={
            "sku_name": "Festival Blouse",
            "current_stock": 5,
            "reorder_point": 1,
            "unit_cost": 190,
            "price_floor": 280,
            "price_ceiling": 360,
        },
        headers=_auth_header(seller_a.auth_user_id),
    )
    assert response.status_code == 403


def test_get_conversations_shape(client):
    seller, _ = _seed_seller()
    database.insert_conversation_message(
        Conversation(message_id=str(uuid.uuid4()), seller_id=seller.seller_id, direction="inbound", message_body="Hi")
    )
    database.insert_conversation_message(
        Conversation(message_id=str(uuid.uuid4()), seller_id=seller.seller_id, direction="outbound", message_body="Hi seller")
    )
    response = client.get(f"/seller/{seller.seller_id}/conversations", headers=_auth_header(seller.auth_user_id))
    assert response.status_code == 200
    body = response.json()
    assert body["messages"][0]["message_id"]
    assert body["messages"][0]["direction"] in {"inbound", "outbound"}
