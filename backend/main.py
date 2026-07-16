import logging
import os
import re
import time
import uuid
from typing import Dict, Optional
from dotenv import load_dotenv
load_dotenv()

import jwt
from apscheduler.schedulers.background import BackgroundScheduler
from fastapi import Depends, FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

import database
from agent_core import AgentCoreError, run_agent_cycle
from auth_pairing import router as auth_pairing_router
from forecasting_tool import run_forecasting_tool
from models import Seller, SellerSettings, SKU
from scheduler import run_scheduler_tick, scheduler as scheduler_job
from sku_resolution import resolve_default_sku
from whatsapp import router as whatsapp_router

app = FastAPI(title="Seller Economic Twin")

frontend_origin = os.getenv("FRONTEND_URL", "http://localhost:3000")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[frontend_origin],
    allow_credentials=True,
    allow_methods=["GET", "POST"],
    allow_headers=["Authorization", "Content-Type"],
)

logger = logging.getLogger(__name__)

app.include_router(whatsapp_router, prefix="/whatsapp")
app.include_router(auth_pairing_router)

_forecast_cache: Dict[str, tuple[float, dict]] = {}
_FORECAST_TTL_SECONDS = 6 * 60 * 60


class MessageRequest(BaseModel):
    message: str


class SettingsRequest(BaseModel):
    price_floor: int
    price_ceiling: int
    daily_alert_time: str
    alert_language: str
    notify_on_price_change: bool
    notify_on_stockout_risk: bool
    price_change_threshold: float


class CreateSkuRequest(BaseModel):
    sku_name: str
    current_stock: int
    reorder_point: int
    unit_cost: int
    price_floor: int
    price_ceiling: int


def _slugify_sku_name(value: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "_", value.lower()).strip("_")
    return slug[:30] or "sku"


def _generate_sku_id(sku_name: str) -> str:
    base = _slugify_sku_name(sku_name)
    candidate = base
    while database.get_sku_by_id(candidate) is not None:
        suffix = uuid.uuid4().hex[:6]
        candidate = f"{base}_{suffix}"
    return candidate


async def get_current_seller(authorization: Optional[str] = Header(None, alias="Authorization")) -> Seller:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Not authenticated")

    token = authorization.split(" ", 1)[1].strip()
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")

    jwt_secret = os.getenv("SUPABASE_JWT_SECRET")
    if not jwt_secret:
        raise HTTPException(status_code=401, detail="Not authenticated")

    try:
        payload = jwt.decode(
            token,
            jwt_secret,
            algorithms=["HS256"],
            audience="authenticated",
            options={"require": ["exp"]},
        )
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid authentication token") from None

    auth_user_id = payload.get("sub")
    if not auth_user_id:
        raise HTTPException(status_code=401, detail="Invalid authentication token")

    seller = database.get_seller_by_auth_user_id(str(auth_user_id))
    if seller is None:
        raise HTTPException(status_code=404, detail="account not found")
    return seller


async def get_current_seller_for_path(seller_id: str, seller: Seller = Depends(get_current_seller)) -> Seller:
    if seller.seller_id != seller_id:
        raise HTTPException(status_code=403, detail="Not authorized for this seller")
    return seller


@app.on_event("startup")
def startup_event() -> None:
    # This creates only the application's own tables. auth.users is managed
    # by Supabase natively in production and must never be created or
    # modified here — see create_local_auth_stub() in database.py for the
    # local-only test equivalent.
    database.create_tables()
    if not scheduler_job.running:
        scheduler_job.add_job(run_scheduler_tick, "interval", minutes=15, id="seller_scheduler", replace_existing=True)
        scheduler_job.start()


@app.on_event("shutdown")
def shutdown_event() -> None:
    if scheduler_job.running:
        scheduler_job.shutdown(wait=False)


@app.get("/ping")
def ping() -> dict:
    return {"status": "ok"}


@app.get("/seller/me")
def get_current_seller_profile(seller: Seller = Depends(get_current_seller)) -> dict:
    return {
        "seller_id": seller.seller_id,
        "seller_name": seller.seller_name,
        "language_preference": seller.language_preference,
    }


