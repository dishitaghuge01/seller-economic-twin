"""
demo.py

Demo simulation engine for the Seller Economic Twin.

Provides endpoints to run a 6-day simulation of price/stock dynamics:
  - Day 0-2: Normal operation
  - Day 2: Demand shock event on shock_sku (30% drop in units_sold)
  - Day 0-5: Stock depletion on depletion_sku (2 units/day)

All endpoints require DEMO_SELLER_ID env var match + DEMO_LOGIN_ENABLED=true.
"""

import asyncio
import inspect
import logging
import os
from datetime import date
from typing import Optional, List, Dict, Any

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel

import database
from agent_core import AgentCoreError, run_agent_cycle
from auth_utils import get_current_seller, get_current_seller_for_path
from models import DemoState, Seller
from seed_data import KURTI_SKU_DATA, PALAZZO_SKU_DATA
from whatsapp import send_whatsapp_message

logger = logging.getLogger(__name__)
router = APIRouter()

_demo_locks: Dict[str, asyncio.Lock] = {}


def _get_demo_lock(seller_id: str) -> asyncio.Lock:
    if seller_id not in _demo_locks:
        _demo_locks[seller_id] = asyncio.Lock()
    return _demo_locks[seller_id]


async def _authorize_demo_request(
    seller_id: str,
    authorization: Optional[str] = Header(None, alias="Authorization"),
) -> Seller:
    """Resolve the currently bound auth dependency at request time for demo routes."""
    _check_demo_access(seller_id)

    auth_dependency = globals().get("get_current_seller_for_path", get_current_seller_for_path)
    signature = inspect.signature(auth_dependency)
    if len(signature.parameters) == 1:
        result = auth_dependency(seller_id)
        return await result if inspect.isawaitable(result) else result

    seller = await get_current_seller(authorization)
    result = auth_dependency(seller_id, seller)
    return await result if inspect.isawaitable(result) else result


# Safety gate: only allow demo operations if enabled and seller_id matches
DEMO_SELLER_ID = os.environ.get("DEMO_SELLER_ID", "riya_sharma")
DEMO_LOGIN_ENABLED = os.environ.get("DEMO_LOGIN_ENABLED", "").lower() == "true"


def _check_demo_access(seller_id: str) -> None:
    """
    Verify seller_id matches DEMO_SELLER_ID and DEMO_LOGIN_ENABLED is true.
    Raises HTTPException(403) if check fails.
    """
    if seller_id != DEMO_SELLER_ID or not DEMO_LOGIN_ENABLED:
        raise HTTPException(status_code=403, detail="Demo simulation is not available for this account.")


class DemoStartResponse(BaseModel):
    status: str
    current_day: int
    max_days: int
    depletion_sku: Dict[str, Any]
    shock_sku: Dict[str, Any]


class DemoStepNotification(BaseModel):
    sku_id: str
    sent: bool
    reason: str


class DemoStepMessage(BaseModel):
    sku_id: str
    seller_message: str
    reasoning_trace: str


class DemoStepResponse(BaseModel):
    day: int
    max_days: int
    depletion_sku: Dict[str, Any]
    shock_sku: Dict[str, Any]
    shock_event_triggered_today: bool
    notifications: List[DemoStepNotification]
    agent_messages: List[DemoStepMessage]


class DemoStatusResponse(BaseModel):
    status: str
    current_day: Optional[int] = None
    max_days: Optional[int] = None
    shock_sku_id: Optional[str] = None
    depletion_sku_id: Optional[str] = None
    shock_triggered: Optional[bool] = None


def _get_sku_snapshot(sku_id: str) -> Dict[str, Any]:
    """Get current snapshot of a SKU (stock, price, severity if available)."""
    sku = database.get_sku_by_id(sku_id)
    if sku is None:
        return {}
    
    last_action = database.get_last_agent_action(sku_id)
    severity = last_action.stockout_severity if last_action else None
    
    return {
        "sku_id": sku_id,
        "sku_name": sku.sku_name,
        "current_stock": sku.current_stock,
        "current_chosen_price": sku.current_chosen_price,
        "reorder_point": sku.reorder_point,
        "stockout_severity": severity,
    }


