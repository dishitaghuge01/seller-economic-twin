"""LLM orchestration layer for the Seller Economic Twin agent.

This module does not perform pricing or forecasting math itself. Instead, it
coordinates the existing pure statistical tools (Component A) with the database
access layer (Component B) and turns their outputs into an honest natural-
language explanation for the seller.
"""

from __future__ import annotations

import logging
import os
import re
import uuid
from datetime import date
from typing import Any, Dict, List, Optional

os.environ.setdefault("SUPABASE_DB_URL", "postgresql://postgres@localhost:5432/postgres")

try:
    from openai import OpenAI  # type: ignore
except ImportError:  # pragma: no cover - exercised when SDK is absent in the env
    OpenAI = None  # type: ignore

from database import (
    build_seller_state,
    get_conversation_history,
    get_last_agent_action,
    get_price_arms,
    get_seller_by_id,
    get_sku_by_id,
    insert_agent_action,
    recompute_price_arms,
    update_sku_chosen_price,
    upsert_price_arm,
)
from forecasting_tool import run_forecasting_tool
from models import AgentAction, PriceArm, Seller, SKU
from pricing_tool import run_pricing_tool

logger = logging.getLogger(__name__)


class AgentCoreError(RuntimeError):
    """Raised when the agent cycle cannot produce a usable seller-facing response."""


def run_agent_cycle(
    seller_id: str,
    sku_id: str,
    trigger: str,
    message_text: str = None,
) -> dict:
    """
    Orchestrate a full seller-facing agent cycle.

    Returns a dictionary with the seller-facing message, the dashboard reasoning
    trace, the raw action summary, the tool name used, and the selected price/
    stockout severity.
    """
    if trigger not in {"scheduled", "user_message"}:
        raise AgentCoreError(f"Unsupported trigger: {trigger}")

    if trigger == "user_message" and not message_text:
        raise AgentCoreError("message_text is required when trigger='user_message'")

    seller_state = build_seller_state(seller_id, sku_id)
    seller = get_seller_by_id(seller_id)
    sku = get_sku_by_id(sku_id)

    if seller is None:
        raise LookupError(f"Unknown seller_id: {seller_id}")
    if sku is None:
        raise LookupError(f"Unknown sku_id: {sku_id}")

    last_action = get_last_agent_action(sku_id)
    conversation_history = get_conversation_history(seller_id, limit=10)

    recompute_price_arms(sku_id, int(sku.price_floor), int(sku.price_ceiling))
    seller_state["price_arms"] = [
        {
            "price_value": arm.price_value,
            "alpha": arm.alpha,
            "beta_param": arm.beta_param,
            "times_chosen": arm.times_chosen,
        }
        for arm in get_price_arms(sku_id, active_only=True)
    ]

    run_pricing = False
    run_forecasting = False
    if trigger == "scheduled":
        run_pricing = True
        run_forecasting = True
    else:
        intent = _classify_message_intent(message_text or "")
        if intent == "price":
            run_pricing = True
        elif intent == "stock":
            run_forecasting = True
        else:
            run_pricing = True
            run_forecasting = True

    pricing_result: Optional[Dict[str, Any]] = None
    forecast_result: Optional[Dict[str, Any]] = None
    if run_pricing:
        pricing_result = run_pricing_tool(seller_state, rng_seed=None)
    if run_forecasting:
        forecast_result = run_forecasting_tool(seller_state, n_simulations=500, rng_seed=None)

    if pricing_result is not None:
        current_arms = get_price_arms(sku_id, active_only=False)
        arm_lookup = {arm.price_value: arm for arm in current_arms}
        for arm_payload in pricing_result.get("updated_arms", []):
            price_value = int(arm_payload["price_value"])
            existing_arm = arm_lookup.get(price_value)
            arm_id = existing_arm.arm_id if existing_arm is not None else str(uuid.uuid4())
            price_arm = PriceArm(
                arm_id=arm_id,
                sku_id=sku_id,
                price_value=price_value,
                alpha=float(arm_payload["alpha"]),
                beta_param=float(arm_payload["beta_param"]),
                times_chosen=int(arm_payload["times_chosen"]),
                is_active=True,
            )
            upsert_price_arm(price_arm)
            arm_lookup[price_value] = price_arm
        update_sku_chosen_price(sku_id, int(pricing_result["chosen_price"]))

    system_prompt = _build_system_prompt(seller=seller, sku=sku)
    user_prompt = _build_user_prompt(
        seller=seller,
        sku=sku,
        seller_state=seller_state,
        last_action=last_action,
        conversation_history=conversation_history,
        pricing_result=pricing_result,
        forecast_result=forecast_result,
        trigger=trigger,
        message_text=message_text,
    )

    try:
        raw_text = _generate_agent_response(system_prompt, user_prompt)
    except AgentCoreError:
        raise
    except Exception as exc:  # pragma: no cover - exercised only in runtime
        logger.exception("LLM provider call failed")
        raise AgentCoreError(
            f"the agent is temporarily unavailable, please try again: {exc}"
        ) from exc

    parsed = _parse_agent_response(raw_text)

    tool_called = "none"
    if run_pricing and run_forecasting:
        tool_called = "both"
    elif run_pricing:
        tool_called = "pricing"
    elif run_forecasting:
        tool_called = "forecasting"

    stockout_probability_5d = None
    stockout_probability_10d = None
    stockout_severity = None
    if forecast_result is not None:
        stockout_probability_5d = forecast_result.get("p_stockout_5d")
        stockout_probability_10d = forecast_result.get("p_stockout_10d")
        stockout_severity = forecast_result.get("severity")

    chosen_price = None
    if pricing_result is not None:
        chosen_price = int(pricing_result["chosen_price"])
    elif sku.current_chosen_price is not None:
        chosen_price = int(sku.current_chosen_price)

    action = AgentAction(
        action_id=str(uuid.uuid4()),
        sku_id=sku_id,
        seller_id=seller_id,
        action_date=date.today(),
        tool_called=tool_called,
        trigger=trigger,
        chosen_price=chosen_price,
        stockout_probability_5d=stockout_probability_5d,
        stockout_probability_10d=stockout_probability_10d,
        stockout_severity=stockout_severity,
        seller_message=parsed["seller_message"],
        reasoning_trace=parsed["reasoning_trace"],
        delivered_via=None,
    )
    insert_agent_action(action)

    return {
        "seller_message": parsed["seller_message"],
        "reasoning_trace": parsed["reasoning_trace"],
        "action_summary": parsed["action_summary"],
        "tool_called": tool_called,
        "chosen_price": chosen_price,
        "stockout_severity": stockout_severity,
    }


