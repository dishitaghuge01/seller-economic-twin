import importlib
import os
import sys
import time
import types
import uuid
from datetime import date, timedelta

import psycopg2
import pytest

BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, BACKEND_DIR)

TEST_DB_URL = "postgresql://postgres@localhost:5432/seller_economic_twin_test"
os.environ.setdefault("SUPABASE_DB_URL", TEST_DB_URL)
os.environ.setdefault("SARVAM_API_KEY", "test-sarvam-key")
os.environ.setdefault("GEMINI_API_KEY", "test-gemini-key")


class FakeOpenAIClient:
    def __init__(self, response_text: str):
        self.response_text = response_text
        self.calls = []
        self.chat = types.SimpleNamespace(completions=self)

    def create(self, **kwargs):
        self.calls.append(kwargs)
        return types.SimpleNamespace(
            choices=[
                types.SimpleNamespace(
                    message=types.SimpleNamespace(content=self.response_text)
                )
            ]
        )


def _import_backend_modules():
    import database as database_module
    import models as models_module
    import forecasting_tool as forecasting_tool_module
    import pricing_tool as pricing_tool_module
    import agent_core as agent_core_module

    return database_module, models_module, forecasting_tool_module, pricing_tool_module, agent_core_module


@pytest.fixture(autouse=True)
def fresh_db(monkeypatch):
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

    database, models, forecasting_tool, pricing_tool, agent_core = _import_backend_modules()
    importlib.reload(database)
    importlib.reload(models)
    importlib.reload(forecasting_tool)
    importlib.reload(pricing_tool)
    importlib.reload(agent_core)

    globals()["database"] = database
    globals()["models"] = models
    globals()["forecasting_tool"] = forecasting_tool
    globals()["pricing_tool"] = pricing_tool
    globals()["agent_core"] = agent_core

    database.create_tables()
    database.create_local_auth_stub()

    with database.get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                CREATE OR REPLACE FUNCTION auth.uid()
                RETURNS UUID
                LANGUAGE SQL
                AS $$ SELECT '00000000-0000-0000-0000-000000000000'::UUID $$;
                """
            )

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


@pytest.fixture
def fake_claude(monkeypatch):
    client = FakeOpenAIClient(
        "SELLER_MESSAGE:\nHi there\n\n"
        "REASONING_TRACE:\nReasoning\n\n"
        "SUMMARY:\nACTION: price | REASON: because | CONFIDENCE: high"
    )
    monkeypatch.setattr(agent_core, "OpenAI", lambda *args, **kwargs: client)
    return client


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


def test_scheduled_cycle_calls_both_tools(fake_claude, monkeypatch):
    _seed_seller_and_sku()
    calls = {"pricing": 0, "forecasting": 0}

    def fake_pricing(seller_state, rng_seed=None):
        calls["pricing"] += 1
        return {
            "chosen_price": 390,
            "updated_arms": [
                {"price_value": 370, "alpha": 2.0, "beta_param": 3.0, "times_chosen": 1},
                {"price_value": 390, "alpha": 3.0, "beta_param": 2.0, "times_chosen": 2},
            ],
            "exploration_rationale": "pricing rationale",
            "chosen_arm_credible_interval": [0.2, 0.8],
            "cold_start": False,
        }

    def fake_forecasting(seller_state, n_simulations=500, rng_seed=None):
        calls["forecasting"] += 1
        return {
            "severity": "watch",
            "p_stockout_5d": 0.2,
            "p_stockout_10d": 0.4,
            "forecast_summary": "forecast summary",
            "fan_chart": [],
            "confidence": "medium",
            "lambda_source": "estimated",
        }

    monkeypatch.setattr(agent_core, "run_pricing_tool", fake_pricing)
    monkeypatch.setattr(agent_core, "run_forecasting_tool", fake_forecasting)

    result = agent_core.run_agent_cycle("s1", "k1", "scheduled")

    assert calls["pricing"] == 1
    assert calls["forecasting"] == 1
    assert result["tool_called"] == "both"


def test_scheduled_cycle_writes_agent_action(fake_claude):
    _seed_seller_and_sku()
    result = agent_core.run_agent_cycle("s1", "k1", "scheduled")

    action = database.get_last_agent_action("k1")
    assert action is not None
    assert action.trigger == "scheduled"
    assert action.chosen_price == result["chosen_price"]
    assert action.seller_message == result["seller_message"]


def test_scheduled_cycle_updates_chosen_price(fake_claude, monkeypatch):
    _seed_seller_and_sku()
    monkeypatch.setattr(
        agent_core,
        "run_pricing_tool",
        lambda seller_state, rng_seed=None: {
            "chosen_price": 390,
            "updated_arms": [
                {"price_value": 370, "alpha": 2.0, "beta_param": 3.0, "times_chosen": 1},
                {"price_value": 390, "alpha": 3.0, "beta_param": 2.0, "times_chosen": 2},
            ],
            "exploration_rationale": "pricing rationale",
            "chosen_arm_credible_interval": [0.2, 0.8],
            "cold_start": False,
        },
    )
    monkeypatch.setattr(
        agent_core,
        "run_forecasting_tool",
        lambda seller_state, n_simulations=500, rng_seed=None: {
            "severity": "watch",
            "p_stockout_5d": 0.2,
            "p_stockout_10d": 0.4,
            "forecast_summary": "forecast summary",
            "fan_chart": [],
            "confidence": "medium",
            "lambda_source": "estimated",
        },
    )

    result = agent_core.run_agent_cycle("s1", "k1", "scheduled")

    assert database.get_sku_by_id("k1").current_chosen_price == result["chosen_price"]


def test_scheduled_cycle_recomputes_arm_grid(fake_claude, monkeypatch):
    _seed_seller_and_sku()
    database.upsert_price_arm(
        models.PriceArm(
            arm_id=str(uuid.uuid4()),
            sku_id="k1",
            price_value=510,
            alpha=1.0,
            beta_param=1.0,
            times_chosen=0,
            is_active=True,
        )
    )
    monkeypatch.setattr(
        agent_core,
        "run_pricing_tool",
        lambda seller_state, rng_seed=None: {
            "chosen_price": 390,
            "updated_arms": [
                {"price_value": 370, "alpha": 2.0, "beta_param": 3.0, "times_chosen": 1},
                {"price_value": 390, "alpha": 3.0, "beta_param": 2.0, "times_chosen": 2},
            ],
            "exploration_rationale": "pricing rationale",
            "chosen_arm_credible_interval": [0.2, 0.8],
            "cold_start": False,
        },
    )
    monkeypatch.setattr(
        agent_core,
        "run_forecasting_tool",
        lambda seller_state, n_simulations=500, rng_seed=None: {
            "severity": "watch",
            "p_stockout_5d": 0.2,
            "p_stockout_10d": 0.4,
            "forecast_summary": "forecast summary",
            "fan_chart": [],
            "confidence": "medium",
            "lambda_source": "estimated",
        },
    )

    agent_core.run_agent_cycle("s1", "k1", "scheduled")

    arm = next(a for a in database.get_price_arms("k1", active_only=False) if a.price_value == 510)
    assert arm.is_active is False


def test_user_message_price_intent(fake_claude, monkeypatch):
    _seed_seller_and_sku()
    calls = {"pricing": 0, "forecasting": 0}

    def fake_pricing(seller_state, rng_seed=None):
        calls["pricing"] += 1
        return {
            "chosen_price": 390,
            "updated_arms": [{"price_value": 390, "alpha": 3.0, "beta_param": 2.0, "times_chosen": 2}],
            "exploration_rationale": "pricing rationale",
            "chosen_arm_credible_interval": [0.2, 0.8],
            "cold_start": False,
        }

    def fake_forecasting(seller_state, n_simulations=500, rng_seed=None):
        calls["forecasting"] += 1
        return {
            "severity": "watch",
            "p_stockout_5d": 0.2,
            "p_stockout_10d": 0.4,
            "forecast_summary": "forecast summary",
            "fan_chart": [],
            "confidence": "medium",
            "lambda_source": "estimated",
        }

    monkeypatch.setattr(agent_core, "run_pricing_tool", fake_pricing)
    monkeypatch.setattr(agent_core, "run_forecasting_tool", fake_forecasting)

    result = agent_core.run_agent_cycle("s1", "k1", "user_message", "kya price kam kar sakte ho")

    assert calls["pricing"] == 1
    assert calls["forecasting"] == 0
    assert result["tool_called"] == "pricing"
    prompt = next(
        message["content"]
        for message in fake_claude.calls[-1]["messages"]
        if message["role"] == "user"
    )
    assert "Forecasting tool was not run this cycle" in prompt


def test_user_message_stock_intent(fake_claude, monkeypatch):
    _seed_seller_and_sku()
    calls = {"pricing": 0, "forecasting": 0}

    def fake_pricing(seller_state, rng_seed=None):
        calls["pricing"] += 1
        return {
            "chosen_price": 390,
            "updated_arms": [{"price_value": 390, "alpha": 3.0, "beta_param": 2.0, "times_chosen": 2}],
            "exploration_rationale": "pricing rationale",
            "chosen_arm_credible_interval": [0.2, 0.8],
            "cold_start": False,
        }

    def fake_forecasting(seller_state, n_simulations=500, rng_seed=None):
        calls["forecasting"] += 1
        return {
            "severity": "watch",
            "p_stockout_5d": 0.2,
            "p_stockout_10d": 0.4,
            "forecast_summary": "forecast summary",
            "fan_chart": [],
            "confidence": "medium",
            "lambda_source": "estimated",
        }

    monkeypatch.setattr(agent_core, "run_pricing_tool", fake_pricing)
    monkeypatch.setattr(agent_core, "run_forecasting_tool", fake_forecasting)

    result = agent_core.run_agent_cycle("s1", "k1", "user_message", "stock khatam ho raha hai")

    assert calls["pricing"] == 0
    assert calls["forecasting"] == 1
    assert result["tool_called"] == "forecasting"


def test_user_message_ambiguous_calls_both(fake_claude, monkeypatch):
    _seed_seller_and_sku()
    calls = {"pricing": 0, "forecasting": 0}

    def fake_pricing(seller_state, rng_seed=None):
        calls["pricing"] += 1
        return {
            "chosen_price": 390,
            "updated_arms": [{"price_value": 390, "alpha": 3.0, "beta_param": 2.0, "times_chosen": 2}],
            "exploration_rationale": "pricing rationale",
            "chosen_arm_credible_interval": [0.2, 0.8],
            "cold_start": False,
        }

    def fake_forecasting(seller_state, n_simulations=500, rng_seed=None):
        calls["forecasting"] += 1
        return {
            "severity": "watch",
            "p_stockout_5d": 0.2,
            "p_stockout_10d": 0.4,
            "forecast_summary": "forecast summary",
            "fan_chart": [],
            "confidence": "medium",
            "lambda_source": "estimated",
        }

    monkeypatch.setattr(agent_core, "run_pricing_tool", fake_pricing)
    monkeypatch.setattr(agent_core, "run_forecasting_tool", fake_forecasting)

    result = agent_core.run_agent_cycle("s1", "k1", "user_message", "price stock")

    assert calls["pricing"] == 1
    assert calls["forecasting"] == 1
    assert result["tool_called"] == "both"


def test_parse_response_well_formed():
    raw_text = (
        "SELLER_MESSAGE:\n  Hello seller  \n\n"
        "REASONING_TRACE:\n  Because the bandit sampled arm 390  \n\n"
        "SUMMARY:\n ACTION: price | REASON: because | CONFIDENCE: high"
    )

    parsed = agent_core._parse_agent_response(raw_text)

    assert parsed["seller_message"] == "Hello seller"
    assert parsed["reasoning_trace"] == "Because the bandit sampled arm 390"
    assert parsed["action_summary"] == "ACTION: price | REASON: because | CONFIDENCE: high"


def test_parse_response_missing_section_raises():
    with pytest.raises(agent_core.AgentCoreError) as exc_info:
        agent_core._parse_agent_response("SELLER_MESSAGE:\nHello\n\nSUMMARY:\nACTION: price")

    assert "SELLER_MESSAGE" in str(exc_info.value)


def test_parse_response_extra_whitespace_tolerated():
    raw_text = "\n\n  SELLER_MESSAGE:   \n   Hello there   \n\n\n  REASONING_TRACE:   \n  Reasoning text   \n\n  SUMMARY:   \n   ACTION: price | REASON: because | CONFIDENCE: high   \n"

    parsed = agent_core._parse_agent_response(raw_text)

    assert parsed["seller_message"] == "Hello there"
    assert parsed["reasoning_trace"] == "Reasoning text"
    assert parsed["action_summary"] == "ACTION: price | REASON: because | CONFIDENCE: high"


def test_parse_response_ignores_extra_text_after_summary_line():
    raw_text = (
        "SELLER_MESSAGE:\nHi seller\n\n"
        "REASONING_TRACE:\nReasoning details\n\n"
        "SUMMARY:\nACTION: price | REASON: because | CONFIDENCE: high Extra trailing text\n"
    )

    parsed = agent_core._parse_agent_response(raw_text)

    assert parsed["action_summary"] == "ACTION: price | REASON: because | CONFIDENCE: high"
    assert "Extra trailing text" not in parsed["action_summary"]


def test_api_failure_raises_agent_core_error(fake_claude, monkeypatch):
    _seed_seller_and_sku()

    def failing_create(**kwargs):
        raise RuntimeError("network down")

    monkeypatch.setattr(fake_claude, "create", failing_create)
    monkeypatch.setattr(
        agent_core,
        "run_pricing_tool",
        lambda seller_state, rng_seed=None: {
            "chosen_price": 390,
            "updated_arms": [{"price_value": 390, "alpha": 3.0, "beta_param": 2.0, "times_chosen": 2}],
            "exploration_rationale": "pricing rationale",
            "chosen_arm_credible_interval": [0.2, 0.8],
            "cold_start": False,
        },
    )
    monkeypatch.setattr(
        agent_core,
        "run_forecasting_tool",
        lambda seller_state, n_simulations=500, rng_seed=None: {
            "severity": "watch",
            "p_stockout_5d": 0.2,
            "p_stockout_10d": 0.4,
            "forecast_summary": "forecast summary",
            "fan_chart": [],
            "confidence": "medium",
            "lambda_source": "estimated",
        },
    )

    with pytest.raises(agent_core.AgentCoreError) as exc_info:
        agent_core.run_agent_cycle("s1", "k1", "scheduled")

    assert "both providers failed" in str(exc_info.value)
    assert "network down" in str(exc_info.value)
    assert database.get_last_agent_action("k1") is None


def test_falls_back_to_gemini_when_sarvam_response_is_malformed(fake_claude, monkeypatch):
    _seed_seller_and_sku()
    calls = {"sarvam": 0, "gemini": 0}

    def fake_call_provider(provider_name, system_prompt, user_prompt):
        calls[provider_name] += 1
        if provider_name == "sarvam":
            return "SELLER_MESSAGE:\nMalformed\n\nSUMMARY:\nACTION: price"
        return (
            "SELLER_MESSAGE:\nFallback success\n\n"
            "REASONING_TRACE:\nReasoning from Gemini\n\n"
            "SUMMARY:\nACTION: price | REASON: fallback | CONFIDENCE: high"
        )

    monkeypatch.setattr(agent_core, "_call_provider", fake_call_provider)
    result = agent_core.run_agent_cycle("s1", "k1", "scheduled")

    assert calls["sarvam"] == 1
    assert calls["gemini"] == 1
    assert result["seller_message"] == "Fallback success"


def test_both_provider_failures_raise_agent_core_error(monkeypatch):
    _seed_seller_and_sku()

    def fake_call_provider(provider_name, system_prompt, user_prompt):
        raise RuntimeError(f"{provider_name} down")

    monkeypatch.setattr(agent_core, "_call_provider", fake_call_provider)

    with pytest.raises(agent_core.AgentCoreError) as exc_info:
        agent_core.run_agent_cycle("s1", "k1", "scheduled")

    message = str(exc_info.value)
    assert "both providers failed" in message
    assert "sarvam" in message
    assert "gemini" in message


def test_cold_start_sku_no_order_history(fake_claude):
    seller, sku = _seed_seller_and_sku(days_of_history=0)
    prompt = None

    def capture_create(**kwargs):
        nonlocal prompt
        prompt = next(
            message["content"]
            for message in kwargs["messages"]
            if message["role"] == "user"
        )
        return types.SimpleNamespace(
            choices=[
                types.SimpleNamespace(
                    message=types.SimpleNamespace(
                        content="SELLER_MESSAGE:\nCold start\n\nREASONING_TRACE:\nReasoning about cold start\n\nSUMMARY:\nACTION: restock | REASON: no history | CONFIDENCE: low"
                    )
                )
            ]
        )

    fake_claude.create = capture_create

    result = agent_core.run_agent_cycle("s1", "k1", "scheduled")

    assert result["seller_message"] == "Cold start"
    assert "Pricing cold start: True" in prompt
    assert "Forecast lambda source: prior" in prompt


def test_no_side_effects_on_parse_failure(fake_claude, monkeypatch):
    _seed_seller_and_sku()

    def malformed_create(**kwargs):
        return types.SimpleNamespace(
            choices=[
                types.SimpleNamespace(
                    message=types.SimpleNamespace(content="SELLER_MESSAGE:\nHi\n\nSUMMARY:\nACTION: price")
                )
            ]
        )

    monkeypatch.setattr(fake_claude, "create", malformed_create)
    monkeypatch.setattr(
        agent_core,
        "run_pricing_tool",
        lambda seller_state, rng_seed=None: {
            "chosen_price": 390,
            "updated_arms": [{"price_value": 390, "alpha": 3.0, "beta_param": 2.0, "times_chosen": 2}],
            "exploration_rationale": "pricing rationale",
            "chosen_arm_credible_interval": [0.2, 0.8],
            "cold_start": False,
        },
    )
    monkeypatch.setattr(
        agent_core,
        "run_forecasting_tool",
        lambda seller_state, n_simulations=500, rng_seed=None: {
            "severity": "watch",
            "p_stockout_5d": 0.2,
            "p_stockout_10d": 0.4,
            "forecast_summary": "forecast summary",
            "fan_chart": [],
            "confidence": "medium",
            "lambda_source": "estimated",
        },
    )

    with pytest.raises(agent_core.AgentCoreError):
        agent_core.run_agent_cycle("s1", "k1", "scheduled")

    sku = database.get_sku_by_id("k1")
    assert sku.current_chosen_price == 390
    assert database.get_last_agent_action("k1") is None


def test_last_agent_action_used_as_context(fake_claude):
    _seed_seller_and_sku()
    database.insert_agent_action(
        models.AgentAction(
            action_id=str(uuid.uuid4()),
            sku_id="k1",
            seller_id="s1",
            action_date=date.today(),
            tool_called="both",
            trigger="scheduled",
            chosen_price=390,
            stockout_probability_5d=0.2,
            stockout_probability_10d=0.4,
            stockout_severity="watch",
            seller_message="Previous message",
            reasoning_trace="Previous reasoning",
            delivered_via=None,
        )
    )

    agent_core.run_agent_cycle("s1", "k1", "user_message", "hello")

    prompt = next(
        message["content"]
        for message in fake_claude.calls[-1]["messages"]
        if message["role"] == "user"
    )
    assert "Last recommended price was Rs390" in prompt


@pytest.mark.integration
def test_real_provider_api_integration(monkeypatch):
    _seed_seller_and_sku()
    if not os.environ.get("SARVAM_API_KEY"):
        pytest.skip("SARVAM_API_KEY not set")

    try:
        from openai import OpenAI as OpenAIClient
    except ImportError:  # pragma: no cover - manual-only path
        pytest.skip("openai package is not installed")

    monkeypatch.setattr(agent_core, "OpenAI", OpenAIClient, raising=False)

    start = time.perf_counter()
    result = agent_core.run_agent_cycle("s1", "k1", "scheduled")
    elapsed = time.perf_counter() - start

    assert elapsed <= 5.0
    assert result["seller_message"]
    assert len(result["seller_message"]) < 600
    print(result["seller_message"])
    print(result["reasoning_trace"])
