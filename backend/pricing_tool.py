"""
pricing_tool.py

Component A - Statistical Core: Thompson Sampling multi-armed bandit pricing tool.

Pure, stateless module. Given a `seller_state` dict describing a single seller/SKU's
price history and current Thompson Sampling belief state, this module:

  1. Classifies yesterday's outcome (success/failure, relative to the running
     median margin) and updates the relevant price arm's Beta(alpha, beta_param)
     parameters accordingly.
  2. Samples from each arm's Beta posterior and selects the arm with the highest
     sampled value (Thompson Sampling selection).
  3. Estimates price sensitivity (beta) via a logistic-regression-style fit on
     historical (price, sell-through-rate) pairs, for reporting purposes only
     (it does NOT drive the bandit's selection decision).
  4. Computes a multinomial-logit-based expected margin at the chosen price,
     using a heuristic placeholder for competitor prices.
  5. Builds a human-readable rationale string for the Agent Core's LLM prompt.

This module has no side effects: it does not read from or write to any database,
does not call any API, and does not mutate its `seller_state` input. The caller
(Agent Core) is responsible for persisting `updated_arms` and `chosen_price`.

Requires only numpy and scipy.
"""

import numpy as np
from scipy import stats
from typing import Optional


_REQUIRED_KEYS = [
    "seller_id",
    "sku_id",
    "sku_name",
    "current_stock",
    "reorder_point",
    "unit_cost",
    "price_floor",
    "price_ceiling",
    "order_history",
    "price_arms",
]

_PRIOR_BETA = 0.008