def _generate_agent_response(system_prompt: str, user_prompt: str) -> str:
    sarvam_error: Optional[Exception] = None
    gemini_error: Optional[Exception] = None

    for provider_name in ("sarvam", "gemini"):
        try:
            raw_text = _call_provider(provider_name, system_prompt, user_prompt)
            _parse_agent_response(raw_text)
            return raw_text
        except AgentCoreError as exc:
            if provider_name == "sarvam":
                sarvam_error = exc
            else:
                gemini_error = exc
        except Exception as exc:  # pragma: no cover - exercised only in runtime
            if provider_name == "sarvam":
                sarvam_error = exc
            else:
                gemini_error = exc

    raise AgentCoreError(
        "both providers failed: "
        f"sarvam={sarvam_error}; gemini={gemini_error}"
    )


def _call_provider(provider_name: str, system_prompt: str, user_prompt: str) -> str:
    if OpenAI is None:
        raise AgentCoreError("openai package is not installed")

    if provider_name == "sarvam":
        api_key = os.getenv("SARVAM_API_KEY")
        base_url = os.getenv("SARVAM_BASE_URL", "https://api.sarvam.ai/v1")
        model = os.getenv("SARVAM_MODEL", "sarvam-m")
    elif provider_name == "gemini":
        api_key = os.getenv("GEMINI_API_KEY")
        base_url = os.getenv(
            "GEMINI_BASE_URL",
            "https://generativelanguage.googleapis.com/v1beta/openai/",
        )
        model = os.getenv("GEMINI_MODEL", "gemini-2.0-flash")
    else:
        raise AgentCoreError(f"Unsupported provider: {provider_name}")

    if not api_key:
        raise AgentCoreError(f"{provider_name} API key is not configured")

    client = OpenAI(api_key=api_key, base_url=base_url)
    response = client.chat.completions.create(
        model=model,
        temperature=0.3,
        max_tokens=1000,
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
    )
    return _extract_text_from_response(response)


def _extract_text_from_response(response: Any) -> str:
    try:
        choice = response.choices[0]
        message = getattr(choice, "message", None)
        content = getattr(message, "content", None)
    except Exception as exc:
        raise AgentCoreError("Provider returned an unexpected response payload") from exc

    if isinstance(content, str):
        return content

    if isinstance(content, list):
        parts: List[str] = []
        for item in content:
            if isinstance(item, str):
                parts.append(item)
            else:
                text = getattr(item, "text", None)
                if isinstance(text, str):
                    parts.append(text)
        if parts:
            return "\n".join(parts)

    raise AgentCoreError("Provider response did not contain a text message")


