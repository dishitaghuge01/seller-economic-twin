"""
test_pricing_tool.py

Test suite for pricing_tool.py (Component A - Statistical Core).
All tests use rng_seed=42 for reproducibility unless otherwise noted.
"""

import copy
import sys
import os

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

import pytest
from pricing_tool import run_pricing_tool


def _base_seller_state(**overrides):
    """
    Build a standard seller_state dict matching the frozen data contract,
    with 30 days of order history and the standard 7-arm grid (floor=370,
    ceiling=490). Individual fields can be overridden via kwargs.
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


def test_basic_selection():
    """
    Arm with (alpha=10, beta=2) should be selected far more often than the arm
    with (alpha=2, beta=10) across 100 independent cycles.
    """
    state = _base_seller_state(
        price_floor=370,
        price_ceiling=410,
        price_arms=[
            {"price_value": 370, "alpha": 10.0, "beta_param": 2.0, "times_chosen": 12},
            {"price_value": 390, "alpha": 5.0, "beta_param": 5.0, "times_chosen": 10},
            {"price_value": 410, "alpha": 2.0, "beta_param": 10.0, "times_chosen": 12},
        ],
        yesterday_price=None,
        yesterday_units_sold=None,
        yesterday_margin=None,
    )

    chosen_counts = {370: 0, 390: 0, 410: 0}
    n_runs = 100
    for i in range(n_runs):
        result = run_pricing_tool(state, rng_seed=42 + i)
        chosen_counts[result["chosen_price"]] += 1

    assert chosen_counts[370] / n_runs >= 0.60


def test_cold_start():
    """Empty order_history and yesterday_price=None should trigger cold-start behavior."""
    state = _base_seller_state(
        order_history=[],
        yesterday_price=None,
        yesterday_units_sold=None,
        yesterday_margin=None,
    )
    result = run_pricing_tool(state, rng_seed=42)

    assert result["cold_start"] is True
    assert result["beta_source"] == "prior"
    assert result["estimated_beta"] == 0.008
    assert result["yesterday_classified_as"] == "no_data"


def test_belief_update_success():
    """yesterday_margin >= running_median should classify as success and increment alpha by 1."""
    order_history = [
        {"date": f"2024-07-{i+1:02d}", "units_sold": 2, "price_charged": 410, "margin": 300}
        for i in range(10)
    ]
    state = _base_seller_state(
        order_history=order_history,
        yesterday_price=410,
        yesterday_units_sold=2,
        yesterday_margin=500,
    )
    original_alpha = next(
        a["alpha"] for a in state["price_arms"] if a["price_value"] == 410
    )

    result = run_pricing_tool(state, rng_seed=42)

    assert result["running_median_margin"] == 300.0
    assert result["yesterday_classified_as"] == "success"
    updated_alpha = next(
        a["alpha"] for a in result["updated_arms"] if a["price_value"] == 410
    )
    assert updated_alpha == pytest.approx(original_alpha + 1.0)


def test_belief_update_failure():
    """yesterday_margin < running_median should classify as failure and increment beta_param by 1."""
    order_history = [
        {"date": f"2024-07-{i+1:02d}", "units_sold": 2, "price_charged": 410, "margin": 300}
        for i in range(10)
    ]
    state = _base_seller_state(
        order_history=order_history,
        yesterday_price=410,
        yesterday_units_sold=2,
        yesterday_margin=100,
    )
    original_beta_param = next(
        a["beta_param"] for a in state["price_arms"] if a["price_value"] == 410
    )

    result = run_pricing_tool(state, rng_seed=42)

    assert result["running_median_margin"] == 300.0
    assert result["yesterday_classified_as"] == "failure"
    updated_beta_param = next(
        a["beta_param"] for a in result["updated_arms"] if a["price_value"] == 410
    )
    assert updated_beta_param == pytest.approx(original_beta_param + 1.0)


def test_floor_ceiling_respected():
    """chosen_price must always be within the grid derived from floor/ceiling."""
    state = _base_seller_state(
        price_floor=390,
        price_ceiling=450,
        price_arms=[
            {"price_value": 390, "alpha": 2.0, "beta_param": 3.0, "times_chosen": 3},
            {"price_value": 410, "alpha": 4.0, "beta_param": 2.0, "times_chosen": 5},
            {"price_value": 430, "alpha": 3.0, "beta_param": 3.0, "times_chosen": 5},
            {"price_value": 450, "alpha": 2.0, "beta_param": 4.0, "times_chosen": 3},
        ],
        yesterday_price=410,
    )
    allowed = {390, 410, 430, 450}
    for seed in range(50):
        result = run_pricing_tool(state, rng_seed=seed)
        assert result["chosen_price"] in allowed


def test_invalid_floor_ceiling():
    """Inverted floor/ceiling (floor >= ceiling) must raise ValueError."""
    state = _base_seller_state(price_floor=490, price_ceiling=370)
    with pytest.raises(ValueError):
        run_pricing_tool(state, rng_seed=42)


def test_arm_grid_mismatch_raises():
    """
    price_arms whose price_values don't exactly match the Rs-20 grid derived
    from price_floor/price_ceiling must raise ValueError (per ruling: this
    stateless function does not reconcile/repair the arm grid itself).
    """
    state = _base_seller_state(
        price_floor=370,
        price_ceiling=490,
        # Missing the 430 arm from the expected 7-arm grid.
        price_arms=[
            {"price_value": 370, "alpha": 2.0, "beta_param": 3.0, "times_chosen": 3},
            {"price_value": 390, "alpha": 4.0, "beta_param": 2.0, "times_chosen": 5},
            {"price_value": 410, "alpha": 6.0, "beta_param": 3.0, "times_chosen": 8},
            {"price_value": 450, "alpha": 2.0, "beta_param": 3.0, "times_chosen": 3},
            {"price_value": 470, "alpha": 2.0, "beta_param": 4.0, "times_chosen": 3},
            {"price_value": 490, "alpha": 1.0, "beta_param": 4.0, "times_chosen": 3},
        ],
    )
    with pytest.raises(ValueError):
        run_pricing_tool(state, rng_seed=42)


def test_output_schema():
    """All required keys must be present, all numeric values must be native
    Python types (no numpy scalar types)."""
    state = _base_seller_state()
    result = run_pricing_tool(state, rng_seed=42)

    required_keys = {
        "chosen_price", "chosen_arm_index", "chosen_theta", "all_theta_samples",
        "updated_arms", "yesterday_classified_as", "yesterday_margin",
        "running_median_margin", "estimated_beta", "beta_source",
        "expected_margin_at_chosen_price", "chosen_arm_credible_interval",
        "exploration_rationale", "cold_start", "days_of_history",
    }
    assert required_keys.issubset(result.keys())

    assert isinstance(result["chosen_price"], int)
    assert isinstance(result["chosen_arm_index"], int)
    assert isinstance(result["chosen_theta"], float)
    assert isinstance(result["days_of_history"], int)
    assert isinstance(result["cold_start"], bool)
    assert isinstance(result["running_median_margin"], float)
    assert isinstance(result["estimated_beta"], float)
    assert isinstance(result["expected_margin_at_chosen_price"], float)

    for k, v in result["all_theta_samples"].items():
        assert isinstance(k, int)
        assert isinstance(v, float)

    for arm in result["updated_arms"]:
        assert isinstance(arm["price_value"], int)
        assert isinstance(arm["alpha"], float)
        assert isinstance(arm["beta_param"], float)
        assert isinstance(arm["times_chosen"], int)

    assert isinstance(result["chosen_arm_credible_interval"], list)
    assert len(result["chosen_arm_credible_interval"]) == 2
    for v in result["chosen_arm_credible_interval"]:
        assert isinstance(v, float)

    # Guard against numpy scalar types slipping through anywhere.
    import numpy as np

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


def test_exploration_rationale_is_string():
    """exploration_rationale must be a non-empty string containing the chosen price."""
    state = _base_seller_state()
    result = run_pricing_tool(state, rng_seed=42)

    assert isinstance(result["exploration_rationale"], str)
    assert len(result["exploration_rationale"]) > 0
    assert str(result["chosen_price"]) in result["exploration_rationale"]


def test_credible_interval_ordering():
    """chosen_arm_credible_interval[0] must be strictly less than [1]."""
    states = [
        _base_seller_state(),
        _base_seller_state(price_floor=390, price_ceiling=450, price_arms=[
            {"price_value": 390, "alpha": 1.0, "beta_param": 1.0, "times_chosen": 0},
            {"price_value": 410, "alpha": 1.0, "beta_param": 1.0, "times_chosen": 0},
            {"price_value": 430, "alpha": 1.0, "beta_param": 1.0, "times_chosen": 0},
            {"price_value": 450, "alpha": 1.0, "beta_param": 1.0, "times_chosen": 0},
        ], yesterday_price=None, yesterday_units_sold=None, yesterday_margin=None),
    ]
    for state in states:
        for seed in range(5):
            result = run_pricing_tool(state, rng_seed=seed)
            ci = result["chosen_arm_credible_interval"]
            assert ci[0] < ci[1]


def test_no_mutation():
    """The input seller_state dict (and its nested price_arms list) must not be mutated."""
    state = _base_seller_state()
    original = copy.deepcopy(state)

    run_pricing_tool(state, rng_seed=42)

    assert state == original