def run_pricing_tool(seller_state: dict, rng_seed: Optional[int] = None) -> dict:
    """
    Run one cycle of the Thompson Sampling pricing agent.

    Args:
        seller_state: The standardised seller_state dictionary (see data contract).
        rng_seed: Optional integer seed for reproducibility in tests.
                  In production, pass None (uses system entropy).

    Returns:
        A pricing_result dictionary with the following keys:
            chosen_price (int): the price to set today.
            chosen_arm_index (int): 0-based index of the chosen arm in updated_arms.
            chosen_theta (float): the sampled theta value that caused this arm
                to be selected.
            all_theta_samples (dict[int, float]): every arm's sampled theta this
                cycle, keyed by price.
            updated_arms (list[dict]): arm parameters after incorporating
                yesterday's outcome. The Agent Core writes these back to the
                price_arms database table.
            yesterday_classified_as (str): "success" | "failure" | "no_data".
            yesterday_margin (float | None): passthrough of yesterday's margin.
            running_median_margin (float): running median of historical margins
                used for success/failure classification.
            estimated_beta (float): estimated price-sensitivity coefficient.
            beta_source (str): "estimated" | "prior" | "prior_fallback".
                - "prior": fewer than 7 days of history exist, so the calibrated
                  prior of 0.008 is used directly.
                - "estimated": regression succeeded and produced a usable
                  (negative) slope.
                - "prior_fallback": regression ran (>=7 days of history) but
                  returned a non-negative or non-finite slope, so the function
                  fell back to the calibrated prior of 0.008.
            expected_margin_at_chosen_price (float): expected margin per visitor
                at the chosen price, per the logit model (reporting only).
            chosen_arm_credible_interval (list[float]): [2.5th, 97.5th]
                percentile of the chosen arm's Beta(alpha, beta_param).
            exploration_rationale (str): human-readable rationale for the
                Agent Core's LLM prompt.
            cold_start (bool): True if fewer than 7 days of history.
            days_of_history (int): number of order_history entries.

    Side effects:
        NONE. This function is pure. It does not write to any database.
        The caller (Agent Core) is responsible for persisting the
        returned updated_arms to the database.
    """
    rng = np.random.default_rng(rng_seed)

    _validate_seller_state(seller_state)

    order_history = seller_state["order_history"]
    price_arms = seller_state["price_arms"]
    unit_cost = seller_state["unit_cost"]
    yesterday_price = seller_state.get("yesterday_price")
    yesterday_margin = seller_state.get("yesterday_margin")

    # --- Step 1: Running median margin (needed for success classification) ---
    all_historical_margins = [
        d["margin"] for d in order_history if d.get("margin") is not None
    ]
    running_median = (
        float(np.median(all_historical_margins)) if all_historical_margins else 0.0
    )

    # --- Step 2: Classify yesterday's outcome and prepare arm updates ---
    updated_arms = [dict(arm) for arm in price_arms]  # deep-enough copy (no mutation)
    yesterday_classification = "no_data"

    if yesterday_price is not None and yesterday_margin is not None:
        yesterday_classification = (
            "success" if yesterday_margin >= running_median else "failure"
        )
        for arm in updated_arms:
            if arm["price_value"] == yesterday_price:
                if yesterday_classification == "success":
                    arm["alpha"] = arm["alpha"] + 1.0
                else:
                    arm["beta_param"] = arm["beta_param"] + 1.0
                arm["times_chosen"] = arm.get("times_chosen", 0) + 1
                break

    # --- Step 3: Thompson Sampling selection ---
    theta_samples = {}
    for arm in updated_arms:
        theta_samples[arm["price_value"]] = float(
            rng.beta(arm["alpha"], arm["beta_param"])
        )
    chosen_price = max(theta_samples, key=theta_samples.get)
    chosen_arm_index = next(
        i for i, a in enumerate(updated_arms) if a["price_value"] == chosen_price
    )

    # --- Step 4: Estimate beta (price sensitivity) ---
    estimated_beta, beta_source = _estimate_beta(order_history, unit_cost)

    # --- Step 5: Compute credible interval for chosen arm ---
    chosen_arm = updated_arms[chosen_arm_index]
    ci_low = float(stats.beta.ppf(0.025, chosen_arm["alpha"], chosen_arm["beta_param"]))
    ci_high = float(stats.beta.ppf(0.975, chosen_arm["alpha"], chosen_arm["beta_param"]))

    # --- Step 6: Compute expected margin at chosen price via logit model ---
    competitor_prices = _estimate_competitor_prices(order_history, chosen_price)
    expected_margin = _logit_expected_margin(
        chosen_price, unit_cost, competitor_prices, estimated_beta
    )

    # --- Step 7: Build exploration rationale string ---
    rationale = _build_rationale(chosen_price, theta_samples, updated_arms, chosen_arm_index)

    # --- Step 8: Assemble output, casting away all numpy scalar types ---
    updated_arms_out = [
        {
            "price_value": int(arm["price_value"]),
            "alpha": float(arm["alpha"]),
            "beta_param": float(arm["beta_param"]),
            "times_chosen": int(arm.get("times_chosen", 0)),
        }
        for arm in updated_arms
    ]

    return {
        "chosen_price": int(chosen_price),
        "chosen_arm_index": int(chosen_arm_index),
        "chosen_theta": round(float(theta_samples[chosen_price]), 4),
        "all_theta_samples": {int(k): round(float(v), 4) for k, v in theta_samples.items()},
        "updated_arms": updated_arms_out,
        "yesterday_classified_as": yesterday_classification,
        "yesterday_margin": None if yesterday_margin is None else float(yesterday_margin),
        "running_median_margin": round(running_median, 2),
        "estimated_beta": round(float(estimated_beta), 5),
        "beta_source": beta_source,
        "expected_margin_at_chosen_price": round(float(expected_margin), 4),
        "chosen_arm_credible_interval": [round(ci_low, 3), round(ci_high, 3)],
        "exploration_rationale": rationale,
        "cold_start": len(order_history) < 7,
        "days_of_history": int(len(order_history)),
    }