@app.get("/seller/{seller_id}")
def get_seller(seller_id: str, seller: Seller = Depends(get_current_seller_for_path)) -> dict:
    skus = database.get_skus_for_seller(seller_id)
    sku_payload = []
    for sku in skus:
        last_action = database.get_last_agent_action(sku.sku_id)
        last_action_payload = None
        if last_action is not None:
            last_action_payload = {
                "action_date": last_action.action_date.isoformat(),
                "stockout_severity": last_action.stockout_severity,
                "stockout_probability_5d": last_action.stockout_probability_5d,
                "chosen_price": last_action.chosen_price,
                "seller_message": last_action.seller_message,
                "delivered_via": last_action.delivered_via,
            }
        sku_payload.append(
            {
                "sku_id": sku.sku_id,
                "sku_name": sku.sku_name,
                "current_stock": sku.current_stock,
                "reorder_point": sku.reorder_point,
                "price_floor": sku.price_floor,
                "price_ceiling": sku.price_ceiling,
                "current_chosen_price": sku.current_chosen_price,
                "last_action": last_action_payload,
            }
        )
    return {
        "seller": {
            "seller_id": seller.seller_id,
            "seller_name": seller.seller_name,
            "language_preference": seller.language_preference,
        },
        "skus": sku_payload,
    }