def _run_arc(sku_id: str, arc_label: str, seller_id: str) -> tuple[Optional[DemoStepMessage], Optional[DemoStepNotification]]:
    """Run a scheduled agent cycle for one SKU and send a notification unless suppressed."""
    try:
        result = run_agent_cycle(seller_id, sku_id, trigger="scheduled")
    except AgentCoreError as exc:
        logger.error(f"Agent cycle failed for {arc_label} arc: {exc}")
        return None, None

    message = DemoStepMessage(
        sku_id=sku_id,
        seller_message=result.get("seller_message", ""),
        reasoning_trace=result.get("reasoning_trace", ""),
    )

    if result.get("notification_suppressed"):
        return message, DemoStepNotification(
            sku_id=sku_id,
            sent=False,
            reason="price change below threshold",
        )

    try:
        send_result = send_whatsapp_message(seller_id, result["seller_message"])
        notification = DemoStepNotification(
            sku_id=sku_id,
            sent=send_result.get("status") == "sent",
            reason=f"{arc_label} arc",
        )
    except Exception as exc:
        logger.warning(f"WhatsApp send failed for {arc_label} arc: {exc}")
        notification = DemoStepNotification(
            sku_id=sku_id,
            sent=False,
            reason=f"send error: {str(exc)[:50]}",
        )

    return message, notification


def _assign_arcs(seller_id: str) -> tuple[str, str]:
    """
    Assign shock and depletion SKUs based on reorder-point proximity.
    
    Returns: (shock_sku_id, depletion_sku_id)
    
    Shock SKU: the one furthest from reorder point (highest stock relative to threshold)
    Depletion SKU: the one closest to reorder point (lowest stock relative to threshold)
    """
    skus = database.get_skus_for_seller(seller_id)
    if len(skus) < 2:
        raise ValueError(f"Seller {seller_id} must have at least 2 SKUs for demo")
    
    # Compute proximity scores: higher = further from reorder point
    scores = []
    for sku in skus:
        # stock_ratio: how many times above reorder_point (lower = closer to threshold)
        if sku.reorder_point > 0:
            stock_ratio = sku.current_stock / sku.reorder_point
        else:
            stock_ratio = float('inf')
        scores.append((sku.sku_id, stock_ratio))
    
    # Sort by score (descending): highest first
    scores.sort(key=lambda x: x[1], reverse=True)
    
    shock_sku_id = scores[0][0]  # furthest from threshold
    depletion_sku_id = scores[1][0]  # closest to threshold
    
    logger.info(f"Demo arcs assigned: shock={shock_sku_id} (ratio={scores[0][1]:.2f}), depletion={depletion_sku_id} (ratio={scores[1][1]:.2f})")
    
    return shock_sku_id, depletion_sku_id


@router.post("/seller/{seller_id}/demo/reset")
async def demo_reset(
    seller_id: str,
    current_seller: Seller = Depends(_authorize_demo_request),
) -> dict:
    """Reset demo data to seeded state."""
    _check_demo_access(seller_id)
    
    try:
        database.reset_demo_seller_data(seller_id)
    except Exception as exc:
        logger.error(f"Demo reset failed for {seller_id}: {exc}")
        raise HTTPException(status_code=500, detail=str(exc))
    
    return {"status": "reset"}


