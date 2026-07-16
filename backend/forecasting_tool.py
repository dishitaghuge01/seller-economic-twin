"""
forecasting_tool.py

Component A - Statistical Core: Monte Carlo inventory forecasting tool.

Pure, stateless module. Given a `seller_state` dict describing a single
seller/SKU's current stock and recent order history, this module:

  1. Estimates a Poisson daily-demand rate (lambda) from order history.
  2. Runs a vectorised Monte Carlo simulation (default 500 paths, 30 days
     each) of future demand to determine when stock is likely to hit zero.
  3. Builds a "fan chart": the empirical probability of stockout by each of
     the next 30 days.
  4. Derives summary statistics (median stockout day, 80% confidence
     interval, severity classification) from the fan chart.
  5. For low-confidence forecasts (little order history), also produces a
     widened low/high-lambda band so the Agent Core can communicate
     uncertainty honestly instead of a false-precision point estimate.

This module has no side effects: it does not read from or write to any
database, does not call any API, and does not mutate its `seller_state`
input. Requires only numpy.
"""

import numpy as np
from typing import Optional


_LAMBDA_PRIOR = 1.0  # Placeholder default for the zero-history case only.
                      # Not a calibrated constant (unlike pricing_tool's beta
                      # prior) -- there is no equivalent calibration study for
                      # demand rate. It exists purely so a brand-new SKU with
                      # literally no sales data yet has something to simulate
                      # against ("assume modest steady demand until real data
                      # exists"), and it is always paired with confidence="low".


def run_forecasting_tool(seller_state: dict, n_simulations: int = 500,
                          rng_seed: Optional[int] = None) -> dict:
    """
    Run Monte Carlo inventory forecasting for a single SKU.

    Args:
        seller_state: The standardised seller_state dictionary.
        n_simulations: Number of Monte Carlo paths. Default 500.
                       Can be set lower (e.g. 200) in tests for speed.
        rng_seed: Optional integer for reproducibility.

    Returns:
        A forecast_result dictionary with the following keys:
            lambda_estimated (float): estimated Poisson daily-demand rate.
            lambda_source (str): "estimated" | "prior".
                - "estimated": at least 1 day of order history exists, so
                  lambda is the sample mean of units_sold across whatever
                  history is available (1 to 30 days). This is the case for
                  every seller with any sales data at all, even a single day
                  -- low-data uncertainty is communicated via `confidence`
                  and `wide_band`, NOT by switching to a fallback value.
                - "prior": order_history is completely empty (zero days --
                  a brand-new SKU with no sales yet). There is nothing to
                  average, so lambda_estimated falls back to the placeholder
                  default of 1.0 (see _LAMBDA_PRIOR). This is the only case
                  in which "prior" occurs.
            starting_stock (int): current_stock at time of forecast.
            n_simulations (int): number of simulations run.
            fan_chart (list[dict]): [{"day": 1..30, "p_stockout": float}, ...],
                the empirical CDF of simulated stockout days.
            p_stockout_5d / p_stockout_10d / p_stockout_30d (float):
                probability of stockout by day 5 / 10 / 30.
            median_stockout_day (int | None): day at which cumulative
                stockout probability first reaches 0.50, or None if it
                never does within the 30-day simulation window.
            stockout_ci_low (int | None): day at which probability first
                reaches 0.10, or None if it never does.
            stockout_ci_high (int | None): day at which probability first
                reaches 0.90, or None if it never does.
            severity (str): "urgent" | "watch" | "safe".
            confidence (str): "high" | "medium" | "low", based on days of
                history: < 7 days = "low", 7-13 days = "medium",
                14+ days = "high".
            days_of_history (int): number of order_history entries.
            forecast_summary (str): human-readable summary for the Agent
                Core's LLM prompt.
            wide_band (dict | None): None unless confidence == "low", in
                which case {"fan_chart_low_lambda": [...],
                "fan_chart_high_lambda": [...]} using lambda * 0.5 / * 1.5.

    Side effects:
        NONE. Pure function.
    """
    rng = np.random.default_rng(rng_seed)

    _validate_forecasting_inputs(seller_state)

    order_history = seller_state["order_history"]
    current_stock = seller_state["current_stock"]
    days_of_history = len(order_history)

    # --- Step 1: Estimate lambda ---
    lambda_est, lambda_source, confidence = _estimate_lambda(order_history)

    # --- Step 2: Run Monte Carlo simulations ---
    stockout_days = _run_simulations(rng, lambda_est, current_stock, n_simulations)

    # --- Step 3: Build fan chart ---
    fan_chart = _build_fan_chart(stockout_days, n_simulations)

    # --- Step 4: Compute summary statistics ---
    p_5d = fan_chart[4]["p_stockout"]
    p_10d = fan_chart[9]["p_stockout"]
    p_30d = fan_chart[29]["p_stockout"]

    median_day = _find_day_crossing(fan_chart, 0.50)
    ci_low_day = _find_day_crossing(fan_chart, 0.10)
    ci_high_day = _find_day_crossing(fan_chart, 0.90)

    severity = _classify_severity(fan_chart)

    # --- Step 5: Wide band for low-confidence forecasts ---
    wide_band = None
    if confidence == "low":
        wide_band = {
            "fan_chart_low_lambda": _build_fan_chart(
                _run_simulations(rng, lambda_est * 0.5, current_stock, n_simulations),
                n_simulations,
            ),
            "fan_chart_high_lambda": _build_fan_chart(
                _run_simulations(rng, lambda_est * 1.5, current_stock, n_simulations),
                n_simulations,
            ),
        }

    # --- Step 6: Build summary string ---
    summary = _build_forecast_summary(
        lambda_est, days_of_history, current_stock,
        n_simulations, median_day, ci_low_day, ci_high_day, p_5d, severity,
    )

    return {
        "lambda_estimated": round(float(lambda_est), 3),
        "lambda_source": lambda_source,
        "starting_stock": int(current_stock),
        "n_simulations": int(n_simulations),
        "fan_chart": fan_chart,
        "p_stockout_5d": round(float(p_5d), 4),
        "p_stockout_10d": round(float(p_10d), 4),
        "p_stockout_30d": round(float(p_30d), 4),
        "median_stockout_day": median_day,
        "stockout_ci_low": ci_low_day,
        "stockout_ci_high": ci_high_day,
        "severity": severity,
        "confidence": confidence,
        "days_of_history": int(days_of_history),
        "forecast_summary": summary,
        "wide_band": wide_band,
    }