def _validate_seller_state(state: dict) -> None:
    """
    Validate the seller_state dict for the pricing tool.

    Raises ValueError if:
      - any required key is missing.
      - price_floor >= price_ceiling.
      - any arm's price_value falls outside [price_floor, price_ceiling].
      - the set of arm price_values does not exactly match the Rs-20 grid
        implied by price_floor/price_ceiling (range(floor, ceiling+1, 20));
        the error message names the missing and/or extra prices. Reconciling
        the arm grid (adding new arms, archiving removed ones) is a persistence
        concern owned by the database layer / Agent Core, not this stateless
        function -- so a mismatch is treated as an invalid input, not something
        to silently repair.
      - any arm's alpha or beta_param is below 1.0 (a Beta distribution with
        shape parameter below 1 has undefined moments).

    Does not raise on missing optional keys (yesterday_price, yesterday_units_sold,
    yesterday_margin) since these are legitimately absent on a seller's first run.
    """
    missing = [k for k in _REQUIRED_KEYS if k not in state]
    if missing:
        raise ValueError(f"seller_state is missing required keys: {missing}")

    price_floor = state["price_floor"]
    price_ceiling = state["price_ceiling"]
    if price_floor >= price_ceiling:
        raise ValueError(
            f"price_floor ({price_floor}) must be strictly less than "
            f"price_ceiling ({price_ceiling})"
        )

    price_arms = state["price_arms"]
    arm_prices = [arm["price_value"] for arm in price_arms]

    out_of_bounds = [p for p in arm_prices if p < price_floor or p > price_ceiling]
    if out_of_bounds:
        raise ValueError(
            f"price_arms contains prices outside [price_floor, price_ceiling] "
            f"({price_floor}, {price_ceiling}): {out_of_bounds}"
        )

    expected_grid = list(range(price_floor, price_ceiling + 1, 20))
    expected_set = set(expected_grid)
    actual_set = set(arm_prices)
    if expected_set != actual_set:
        missing_prices = sorted(expected_set - actual_set)
        extra_prices = sorted(actual_set - expected_set)
        raise ValueError(
            "price_arms does not match the expected Rs-20 grid derived from "
            f"price_floor/price_ceiling ({price_floor}-{price_ceiling}). "
            f"Expected grid: {expected_grid}. "
            f"Missing prices: {missing_prices}. Extra prices: {extra_prices}."
        )

    for arm in price_arms:
        if arm["alpha"] < 1.0 or arm["beta_param"] < 1.0:
            raise ValueError(
                f"Arm at price {arm['price_value']} has alpha={arm['alpha']} "
                f"and beta_param={arm['beta_param']}; both must be >= 1.0 "
                "(a Beta distribution with shape parameter below 1 has "
                "undefined moments)."
            )


def _estimate_beta(order_history: list, unit_cost) -> tuple:
    """
    Estimate the price-sensitivity coefficient (beta) for the multinomial logit
    demand model via a logistic-regression-style fit on historical
    (price_charged, sell-through-rate) pairs.

    Daily traffic is approximated as a constant equal to 3x the maximum
    units_sold observed in the window (a conservative assumption). X is the
    price values; y is units_sold / estimated_daily_traffic as proportions,
    clipped to [0.001, 0.999] to keep the logit defined. scipy.stats.linregress
    is fit on (X, logit(y)); the negative of the slope is returned as beta
    (negative because higher price -> lower conversion is expected).

    Returns a (estimated_beta, beta_source) tuple where beta_source is one of:
      - "prior": fewer than 7 days of order history exist, so the calibrated
        prior of 0.008 is used directly.
      - "estimated": regression succeeded and produced a usable (negative) slope.
      - "prior_fallback": regression ran (>=7 days of history) but a usable
        coefficient could not be produced -- e.g. because the slope was
        non-negative or non-finite, because all recorded sales were zero
        (making the sell-through denominator degenerate), or because every
        historical order was charged the same price (no price variance to
        regress against) -- so the function falls back to the calibrated
        prior of 0.008.
    """
    if len(order_history) < 7:
        return _PRIOR_BETA, "prior"

    prices = np.array([d["price_charged"] for d in order_history], dtype=float)
    units = np.array([d["units_sold"] for d in order_history], dtype=float)

    max_units = float(np.max(units)) if units.size > 0 else 0.0
    daily_traffic = 3.0 * max_units

    if daily_traffic <= 0:
        # Degenerate case: no sales recorded in the window at all, so there is
        # no usable traffic denominator to fit a sell-through rate against.
        return _PRIOR_BETA, "prior_fallback"

    if float(np.max(prices)) == float(np.min(prices)):
        # Degenerate case: every historical order was charged the same price,
        # so there is no price variation to regress against (linregress is
        # undefined when all x-values are identical). No usable coefficient
        # can be estimated, so fall back to the prior.
        return _PRIOR_BETA, "prior_fallback"

    sell_through = np.clip(units / daily_traffic, 0.001, 0.999)
    logit_y = np.log(sell_through / (1.0 - sell_through))

    slope, intercept, r_value, p_value, std_err = stats.linregress(prices, logit_y)

    if not np.isfinite(slope) or slope >= 0:
        return _PRIOR_BETA, "prior_fallback"

    return float(-slope), "estimated"


