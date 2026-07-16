import os
import sys
import uuid
from datetime import datetime, timedelta, timezone

import jwt
import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

os.environ.setdefault("SUPABASE_DB_URL", os.environ.get("SUPABASE_DB_URL", "postgresql://postgres@localhost:5432/postgres"))
os.environ.setdefault("SUPABASE_JWT_SECRET", "test-secret")
os.environ.setdefault("FRONTEND_URL", "http://localhost:3000")
os.environ.setdefault("TWILIO_ACCOUNT_SID", "test-account")
os.environ.setdefault("TWILIO_AUTH_TOKEN", "test-token")
os.environ.setdefault("TWILIO_WHATSAPP_NUMBER", "whatsapp:+14155238886")
os.environ.setdefault("INTERNAL_API_KEY", "test-internal-key")
os.environ.setdefault("TWILIO_SANDBOX_JOIN_KEYWORD", "silver-frog")

import database
import main as api_module
import whatsapp as whatsapp_module
from auth_pairing import router as auth_pairing_router
from models import Seller


@pytest.fixture(autouse=True)
def fresh_db(monkeypatch):
    monkeypatch.setenv("SUPABASE_DB_URL", os.environ.get("SUPABASE_DB_URL", "postgresql://postgres@localhost:5432/postgres"))
    monkeypatch.setenv("SUPABASE_JWT_SECRET", "test-secret")
    monkeypatch.setenv("FRONTEND_URL", "http://localhost:3000")
    monkeypatch.setenv("TWILIO_ACCOUNT_SID", "test-account")
    monkeypatch.setenv("TWILIO_AUTH_TOKEN", "test-token")
    monkeypatch.setenv("TWILIO_WHATSAPP_NUMBER", "whatsapp:+14155238886")
    monkeypatch.setenv("INTERNAL_API_KEY", "test-internal-key")
    monkeypatch.setenv("TWILIO_SANDBOX_JOIN_KEYWORD", "silver-frog")
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
                         conversations, seller_settings, pairing_sessions CASCADE
                """
            )
    yield


@pytest.fixture
def client():
    return TestClient(api_module.app)


def _make_seller(phone_number: str = "+919876543210") -> Seller:
    seller = Seller(
        seller_id="seller_543210",
        seller_name="New Seller",
        phone_number=phone_number,
        language_preference="hi",
        auth_user_id=str(uuid.uuid4()),
    )
    database.insert_seller(seller)
    return seller


def test_start_pairing_new_number(client):
    response = client.post("/auth/start-pairing", json={"phone_number": "+919876543210"})

    assert response.status_code == 200
    assert response.json()["status"] == "pending"
    session = database.get_pairing_session("+919876543210")
    assert session is not None
    assert session["status"] == "pending"


def test_start_pairing_debounce(client):
    first = client.post("/auth/start-pairing", json={"phone_number": "+919876543210"})
    first_session = database.get_pairing_session("+919876543210")
    assert first.status_code == 200

    second = client.post("/auth/start-pairing", json={"phone_number": "+919876543210"})
    assert second.status_code == 200

    sessions = []
    with database.get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT phone_number, created_at FROM pairing_sessions")
            sessions = cur.fetchall()

    assert len(sessions) == 1
    assert first_session["created_at"] == sessions[0][1]


def test_start_pairing_existing_seller_attempts_push(client, monkeypatch):
    seller = _make_seller()

    monkeypatch.setattr("auth_pairing.send_whatsapp_message", lambda *args, **kwargs: {"status": "sent", "message_sid": "SM123"})

    response = client.post("/auth/start-pairing", json={"phone_number": seller.phone_number})

    assert response.status_code == 200
    session = database.get_pairing_session(seller.phone_number)
    assert session is not None
    assert session["status"] == "complete"
    assert session["seller_id"] == seller.seller_id
    payload = jwt.decode(session["jwt_token"], "test-secret", algorithms=["HS256"], audience="authenticated")
    assert payload["sub"] == seller.auth_user_id


def test_start_pairing_existing_seller_push_fails_falls_back(client, monkeypatch):
    seller = _make_seller()

    def raise_error(*args, **kwargs):
        raise RuntimeError("boom")

    monkeypatch.setattr("auth_pairing.send_whatsapp_message", raise_error)

    response = client.post("/auth/start-pairing", json={"phone_number": seller.phone_number})

    assert response.status_code == 200
    session = database.get_pairing_session(seller.phone_number)
    assert session is not None
    assert session["status"] == "pending"
    assert "wa.me" in response.json()["wa_link"]


def test_pairing_status_expired(client):
    client.post("/auth/start-pairing", json={"phone_number": "+919876543210"})
    with database.get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "UPDATE pairing_sessions SET expires_at = %s WHERE phone_number = %s",
                (datetime.now(timezone.utc) - timedelta(hours=1), "+919876543210"),
            )

    response = client.get("/auth/pairing-status", params={"phone_number": "+919876543210"})
    assert response.json()["status"] == "expired"


def test_pairing_status_pending(client):
    client.post("/auth/start-pairing", json={"phone_number": "+919876543210"})

    response = client.get("/auth/pairing-status", params={"phone_number": "+919876543210"})
    assert response.json()["status"] == "pending"


def test_pairing_status_complete(client):
    client.post("/auth/start-pairing", json={"phone_number": "+919876543210"})
    session = database.get_pairing_session("+919876543210")
    database.complete_pairing_session(
        "+919876543210",
        "token-value",
        "seller_543210",
    )

    response = client.get("/auth/pairing-status", params={"phone_number": "+919876543210"})
    assert response.json()["status"] == "complete"
    assert response.json()["token"] == "token-value"


def test_webhook_new_number_auto_creates_seller(client, monkeypatch):
    monkeypatch.setattr(whatsapp_module.request_validator.RequestValidator, "validate", lambda self, url, params, signature: True)

    response = client.post(
        "/whatsapp/webhook",
        data={
            "MessageSid": "SM100",
            "From": "whatsapp:+919777777777",
            "To": "whatsapp:+14155238886",
            "Body": "Hello",
        },
        headers={"X-Twilio-Signature": "valid"},
    )

    assert response.status_code == 200
    seller = database.get_seller_by_phone("+919777777777")
    assert seller is not None
    uuid.UUID(seller.auth_user_id)
    settings = database.get_seller_settings(seller.seller_id)
    assert settings.seller_id == seller.seller_id


def test_webhook_new_seller_zero_skus_gets_welcome_message_not_agent_cycle(client, monkeypatch):
    calls = []

    def fake_run_agent_cycle(*args, **kwargs):
        calls.append((args, kwargs))
        return {"seller_message": "ignored"}

    monkeypatch.setattr(whatsapp_module.request_validator.RequestValidator, "validate", lambda self, url, params, signature: True)
    monkeypatch.setattr(whatsapp_module, "run_agent_cycle", fake_run_agent_cycle)

    response = client.post(
        "/whatsapp/webhook",
        data={
            "MessageSid": "SM101",
            "From": "whatsapp:+919888888888",
            "To": "whatsapp:+14155238886",
            "Body": "Hello",
        },
        headers={"X-Twilio-Signature": "valid"},
    )

    assert response.status_code == 200
    assert calls == []
    assert "dashboard kholein" in response.text
    assert "token=" in response.text
    assert "http://localhost:3000" in response.text


def test_webhook_completes_matching_pairing_session(client, monkeypatch):
    monkeypatch.setattr(whatsapp_module.request_validator.RequestValidator, "validate", lambda self, url, params, signature: True)
    database.upsert_pairing_session("+919999999999")

    response = client.post(
        "/whatsapp/webhook",
        data={
            "MessageSid": "SM102",
            "From": "whatsapp:+919999999999",
            "To": "whatsapp:+14155238886",
            "Body": "Hello",
        },
        headers={"X-Twilio-Signature": "valid"},
    )

    assert response.status_code == 200
    session = database.get_pairing_session("+919999999999")
    assert session is not None
    assert session["status"] == "complete"
    assert session["seller_id"] is not None
    jwt.decode(session["jwt_token"], "test-secret", algorithms=["HS256"], audience="authenticated")


def test_webhook_organic_join_with_no_pairing_session(client, monkeypatch):
    monkeypatch.setattr(whatsapp_module.request_validator.RequestValidator, "validate", lambda self, url, params, signature: True)

    response = client.post(
        "/whatsapp/webhook",
        data={
            "MessageSid": "SM103",
            "From": "whatsapp:+919111111111",
            "To": "whatsapp:+14155238886",
            "Body": "Hello",
        },
        headers={"X-Twilio-Signature": "valid"},
    )

    assert response.status_code == 200
    seller = database.get_seller_by_phone("+919111111111")
    assert seller is not None
    assert seller.auth_user_id is not None