def _validate_forecasting_inputs(state: dict) -> None:
    """
    Validate the seller_state dict for the forecasting tool.

    Raises ValueError if:
      - "current_stock" or "order_history" is missing.
      - current_stock is negative (stock cannot be negative).
      - order_history is not a list, or any entry is missing "units_sold".

    Does not validate pricing-specific keys (price_floor, price_ceiling,
    price_arms, etc.) since the forecasting tool never reads them.
    """
    for key in ("current_stock", "order_history"):
        if key not in state:
            raise ValueError(f"seller_state is missing required key: '{key}'")

    if state["current_stock"] < 0:
        raise ValueError(
            f"current_stock ({state['current_stock']}) cannot be negative."
        )

    order_history = state["order_history"]
    if not isinstance(order_history, list):
        raise ValueError("order_history must be a list.")

    for entry in order_history:
        if "units_sold" not in entry:
            raise ValueError(
                f"order_history entry is missing 'units_sold': {entry}"
            )


def _estimate_lambda(order_history: list) -> tuple:
    """
    Estimate the Poisson daily-demand rate (lambda) from order history.

    Returns a (lambda_estimated, lambda_source, confidence) tuple:
      - If order_history has zero entries (a brand-new SKU with no sales
        data at all), lambda_source="prior" and lambda_estimated falls back
        to the placeholder default _LAMBDA_PRIOR (1.0 unit/day). This is the
        only case in which lambda_source is "prior".
      - Otherwise (>= 1 day of history), lambda_source="estimated" and
        lambda_estimated is the sample mean of units_sold across whatever
        history is available -- the maximum likelihood estimator for a
        Poisson rate parameter.

    confidence is based purely on the amount of history available:
      - < 7 days: "low"
      - 7-13 days: "medium"
      - 14+ days: "high"
    (This applies uniformly, including at zero days, which is always "low".)
    """
    days_of_history = len(order_history)

    if days_of_history == 0:
        lambda_est = _LAMBDA_PRIOR
        lambda_source = "prior"
    else:
        units = np.array([d["units_sold"] for d in order_history], dtype=float)
        lambda_est = float(np.mean(units))
        lambda_source = "estimated"

    if days_of_history < 7:
        confidence = "low"
    elif days_of_history <= 13:
        confidence = "medium"
    else:
        confidence = "high"

    return lambda_est, lambda_source, confidence