def _estimate_competitor_prices(order_history: list, our_price) -> list:
    """
    Heuristic placeholder for competitor price estimation.

    Real competitor prices are not directly observable in this prototype. This
    function constructs four symmetric synthetic competitor prices at
    our_price + [-30, -15, +15, +30] rupees, clamped to a reasonable range
    [200, 800]. This is a placeholder for a real competitor monitoring system.
    The logit model output that uses these prices is for reporting only (it
    does not drive the bandit's selection decision), so this heuristic does
    not affect the correctness of the pricing decision itself.
    """
    offsets = [-30, -15, 15, 30]
    return [float(min(800, max(200, our_price + o))) for o in offsets]


def _logit_expected_margin(our_price, unit_cost, competitor_prices: list, beta: float) -> float:
    """
    Compute expected margin per visitor at `our_price` under the multinomial
    logit choice model:

        P(choose us) = exp(-beta * our_price) / (1 + sum_j exp(-beta * price_j))

    where price_j ranges over estimated competitor prices and the "+1" in the
    denominator represents the outside option (buyer purchases nothing).

    Expected margin per visitor = (our_price - unit_cost) * P(choose us).

    Returns a float (rupees).
    """
    numerator = np.exp(-beta * our_price)
    denom = 1.0 + sum(np.exp(-beta * p) for p in competitor_prices)
    p_choose_us = numerator / denom
    return float((our_price - unit_cost) * p_choose_us)


def _build_rationale(chosen_price, theta_samples: dict, arms: list, chosen_idx: int) -> str:
    """
    Build a human-readable rationale string explaining why the chosen arm was
    selected by Thompson Sampling this cycle. Includes the chosen price, its
    sampled theta, its alpha/beta_param, its posterior mean, and the
    second-best arm for comparison. This string is passed directly into the
    Agent Core's prompt as part of the tool output section.
    """
    chosen_arm = arms[chosen_idx]
    alpha = chosen_arm["alpha"]
    beta_param = chosen_arm["beta_param"]
    times_chosen = chosen_arm.get("times_chosen", 0)
    posterior_mean = alpha / (alpha + beta_param)

    sorted_prices = sorted(theta_samples, key=theta_samples.get, reverse=True)

    rationale = (
        f"Arm Rs{chosen_price} had the highest sampled belief value "
        f"({theta_samples[chosen_price]:.3f}) this cycle. "
        f"It has been tried {times_chosen} times "
        f"(alpha={alpha:.1f}, beta={beta_param:.1f}), giving a posterior mean "
        f"conversion rate of {posterior_mean:.2f}."
    )

    if len(sorted_prices) > 1:
        second_price = sorted_prices[1]
        rationale += (
            f" Rs{second_price} was the next closest "
            f"({theta_samples[second_price]:.3f}) and may be selected in a "
            f"future cycle as exploration continues."
        )

    return rationale