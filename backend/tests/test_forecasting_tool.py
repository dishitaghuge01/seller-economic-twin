"""
test_forecasting_tool.py

Test suite for forecasting_tool.py (Component A - Statistical Core).
All tests use rng_seed=42, n_simulations=200 for speed, unless otherwise noted.
"""

import copy
import sys
import os
import time

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

import pytest
import numpy as np
from forecasting_tool import run_forecasting_tool


def _base_seller_state(**overrides):
    """
    Build a standard seller_state dict matching the frozen data contract,
    with 30 days of order history averaging ~1.4 units/day. Individual
    fields can be overridden via kwargs.
    """
    order_history = [
        {"date": f"2024-07-{13 - i:02d}", "units_sold": 2 if i % 2 == 0 else 1,
         "price_charged": 410, "margin": 260 if i % 2 == 0 else 130}
        for i in range(30)
    ]

    state = {
        "seller_id": "riya_sharma",
        "sku_id": "blue_kurti",
        "sku_name": "Blue Floral Kurti",
        "current_stock": 6,
        "reorder_point": 15,
        "unit_cost": 280,
        "price_floor": 370,
        "price_ceiling": 490,
        "order_history": order_history,
        "price_arms": [
            {"price_value": 370, "alpha": 2.0, "beta_param": 3.0, "times_chosen": 3},
            {"price_value": 390, "alpha": 4.0, "beta_param": 2.0, "times_chosen": 5},
            {"price_value": 410, "alpha": 6.0, "beta_param": 3.0, "times_chosen": 8},
            {"price_value": 430, "alpha": 4.0, "beta_param": 3.0, "times_chosen": 5},
            {"price_value": 450, "alpha": 2.0, "beta_param": 3.0, "times_chosen": 3},
            {"price_value": 470, "alpha": 2.0, "beta_param": 4.0, "times_chosen": 3},
            {"price_value": 490, "alpha": 1.0, "beta_param": 4.0, "times_chosen": 3},
        ],
        "yesterday_price": 410,
        "yesterday_units_sold": 2,
        "yesterday_margin": 260,
        "language_preference": "hi",
    }
    state.update(overrides)
    return state


def _history_with_constant_units(units_per_day, n_days=30):
    """Build an order_history list where every day sells exactly `units_per_day` units."""
    return [
        {"date": f"2024-07-{n_days - i:02d}", "units_sold": units_per_day,
         "price_charged": 410, "margin": 200}
        for i in range(n_days)
    ]


def test_certain_stockout():
    """current_stock=1 with lambda=20 (near-certain daily demand) should give
    p_stockout_5d ~= 1.0 and median_stockout_day == 1."""
    state = _base_seller_state(
        current_stock=1,
        order_history=_history_with_constant_units(20),
    )
    result = run_forecasting_tool(state, n_simulations=200, rng_seed=42)

    assert result["p_stockout_5d"] == pytest.approx(1.0, abs=0.01)
    assert result["median_stockout_day"] == 1


def test_no_stockout():
    """current_stock=10000 with lambda=1.0 should give p_stockout_30d < 0.01
    and severity='safe'; with never-crossed CI/median fields as None."""
    state = _base_seller_state(
        current_stock=10000,
        order_history=_history_with_constant_units(1),
    )
    result = run_forecasting_tool(state, n_simulations=200, rng_seed=42)

    assert result["p_stockout_30d"] < 0.01
    assert result["severity"] == "safe"
    assert result["median_stockout_day"] is None
    assert result["stockout_ci_low"] is None
    assert result["stockout_ci_high"] is None


def test_monotonic_fan_chart():
    """fan_chart must be monotonically non-decreasing."""
    state = _base_seller_state()
    result = run_forecasting_tool(state, n_simulations=200, rng_seed=42)
    fan = result["fan_chart"]
    for i in range(len(fan) - 1):
        assert fan[i]["p_stockout"] <= fan[i + 1]["p_stockout"]


def test_fan_chart_length():
    """fan_chart must have exactly 30 entries, days 1 through 30."""
    state = _base_seller_state()
    result = run_forecasting_tool(state, n_simulations=200, rng_seed=42)
    fan = result["fan_chart"]
    assert len(fan) == 30
    assert [entry["day"] for entry in fan] == list(range(1, 31))


def test_urgency_threshold():
    """current_stock=5, lambda=2.0 should deterministically run out fast -> 'urgent'."""
    state = _base_seller_state(
        current_stock=5,
        order_history=_history_with_constant_units(2),
    )
    result = run_forecasting_tool(state, n_simulations=200, rng_seed=42)
    assert result["severity"] == "urgent"