def _run_simulations(rng, lambda_est: float, current_stock, n_simulations: int):
    """
    Vectorised Monte Carlo: runs all simulations simultaneously using numpy.

    For each of n_simulations independent paths, draws 30 days of Poisson(lambda)
    demand, and finds the first day on which cumulative demand reaches
    current_stock (stockout). Simulations that never reach current_stock within
    30 days are marked with stockout_day = np.inf.

    Returns a numpy array of length n_simulations: the (1-indexed) stockout day
    for each simulation, or np.inf if no stockout occurred within 30 days.
    """
    n_days = 30
    # Shape: (n_simulations, n_days)
    daily_demand = rng.poisson(lam=lambda_est, size=(n_simulations, n_days))
    cumulative_demand = np.cumsum(daily_demand, axis=1)
    # For each simulation, find the first day cumulative demand >= current_stock
    stockout_mask = cumulative_demand >= current_stock
    # argmax returns the index of the first True; if no True, returns 0
    first_stockout_col = np.argmax(stockout_mask, axis=1)
    # Correct for simulations that never stock out
    never_stockout = ~stockout_mask.any(axis=1)
    stockout_days = first_stockout_col + 1  # convert to 1-indexed day
    stockout_days = stockout_days.astype(float)
    stockout_days[never_stockout] = np.inf
    return stockout_days


def _build_fan_chart(stockout_days, n_simulations: int) -> list:
    """
    Build the fan chart: for each day 1 through 30, the empirical probability
    (fraction of simulations) that stockout occurred by that day.

    Returns a list of 30 dicts: [{"day": 1, "p_stockout": 0.002}, ...].
    """
    fan = []
    for day in range(1, 31):
        p = float(np.sum(stockout_days <= day) / n_simulations)
        fan.append({"day": day, "p_stockout": round(p, 4)})
    return fan


def _find_day_crossing(fan_chart: list, threshold: float):
    """
    Find the first day (1-indexed) at which fan_chart's cumulative stockout
    probability reaches or exceeds `threshold`.

    Returns the day (int) if found, or None if the probability never reaches
    the threshold within the 30-day simulation window (e.g. a well-stocked
    seller who is very unlikely to stock out at all in this window).
    """
    for entry in fan_chart:
        if entry["p_stockout"] >= threshold:
            return int(entry["day"])
    return None


def _classify_severity(fan_chart: list) -> str:
    """
    Classify severity based on the fan chart:
      - "urgent": P(stockout by day 7) >= 0.50.
      - "watch": P(stockout by day 14) >= 0.50 (and day-7 threshold not met).
      - "safe": P(stockout by day 14) < 0.50.
    """
    p_day7 = fan_chart[6]["p_stockout"]
    p_day14 = fan_chart[13]["p_stockout"]

    if p_day7 >= 0.50:
        return "urgent"
    if p_day14 >= 0.50:
        return "watch"
    return "safe"


def _build_forecast_summary(lambda_est, days_of_history, current_stock,
                             n_simulations, median_day, ci_low_day, ci_high_day,
                             p_5d, severity) -> str:
    """
    Build a human-readable forecast summary string for the Agent Core's LLM
    prompt, describing the simulation setup, the expected stockout timing
    (or lack thereof), and the severity classification.
    """
    base = (
        f"Based on {n_simulations} simulated demand paths using a Poisson "
        f"model with \u03bb={lambda_est:.2f} orders/day (estimated from "
        f"{days_of_history} days of history), current stock of {current_stock} "
        f"units "
    )

    if median_day is None:
        base += "is not expected to run out within the next 30 days. "
    else:
        base += f"will most likely run out by Day {median_day} (50th percentile). "

    if ci_low_day is not None and ci_high_day is not None:
        base += (
            f"There is an 80% chance of stockout between Days {ci_low_day} "
            f"and {ci_high_day}. "
        )
    elif ci_low_day is not None and ci_high_day is None:
        base += (
            f"There is at least a 10% chance of stockout by Day {ci_low_day}, "
            f"but the upper bound of the 80% interval falls beyond the "
            f"30-day forecast window. "
        )
    else:
        base += "Stockout risk within the 30-day forecast window is minimal. "

    base += (
        f"P(stockout by Day 5) = {p_5d * 100:.1f}%. "
        f"Severity: {severity.upper()}."
    )

    return base