def _classify_message_intent(message_text: str) -> str:
    """Classify a seller message into a lightweight pricing/stock intent bucket.

    The keyword lists below are intentionally deterministic and local so the
    agent cycle stays fast and cheap. The exact price keywords are:
    "price", "rate", "kitna", "keemat", "daam", "mehenga", "sasta",
    "kam karo", "badhao".
    The exact stock keywords are:
    "stock", "khatam", "restock", "reorder", "kab tak", "bacha",
    "inventory".
    If both sets match or neither set matches, the function returns "general"
    so the cycle can safely call both tools rather than guess wrong.
    """
    normalized = re.sub(r"[^a-z0-9]+", " ", (message_text or "").lower()).strip()
    price_keywords = (
        "price",
        "rate",
        "kitna",
        "keemat",
        "daam",
        "mehenga",
        "sasta",
        "kam karo",
        "badhao",
    )
    stock_keywords = (
        "stock",
        "khatam",
        "restock",
        "reorder",
        "kab tak",
        "bacha",
        "inventory",
    )

    price_hit = any(keyword in normalized for keyword in price_keywords)
    stock_hit = any(keyword in normalized for keyword in stock_keywords)
    if price_hit and not stock_hit:
        return "price"
    if stock_hit and not price_hit:
        return "stock"
    return "general"


def _build_system_prompt(seller: Seller, sku: SKU) -> str:
    language = "Hindi" if seller.language_preference == "hi" else "English"
    return (
        f"You are a pricing and inventory advisor for a small Indian e-commerce "
        f"seller. Always cite specific numbers behind any recommendation — "
        f"never say 'the price seems good' without the number and why. "
        f"Communicate in simple {language} — short sentences, no jargon, as if "
        f"texting a shopkeeper on WhatsApp. Never suggest a price outside "
        f"{sku.price_floor}-{sku.price_ceiling}. You MUST respond in exactly "
        f"this format, with these exact section headers on their own line and "
        f"nothing else on those lines:\n\n"
        f"SELLER_MESSAGE:\n"
        f"<the message to send to the seller, 2-4 sentences, WhatsApp-appropriate>\n\n"
        f"REASONING_TRACE:\n"
        f"<technical explanation for a dashboard audit log: which arm was sampled and "
        f"why, what the credible interval was, what lambda and severity the forecast "
        f"found, and why you chose to say what you said in SELLER_MESSAGE>\n\n"
        f"SUMMARY:\n"
        f"ACTION: <what you are doing, a few words> | REASON: <one sentence why> | "
        f"CONFIDENCE: <high, medium, or low>\n\n"
        f"Do not include any text before SELLER_MESSAGE: or after the SUMMARY: line."
    )


def _build_user_prompt(
    seller: Seller,
    sku: SKU,
    seller_state: Dict[str, Any],
    last_action: Optional[AgentAction],
    conversation_history: List[Any],
    pricing_result: Optional[Dict[str, Any]],
    forecast_result: Optional[Dict[str, Any]],
    trigger: str,
    message_text: Optional[str],
) -> str:
    state_lines = [
        "STATE SECTION:",
        f"Seller: {seller.seller_name}",
        f"SKU: {sku.sku_name}",
        f"Current stock: {sku.current_stock}",
        f"Reorder point: {sku.reorder_point}",
        f"Price floor: {sku.price_floor}",
        f"Price ceiling: {sku.price_ceiling}",
        f"Today's date: {date.today().isoformat()}",
        f"Order volume summary: {_summarize_order_history(seller_state.get('order_history', []))}",
    ]

    if last_action is not None:
        state_lines.append(f"Last action summary: {_summarize_last_action(last_action, sku.current_stock)}")
    else:
        state_lines.append("Last action summary: No prior agent action exists for this SKU.")

    if trigger == "user_message":
        state_lines.append("Conversation history (last 10):")
        if conversation_history:
            for item in conversation_history:
                state_lines.append(f"- {item.direction}: {item.message_body}")
        else:
            state_lines.append("- No recent conversation history available.")

    tool_lines = ["TOOL OUTPUTS SECTION:"]
    if pricing_result is None:
        tool_lines.append("Pricing tool was not run this cycle")
    else:
        tool_lines.append(
            f"Pricing rationale: {pricing_result['exploration_rationale']}"
        )
        tool_lines.append(
            f"Chosen price: {pricing_result['chosen_price']}"
        )
        tool_lines.append(
            f"Chosen arm credible interval: {pricing_result['chosen_arm_credible_interval']}"
        )
        tool_lines.append(f"Pricing cold start: {pricing_result.get('cold_start', 'unknown')}")

    if forecast_result is None:
        tool_lines.append("Forecasting tool was not run this cycle")
    else:
        tool_lines.append(f"Forecast summary: {forecast_result['forecast_summary']}")
        tool_lines.append(f"Severity: {forecast_result['severity']}")
        tool_lines.append(f"P(stockout by 5 days): {forecast_result['p_stockout_5d']}")
        tool_lines.append(f"P(stockout by 10 days): {forecast_result['p_stockout_10d']}")
        tool_lines.append(f"Forecast lambda source: {forecast_result.get('lambda_source', 'unknown')}")

    task_lines = ["TASK SECTION:"]
    if trigger == "scheduled":
        task_lines.append(
            "Produce a short WhatsApp message telling the seller what price to set today "
            "and whether they need to restock, with the specific numbers that justify "
            "each recommendation, per the required format above."
        )
    else:
        task_lines.append(
            f'The seller asked: "{message_text}". Answer using the tool outputs and state '
            f'above, per the required format above. Be specific with numbers. If they are '
            f'asking why you made a recommendation, reference the exact numbers. If they are '
            f'suggesting a change (for example, delaying restocking), acknowledge it, state the '
            f'risk in numeric terms, and say whether you will change your behavior.'
        )

    return "\n".join(state_lines + [""] + tool_lines + [""] + task_lines)