def test_safe_threshold():
    """current_stock=100, lambda=1.0 should classify as 'safe'."""
    state = _base_seller_state(
        current_stock=100,
        order_history=_history_with_constant_units(1),
    )
    result = run_forecasting_tool(state, n_simulations=200, rng_seed=42)
    assert result["severity"] == "safe"


def test_low_history():
    """3 days of order_history should give confidence='low' and a populated wide_band."""
    state = _base_seller_state(
        order_history=_history_with_constant_units(2, n_days=3),
    )
    result = run_forecasting_tool(state, n_simulations=200, rng_seed=42)

    assert result["confidence"] == "low"
    assert result["wide_band"] is not None
    assert "fan_chart_low_lambda" in result["wide_band"]
    assert "fan_chart_high_lambda" in result["wide_band"]


def test_medium_confidence():
    """10 days of order_history should give confidence='medium' (7-13 day range)."""
    state = _base_seller_state(
        order_history=_history_with_constant_units(2, n_days=10),
    )
    result = run_forecasting_tool(state, n_simulations=200, rng_seed=42)
    assert result["confidence"] == "medium"
    assert result["wide_band"] is None


def test_zero_history_cold_start():
    """Empty order_history (brand-new SKU, zero days of history) should trigger
    the lambda prior fallback, per the cold-start ruling."""
    state = _base_seller_state(order_history=[])
    result = run_forecasting_tool(state, n_simulations=200, rng_seed=42)

    assert result["lambda_source"] == "prior"
    assert result["lambda_estimated"] == 1.0
    assert result["confidence"] == "low"
    assert result["wide_band"] is not None


def test_ci_ordering():
    """stockout_ci_low <= median_stockout_day <= stockout_ci_high for cases
    with sufficient stock to not be certain or impossible."""
    states = [
        _base_seller_state(current_stock=6, order_history=_history_with_constant_units(1)),
        _base_seller_state(current_stock=15, order_history=_history_with_constant_units(2)),
        _base_seller_state(current_stock=30, order_history=_history_with_constant_units(3)),
    ]
    for state in states:
        result = run_forecasting_tool(state, n_simulations=200, rng_seed=42)
        ci_low = result["stockout_ci_low"]
        median = result["median_stockout_day"]
        ci_high = result["stockout_ci_high"]
        if ci_low is not None and median is not None and ci_high is not None:
            assert ci_low <= median <= ci_high


def test_output_schema():
    """All required keys must be present, all numeric values must be native
    Python types (no numpy scalar types)."""
    state = _base_seller_state()
    result = run_forecasting_tool(state, n_simulations=200, rng_seed=42)

    required_keys = {
        "lambda_estimated", "lambda_source", "starting_stock", "n_simulations",
        "fan_chart", "p_stockout_5d", "p_stockout_10d", "p_stockout_30d",
        "median_stockout_day", "stockout_ci_low", "stockout_ci_high",
        "severity", "confidence", "days_of_history", "forecast_summary",
        "wide_band",
    }
    assert required_keys.issubset(result.keys())

    assert isinstance(result["lambda_estimated"], float)
    assert isinstance(result["starting_stock"], int)
    assert isinstance(result["n_simulations"], int)
    assert isinstance(result["days_of_history"], int)
    assert isinstance(result["forecast_summary"], str)
    assert isinstance(result["fan_chart"], list)
    for entry in result["fan_chart"]:
        assert set(entry.keys()) == {"day", "p_stockout"}
        assert isinstance(entry["day"], int)
        assert isinstance(entry["p_stockout"], float)

    def _assert_no_numpy(obj):
        assert not isinstance(obj, (np.generic,)), f"numpy scalar leaked: {obj!r}"
        if isinstance(obj, dict):
            for kk, vv in obj.items():
                _assert_no_numpy(kk)
                _assert_no_numpy(vv)
        elif isinstance(obj, (list, tuple)):
            for item in obj:
                _assert_no_numpy(item)

    _assert_no_numpy(result)


def test_vectorised_speed():
    """500 simulations should run in well under 200ms, guarding against
    accidental de-vectorisation of the simulation loop."""
    state = _base_seller_state()
    start = time.perf_counter()
    run_forecasting_tool(state, n_simulations=500, rng_seed=42)
    elapsed_ms = (time.perf_counter() - start) * 1000
    assert elapsed_ms < 200


def test_no_mutation():
    """The input seller_state dict must not be mutated."""
    state = _base_seller_state()
    original = copy.deepcopy(state)

    run_forecasting_tool(state, n_simulations=200, rng_seed=42)

    assert state == original