@router.post("/seller/{seller_id}/demo/start")
async def demo_start(
    seller_id: str,
    current_seller: Seller = Depends(_authorize_demo_request),
) -> DemoStartResponse:
    """Start a new demo simulation (always resets first)."""
    _check_demo_access(seller_id)
    
    lock = _get_demo_lock(seller_id)
    if lock.locked():
        raise HTTPException(status_code=409, detail="A demo start is already in progress for this seller.")
    
    try:
        async with lock:
            # Always start fresh: reset first
            database.reset_demo_seller_data(seller_id)
            
            # Assign arcs based on current reorder-point proximity
            shock_sku_id, depletion_sku_id = _assign_arcs(seller_id)
            
            # Create demo state at day 0
            demo_state = DemoState(
                seller_id=seller_id,
                current_day=0,
                max_days=6,
                shock_sku_id=shock_sku_id,
                depletion_sku_id=depletion_sku_id,
                shock_triggered=False,
            )
            database.upsert_demo_state(demo_state)
            
            # Get snapshots for response
            depletion_snapshot = _get_sku_snapshot(depletion_sku_id)
            shock_snapshot = _get_sku_snapshot(shock_sku_id)
            
            return DemoStartResponse(
                status="started",
                current_day=0,
                max_days=6,
                depletion_sku=depletion_snapshot,
                shock_sku=shock_snapshot,
            )
    
    except Exception as exc:
        logger.error(f"Demo start failed for {seller_id}: {exc}")
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/seller/{seller_id}/demo/step")
async def demo_step(
    seller_id: str,
    current_seller: Seller = Depends(_authorize_demo_request),
) -> DemoStepResponse:
    """Advance demo simulation by one day."""
    _check_demo_access(seller_id)
    
    lock = _get_demo_lock(seller_id)
    if lock.locked():
        raise HTTPException(status_code=409, detail="A demo step is already in progress for this seller.")
    
    try:
        async with lock:
            demo_state = database.get_demo_state(seller_id)
            if demo_state is None:
                raise HTTPException(status_code=400, detail="Demo not started. Call /demo/start first.")
            
            # Check if simulation is complete
            if demo_state.current_day >= demo_state.max_days:
                return DemoStepResponse(
                    day=demo_state.current_day,
                    max_days=demo_state.max_days,
                    depletion_sku=_get_sku_snapshot(demo_state.depletion_sku_id),
                    shock_sku=_get_sku_snapshot(demo_state.shock_sku_id),
                    shock_event_triggered_today=False,
                    notifications=[],
                    agent_messages=[],
                )
            
            # Increment day
            demo_state.current_day += 1
            
            notifications: List[DemoStepNotification] = []
            agent_messages: List[DemoStepMessage] = []
            shock_event_triggered_today = False
            
            # --- DEPLETION ARC: decrement stock each step ---
            depletion_sku = database.get_sku_by_id(demo_state.depletion_sku_id)
            if depletion_sku:
                # Decrement by 2 units/day, floor at 0
                new_stock = max(0, depletion_sku.current_stock - 2)
                database.update_sku_stock(demo_state.depletion_sku_id, new_stock)
            
            # --- SHOCK ARC: inject synthetic order on shock_day ---
            shock_day = 2  # Day 2 of 6
            if demo_state.current_day == shock_day and not demo_state.shock_triggered:
                shock_sku = database.get_sku_by_id(demo_state.shock_sku_id)
                if shock_sku:
                    # Compute average units_sold from recent order history
                    orders = database.get_order_history(demo_state.shock_sku_id, days=30)
                    if orders:
                        avg_units = sum(o.units_sold for o in orders) / len(orders)
                        # Shock: 20-30% drop (use 25% as midpoint)
                        shocked_units = max(1, int(avg_units * 0.75))
                    else:
                        shocked_units = 1  # Fallback
                    
                    # Insert synthetic order at today's price
                    from models import Order
                    import uuid
                    shock_order = Order(
                        order_id=str(uuid.uuid4()),
                        sku_id=demo_state.shock_sku_id,
                        seller_id=seller_id,
                        order_date=date.today(),
                        units_sold=shocked_units,
                        price_charged=shock_sku.current_chosen_price or shock_sku.price_floor,
                        revenue=shocked_units * (shock_sku.current_chosen_price or shock_sku.price_floor),
                        margin=shocked_units * ((shock_sku.current_chosen_price or shock_sku.price_floor) - shock_sku.unit_cost),
                    )
                    database.insert_order(shock_order)
                    demo_state.shock_triggered = True
                    shock_event_triggered_today = True
                    logger.info(f"Demo shock triggered on {demo_state.shock_sku_id}: {shocked_units} units (avg was ~{avg_units:.1f})")
            
            depletion_result, shock_result = await asyncio.gather(
                asyncio.to_thread(_run_arc, demo_state.depletion_sku_id, "depletion", seller_id),
                asyncio.to_thread(_run_arc, demo_state.shock_sku_id, "shock", seller_id),
            )

            for message, notification in (depletion_result, shock_result):
                if message is not None:
                    agent_messages.append(message)
                if notification is not None:
                    notifications.append(notification)
            
            # Persist incremented demo state
            database.upsert_demo_state(demo_state)
            
            return DemoStepResponse(
                day=demo_state.current_day,
                max_days=demo_state.max_days,
                depletion_sku=_get_sku_snapshot(demo_state.depletion_sku_id),
                shock_sku=_get_sku_snapshot(demo_state.shock_sku_id),
                shock_event_triggered_today=shock_event_triggered_today,
                notifications=notifications,
                agent_messages=agent_messages,
            )
    
    except HTTPException:
        raise
    except Exception as exc:
        logger.error(f"Demo step failed for {seller_id}: {exc}")
        raise HTTPException(status_code=500, detail=str(exc))


@router.get("/seller/{seller_id}/demo/status")
async def demo_status(
    seller_id: str,
    current_seller: Seller = Depends(_authorize_demo_request),
) -> DemoStatusResponse:
    """Get current demo status."""
    _check_demo_access(seller_id)
    
    demo_state = database.get_demo_state(seller_id)
    
    if demo_state is None:
        return DemoStatusResponse(status="not_started")
    
    return DemoStatusResponse(
        status="running",
        current_day=demo_state.current_day,
        max_days=demo_state.max_days,
        shock_sku_id=demo_state.shock_sku_id,
        depletion_sku_id=demo_state.depletion_sku_id,
        shock_triggered=demo_state.shock_triggered,
    )