def _summarize_order_history(order_history: List[Dict[str, Any]]) -> str:
    if not order_history:
        return "No order history available."

    total_units = sum(int(entry.get("units_sold", 0)) for entry in order_history)
    average_per_day = round(total_units / len(order_history), 2)
    trailing_7 = order_history[:7]
    trailing_7_avg = round(
        sum(int(entry.get("units_sold", 0)) for entry in trailing_7) / max(1, len(trailing_7)),
        2,
    )
    trailing_30_avg = average_per_day

    if trailing_7_avg > trailing_30_avg:
        comparison = f"trailing 7-day average is higher than the trailing 30-day average by {round(trailing_7_avg - trailing_30_avg, 2)} units/day"
    elif trailing_7_avg < trailing_30_avg:
        comparison = f"trailing 7-day average is lower than the trailing 30-day average by {round(trailing_30_avg - trailing_7_avg, 2)} units/day"
    else:
        comparison = "trailing 7-day average is in line with the trailing 30-day average"

    return (
        f"{total_units} units sold across {len(order_history)} days; "
        f"average {average_per_day} units/day; {comparison}."
    )


def _summarize_last_action(last_action: AgentAction, current_stock: int) -> str:
    if last_action is None:
        return "No prior agent action exists for this SKU."

    if last_action.chosen_price is not None:
        base = f"Last recommended price was Rs{last_action.chosen_price}; severity was {last_action.stockout_severity or 'unknown'}."
    else:
        base = f"Last severity was {last_action.stockout_severity or 'unknown'}."

    if last_action.stockout_severity == "urgent" and current_stock <= 0:
        return base + " Current stock is at or below zero, suggesting the seller may have acted on the warning."
    if last_action.stockout_severity in {"watch", "urgent"} and current_stock <= 5:
        return base + " Current stock is low, suggesting the seller may have acted on the warning."
    return base + " Current stock does not clearly indicate a follow-up action."


def _parse_agent_response(raw_text: str) -> Dict[str, str]:
    normalized_text = raw_text.replace("\r\n", "\n").replace("\r", "\n")

    seller_parts = re.split(r"(?im)^\s*SELLER_MESSAGE:\s*", normalized_text, maxsplit=1)
    if len(seller_parts) != 2:
        raise AgentCoreError(f"Malformed agent response: {raw_text}")

    reasoning_parts = re.split(r"(?im)^\s*REASONING_TRACE:\s*", seller_parts[1], maxsplit=1)
    if len(reasoning_parts) != 2:
        raise AgentCoreError(f"Malformed agent response: {raw_text}")

    summary_parts = re.split(r"(?im)^\s*SUMMARY:\s*", reasoning_parts[1], maxsplit=1)
    if len(summary_parts) != 2:
        raise AgentCoreError(f"Malformed agent response: {raw_text}")

    seller_message = reasoning_parts[0].strip()
    reasoning_trace = summary_parts[0].strip()
    action_summary = summary_parts[1].strip()

    if not seller_message or not reasoning_trace or not action_summary:
        raise AgentCoreError(f"Malformed agent response missing required sections: {raw_text}")

    return {
        "seller_message": seller_message,
        "reasoning_trace": reasoning_trace,
        "action_summary": action_summary,
    }