@app.post("/seller/{seller_id}/skus", status_code=201)
def create_sku(
    seller_id: str,
    payload: CreateSkuRequest,
    seller: Seller = Depends(get_current_seller_for_path),
) -> dict:
    sku_name = (payload.sku_name or "").strip()
    if not sku_name:
        raise HTTPException(status_code=400, detail="Product name is required")
    if payload.current_stock < 0:
        raise HTTPException(status_code=400, detail="Current stock must be 0 or greater")
    if payload.reorder_point < 0:
        raise HTTPException(status_code=400, detail="Reorder point must be 0 or greater")

    sku_id = _generate_sku_id(sku_name)
    try:
        sku = SKU(
            sku_id=sku_id,
            seller_id=seller_id,
            sku_name=sku_name,
            current_stock=payload.current_stock,
            reorder_point=payload.reorder_point,
            unit_cost=payload.unit_cost,
            price_floor=payload.price_floor,
            price_ceiling=payload.price_ceiling,
            current_chosen_price=None,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    database.insert_sku(sku)
    database.recompute_price_arms(sku.sku_id, sku.price_floor, sku.price_ceiling)

    return {
        "sku_id": sku.sku_id,
        "sku_name": sku.sku_name,
        "current_stock": sku.current_stock,
        "reorder_point": sku.reorder_point,
        "unit_cost": sku.unit_cost,
        "price_floor": sku.price_floor,
        "price_ceiling": sku.price_ceiling,
        "current_chosen_price": sku.current_chosen_price,
    }


@app.get("/seller/{seller_id}/sku/{sku_id}/history")
def get_sku_history(seller_id: str, sku_id: str, seller: Seller = Depends(get_current_seller_for_path)) -> dict:
    orders = database.get_order_history(sku_id, days=30)
    price_arms = database.get_price_arms(sku_id, active_only=False)
    agent_actions = database.get_agent_action_history(sku_id, limit=30)
    return {
        "order_history": [
            {
                "date": order.order_date.isoformat(),
                "units_sold": order.units_sold,
                "price_charged": order.price_charged,
                "margin": order.margin,
            }
            for order in orders
        ],
        "price_arms": [
            {
                "price_value": arm.price_value,
                "alpha": arm.alpha,
                "beta_param": arm.beta_param,
                "times_chosen": arm.times_chosen,
                "is_active": arm.is_active,
            }
            for arm in price_arms
        ],
        "agent_actions": [
            {
                "action_id": action.action_id,
                "action_date": action.action_date.isoformat(),
                "trigger": action.trigger,
                "tool_called": action.tool_called,
                "chosen_price": action.chosen_price,
                "stockout_probability_5d": action.stockout_probability_5d,
                "stockout_probability_10d": action.stockout_probability_10d,
                "stockout_severity": action.stockout_severity,
                "seller_message": action.seller_message,
                "reasoning_trace": action.reasoning_trace,
                "delivered_via": action.delivered_via,
                "created_at": action.created_at.isoformat(),
            }
            for action in agent_actions
        ],
    }


@app.get("/seller/{seller_id}/sku/{sku_id}/forecast")
def get_forecast(seller_id: str, sku_id: str, refresh: bool = False, seller: Seller = Depends(get_current_seller_for_path)) -> dict:
    if not refresh:
        cached = _forecast_cache.get(sku_id)
        if cached is not None:
            timestamp, payload = cached
            if time.time() - timestamp < _FORECAST_TTL_SECONDS:
                return payload

    seller_state = database.build_seller_state(seller_id, sku_id)
    forecast_result = run_forecasting_tool(seller_state, n_simulations=500, rng_seed=None)
    payload = {
        "lambda_estimated": forecast_result["lambda_estimated"],
        "starting_stock": forecast_result["starting_stock"],
        "fan_chart": forecast_result["fan_chart"],
        "p_stockout_5d": forecast_result["p_stockout_5d"],
        "p_stockout_10d": forecast_result["p_stockout_10d"],
        "median_stockout_day": forecast_result["median_stockout_day"],
        "stockout_ci_low": forecast_result["stockout_ci_low"],
        "stockout_ci_high": forecast_result["stockout_ci_high"],
        "severity": forecast_result["severity"],
        "confidence": forecast_result["confidence"],
        "days_of_history": forecast_result["days_of_history"],
    }
    _forecast_cache[sku_id] = (time.time(), payload)
    return payload


def _resolve_default_sku(seller_id: str) -> str:
    return resolve_default_sku(seller_id)


@app.post("/seller/{seller_id}/message")
def post_message(seller_id: str, payload: MessageRequest, seller: Seller = Depends(get_current_seller_for_path)) -> dict:
    sku_id = _resolve_default_sku(seller_id)
    try:
        result = run_agent_cycle(seller_id, sku_id, trigger="user_message", message_text=payload.message)
    except AgentCoreError as exc:
        logger.error("Agent cycle failed", exc_info=exc)
        raise HTTPException(
            status_code=503,
            detail="The agent is temporarily unavailable. Please try again in a moment.",
        ) from exc
    return {
        "response_text": result["seller_message"],
        "reasoning_trace": result["reasoning_trace"],
        "action_summary": result["action_summary"],
    }


@app.post("/seller/{seller_id}/settings")
def post_settings(seller_id: str, payload: SettingsRequest, seller: Seller = Depends(get_current_seller_for_path)) -> dict:
    if payload.price_floor >= payload.price_ceiling:
        raise HTTPException(status_code=400, detail="price_floor must be less than price_ceiling")

    if not re.fullmatch(r"([01]\d|2[0-3]):([0-5]\d)", payload.daily_alert_time):
        raise HTTPException(status_code=400, detail="daily_alert_time must be HH:MM")

    settings = SellerSettings(
        seller_id=seller_id,
        daily_alert_time=payload.daily_alert_time,
        alert_language=payload.alert_language,
        notify_on_price_change=payload.notify_on_price_change,
        notify_on_stockout_risk=payload.notify_on_stockout_risk,
        price_change_threshold=payload.price_change_threshold,
    )
    database.upsert_seller_settings(settings)

    # The frontend currently posts settings without a SKU identifier, so the
    # backend applies them to the seller's default-resolved SKU for now.
    # This is a known limitation to revisit once the UI supports per-SKU settings.
    sku_id = _resolve_default_sku(seller_id)
    database.update_sku_price_range(sku_id, payload.price_floor, payload.price_ceiling)
    database.recompute_price_arms(sku_id, payload.price_floor, payload.price_ceiling)
    new_arms = database.get_price_arms(sku_id, active_only=True)
    return {
        "status": "updated",
        "arms_recomputed": True,
        "new_arm_count": len(new_arms),
    }


@app.get("/seller/{seller_id}/conversations")
def get_conversations(seller_id: str, seller: Seller = Depends(get_current_seller_for_path)) -> dict:
    conversations = database.get_conversation_history(seller_id, limit=20)
    return {
        "messages": [
            {
                "message_id": conversation.message_id,
                "direction": conversation.direction,
                "message_body": conversation.message_body,
                "created_at": conversation.created_at.isoformat(),
            }
            for conversation in conversations
        ]
    }
