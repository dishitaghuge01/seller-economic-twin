import os
import sys
import uuid
from datetime import datetime, timezone

import pytest
from fastapi.testclient import TestClient
from twilio.base.exceptions import TwilioRestException

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

os.environ.setdefault("SUPABASE_DB_URL", os.environ.get("SUPABASE_DB_URL", "postgresql://postgres@localhost:5432/postgres"))
os.environ.setdefault("SUPABASE_JWT_SECRET", "test-secret")
os.environ.setdefault("FRONTEND_URL", "http://localhost:3000")
os.environ.setdefault("TWILIO_ACCOUNT_SID", "test-account")
os.environ.setdefault("TWILIO_AUTH_TOKEN", "test-token")
os.environ.setdefault("TWILIO_WHATSAPP_NUMBER", "whatsapp:+14155238886")
os.environ.setdefault("INTERNAL_API_KEY", "test-internal-key")

import database
import main as api_module
import whatsapp as whatsapp_module
from agent_core import AgentCoreError
from models import AgentAction, Conversation, Seller, SKU


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


@pytest.fixture
def client():
    return TestClient(api_module.app)


def _seed_seller(seller_id: str = "s1", sku_id: str = "k1") -> tuple[Seller, SKU]:
    seller = Seller(
        seller_id=seller_id,
        seller_name="Riya Sharma",
        phone_number=f"+911111111{seller_id[-1]}",
        language_preference="hi",
        auth_user_id=str(uuid.uuid4()),
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
    return seller, sku


def test_webhook_rejects_invalid_signature(client):
    response = client.post(
        "/whatsapp/webhook",
        data={
            "MessageSid": "SM123",
            "From": "whatsapp:+919999999999",
            "To": "whatsapp:+14155238886",
            "Body": "Hello",
        },
    )
    assert response.status_code == 403
    assert database.get_conversation_history("s1", limit=10) == []


def test_webhook_valid_signature_unregistered_number(client, monkeypatch):
    monkeypatch.setattr(whatsapp_module.request_validator.RequestValidator, "validate", lambda self, url, params, signature: True)

    response = client.post(
        "/whatsapp/webhook",
        data={
            "MessageSid": "SM123",
            "From": "whatsapp:+919999999999",
            "To": "whatsapp:+14155238886",
            "Body": "Hello",
        },
        headers={"X-Twilio-Signature": "valid"},
    )

    assert response.status_code == 200
    seller = database.get_seller_by_phone("+919999999999")
    assert seller is not None
    assert seller.auth_user_id is not None


def test_webhook_idempotency(client, monkeypatch):
    seller, _ = _seed_seller()
    database.insert_conversation_message(
        Conversation(
            message_id=str(uuid.uuid4()),
            seller_id=seller.seller_id,
            direction="inbound",
            message_body="hello",
            message_sid="SM123",
        )
    )
    calls = {"count": 0}

    def fake_run_agent_cycle(*args, **kwargs):
        calls["count"] += 1
        return {
            "seller_message": "ignored",
            "reasoning_trace": "",
            "action_summary": "",
        }

    monkeypatch.setattr(whatsapp_module.request_validator.RequestValidator, "validate", lambda self, url, params, signature: True)
    monkeypatch.setattr(whatsapp_module, "run_agent_cycle", fake_run_agent_cycle)

    response = client.post(
        "/whatsapp/webhook",
        data={
            "MessageSid": "SM123",
            "From": f"whatsapp:{seller.phone_number}",
            "To": "whatsapp:+14155238886",
            "Body": "Hello",
        },
        headers={"X-Twilio-Signature": "valid"},
    )

    assert response.status_code == 200
    assert response.text == "<Response></Response>"
    assert calls["count"] == 0


def test_webhook_happy_path(client, monkeypatch):
    seller, _ = _seed_seller()

    def fake_run_agent_cycle(seller_id, sku_id, trigger, message_text=None):
        return {
            "seller_message": "Hello there",
            "reasoning_trace": "reasoning",
            "action_summary": "action",
        }

    monkeypatch.setattr(whatsapp_module.request_validator.RequestValidator, "validate", lambda self, url, params, signature: True)
    monkeypatch.setattr(whatsapp_module, "run_agent_cycle", fake_run_agent_cycle)

    response = client.post(
        "/whatsapp/webhook",
        data={
            "MessageSid": "SM456",
            "From": f"whatsapp:{seller.phone_number}",
            "To": "whatsapp:+14155238886",
            "Body": "Hello",
        },
        headers={"X-Twilio-Signature": "valid"},
    )

    assert response.status_code == 200
    assert "Hello there" in response.text
    assert response.headers["content-type"].startswith("application/xml")
    conversations = database.get_conversation_history(seller.seller_id, limit=10)
    assert len(conversations) == 2
    assert {conversation.direction for conversation in conversations} == {"inbound", "outbound"}


def test_webhook_first_message_with_zero_skus_sends_menu(client, monkeypatch):
    seller = Seller(
        seller_id="s_zero",
        seller_name="Riya",
        phone_number="+919900000001",
        language_preference="hi",
        auth_user_id=str(uuid.uuid4()),
    )
    database.insert_seller(seller)

    monkeypatch.setattr(whatsapp_module.request_validator.RequestValidator, "validate", lambda self, url, params, signature: True)

    response = client.post(
        "/whatsapp/webhook",
        data={
            "MessageSid": "SM_MENU",
            "From": f"whatsapp:{seller.phone_number}",
            "To": "whatsapp:+14155238886",
            "Body": "Hello",
        },
        headers={"X-Twilio-Signature": "valid"},
    )

    assert response.status_code == 200
    assert "1. Naya product (SKU) add karein" in response.text
    assert "2. Dashboard dekhein" in response.text
    updated_seller = database.get_seller_by_id(seller.seller_id)
    assert updated_seller is not None
    assert updated_seller.pending_action == "awaiting_onboarding_choice"


def test_webhook_reply_1_prompts_for_sku_details(client, monkeypatch):
    seller = Seller(
        seller_id="s_prompt",
        seller_name="Riya",
        phone_number="+919900000002",
        language_preference="hi",
        auth_user_id=str(uuid.uuid4()),
    )
    database.insert_seller(seller)
    database.set_pending_action(seller.seller_id, "awaiting_onboarding_choice")

    monkeypatch.setattr(whatsapp_module.request_validator.RequestValidator, "validate", lambda self, url, params, signature: True)

    response = client.post(
        "/whatsapp/webhook",
        data={
            "MessageSid": "SM_PROMPT",
            "From": f"whatsapp:{seller.phone_number}",
            "To": "whatsapp:+14155238886",
            "Body": "1",
        },
        headers={"X-Twilio-Signature": "valid"},
    )

    assert response.status_code == 200
    assert "Product ka naam, current stock" in response.text
    updated_seller = database.get_seller_by_id(seller.seller_id)
    assert updated_seller is not None
    assert updated_seller.pending_action == "awaiting_sku_details"


def test_webhook_well_formed_sku_details_creates_sku(client, monkeypatch):
    seller = Seller(
        seller_id="s_create",
        seller_name="Riya",
        phone_number="+919900000003",
        language_preference="hi",
        auth_user_id=str(uuid.uuid4()),
    )
    database.insert_seller(seller)
    database.set_pending_action(seller.seller_id, "awaiting_sku_details")

    monkeypatch.setattr(whatsapp_module.request_validator.RequestValidator, "validate", lambda self, url, params, signature: True)

    response = client.post(
        "/whatsapp/webhook",
        data={
            "MessageSid": "SM_CREATE",
            "From": f"whatsapp:{seller.phone_number}",
            "To": "whatsapp:+14155238886",
            "Body": "Besan 1kg, 50, 10, 80, 100, 140",
        },
        headers={"X-Twilio-Signature": "valid"},
    )

    assert response.status_code == 200
    assert "Product add ho gaya hai" in response.text
    skus = database.get_skus_for_seller(seller.seller_id)
    assert len(skus) == 1
    assert skus[0].sku_name == "Besan 1kg"
    updated_seller = database.get_seller_by_id(seller.seller_id)
    assert updated_seller is not None
    assert updated_seller.pending_action is None


def test_webhook_malformed_sku_details_keeps_pending_action(client, monkeypatch):
    seller = Seller(
        seller_id="s_malformed",
        seller_name="Riya",
        phone_number="+919900000004",
        language_preference="hi",
        auth_user_id=str(uuid.uuid4()),
    )
    database.insert_seller(seller)
    database.set_pending_action(seller.seller_id, "awaiting_sku_details")

    monkeypatch.setattr(whatsapp_module.request_validator.RequestValidator, "validate", lambda self, url, params, signature: True)

    response = client.post(
        "/whatsapp/webhook",
        data={
            "MessageSid": "SM_MALFORMED",
            "From": f"whatsapp:{seller.phone_number}",
            "To": "whatsapp:+14155238886",
            "Body": "only one field",
        },
        headers={"X-Twilio-Signature": "valid"},
    )

    assert response.status_code == 200
    assert "sahi format" in response.text.lower() or "format" in response.text.lower()
    updated_seller = database.get_seller_by_id(seller.seller_id)
    assert updated_seller is not None
    assert updated_seller.pending_action == "awaiting_sku_details"


def test_webhook_reply_2_sends_dashboard_and_clears_pending_action(client, monkeypatch):
    seller = Seller(
        seller_id="s_dashboard",
        seller_name="Riya",
        phone_number="+919900000005",
        language_preference="hi",
        auth_user_id=str(uuid.uuid4()),
    )
    database.insert_seller(seller)
    database.set_pending_action(seller.seller_id, "awaiting_onboarding_choice")

    monkeypatch.setattr(whatsapp_module.request_validator.RequestValidator, "validate", lambda self, url, params, signature: True)

    response = client.post(
        "/whatsapp/webhook",
        data={
            "MessageSid": "SM_DASH",
            "From": f"whatsapp:{seller.phone_number}",
            "To": "whatsapp:+14155238886",
            "Body": "2",
        },
        headers={"X-Twilio-Signature": "valid"},
    )

    assert response.status_code == 200
    assert "Dashboard" in response.text or "dashboard" in response.text.lower()
    updated_seller = database.get_seller_by_id(seller.seller_id)
    assert updated_seller is not None
    assert updated_seller.pending_action is None


def test_webhook_agent_core_failure_graceful(client, monkeypatch):
    seller, _ = _seed_seller()

    def fake_run_agent_cycle(*args, **kwargs):
        raise AgentCoreError("boom")

    monkeypatch.setattr(whatsapp_module.request_validator.RequestValidator, "validate", lambda self, url, params, signature: True)
    monkeypatch.setattr(whatsapp_module, "run_agent_cycle", fake_run_agent_cycle)

    response = client.post(
        "/whatsapp/webhook",
        data={
            "MessageSid": "SM789",
            "From": f"whatsapp:{seller.phone_number}",
            "To": "whatsapp:+14155238886",
            "Body": "Hello",
        },
        headers={"X-Twilio-Signature": "valid"},
    )

    assert response.status_code == 200
    assert "Maaf kijiye" in response.text or "Sorry" in response.text
    conversations = database.get_conversation_history(seller.seller_id, limit=10)
    assert len(conversations) == 2
    assert conversations[0].direction == "outbound"


def test_resolve_default_sku_single_sku():
    seller, sku = _seed_seller()
    assert api_module._resolve_default_sku(seller.seller_id) == sku.sku_id


def test_resolve_default_sku_multiple_skus_uses_most_recent_action():
    seller, sku_a = _seed_seller(seller_id="s1", sku_id="k1")
    sku_b = SKU(
        sku_id="k2",
        seller_id=seller.seller_id,
        sku_name="Red Kurti",
        current_stock=4,
        reorder_point=2,
        unit_cost=200,
        price_floor=250,
        price_ceiling=300,
        current_chosen_price=275,
    )
    database.insert_sku(sku_b)

    older = AgentAction(
        action_id=str(uuid.uuid4()),
        sku_id=sku_a.sku_id,
        seller_id=seller.seller_id,
        action_date=datetime.now(timezone.utc).date(),
        tool_called="pricing",
        trigger="user_message",
        seller_message="old",
        created_at=datetime(2024, 1, 1, tzinfo=timezone.utc),
    )
    newer = AgentAction(
        action_id=str(uuid.uuid4()),
        sku_id=sku_b.sku_id,
        seller_id=seller.seller_id,
        action_date=datetime.now(timezone.utc).date(),
        tool_called="forecasting",
        trigger="user_message",
        seller_message="new",
        created_at=datetime(2024, 1, 2, tzinfo=timezone.utc),
    )
    database.insert_agent_action(older)
    database.insert_agent_action(newer)

    assert api_module._resolve_default_sku(seller.seller_id) == sku_b.sku_id


def test_send_requires_internal_key(client):
    response = client.post(
        "/whatsapp/send",
        json={"seller_id": "s1", "message_body": "Hello"},
    )
    assert response.status_code == 401


def test_send_seller_not_found(client):
    response = client.post(
        "/whatsapp/send",
        json={"seller_id": "missing", "message_body": "Hello"},
        headers={"X-Internal-Key": "test-internal-key"},
    )
    assert response.status_code == 404


def test_send_success(client, monkeypatch):
    seller, _ = _seed_seller()

    class FakeMessages:
        def create(self, **kwargs):
            return type("Message", (), {"sid": "SM999"})()

    class FakeClient:
        def __init__(self, account_sid, auth_token, http_client=None):
            self.messages = FakeMessages()

    monkeypatch.setattr(whatsapp_module, "Client", FakeClient)

    response = client.post(
        "/whatsapp/send",
        json={"seller_id": seller.seller_id, "message_body": "Hello"},
        headers={"X-Internal-Key": "test-internal-key"},
    )

    assert response.status_code == 200
    assert response.json() == {"status": "sent", "message_sid": "SM999"}
    conversations = database.get_conversation_history(seller.seller_id, limit=10)
    assert len(conversations) == 1
    assert conversations[0].message_sid == "SM999"


def test_send_twilio_credits_exhausted_returns_skipped(client, monkeypatch, caplog):
    seller, _ = _seed_seller()

    class FakeMessages:
        def create(self, **kwargs):
            raise TwilioRestException(401, "https://api.twilio.com/2010-04-01/Accounts/AC123/Messages.json", "Account is not active", code=20003)

    class FakeClient:
        def __init__(self, account_sid, auth_token, http_client=None):
            self.messages = FakeMessages()

    monkeypatch.setattr(whatsapp_module, "Client", FakeClient)

    response = client.post(
        "/whatsapp/send",
        json={"seller_id": seller.seller_id, "message_body": "Hello"},
        headers={"X-Internal-Key": "test-internal-key"},
    )

    assert response.status_code == 200
    assert response.json() == {"status": "skipped", "reason": "twilio_credits_exhausted"}
    assert "TWILIO_CREDITS_EXHAUSTED" in caplog.text
    assert database.get_conversation_history(seller.seller_id, limit=10) == []


def test_send_outside_24h_window_returns_graceful_200(client, monkeypatch, caplog):
    seller, _ = _seed_seller()

    class FakeTwilioError(Exception):
        pass

    class FakeMessages:
        def create(self, **kwargs):
            raise FakeTwilioError("63016")

    class FakeClient:
        def __init__(self, account_sid, auth_token, http_client=None):
            self.messages = FakeMessages()

    monkeypatch.setattr(whatsapp_module, "Client", FakeClient)

    response = client.post(
        "/whatsapp/send",
        json={"seller_id": seller.seller_id, "message_body": "Hello"},
        headers={"X-Internal-Key": "test-internal-key"},
    )

    assert response.status_code == 200
    assert response.json() == {"status": "skipped", "reason": "outside 24h window"}
    assert "outside 24h window" in caplog.text
    assert database.get_conversation_history(seller.seller_id, limit=10) == []
