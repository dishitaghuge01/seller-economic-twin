import logging
from datetime import datetime, timedelta
from typing import Optional
from zoneinfo import ZoneInfo

from apscheduler.schedulers.background import BackgroundScheduler

import database
from agent_core import AgentCoreError, run_agent_cycle
from models import Seller, SKU
from whatsapp import send_whatsapp_message

logger = logging.getLogger(__name__)

scheduler = BackgroundScheduler()


def _get_now_ist() -> datetime:
    return datetime.now(ZoneInfo("Asia/Kolkata"))


def _is_due(now: datetime, daily_alert_time: str) -> bool:
    alert_time = datetime.strptime(daily_alert_time, "%H:%M").time()
    window_start = datetime.combine(now.date(), alert_time, tzinfo=now.tzinfo)
    window_end = window_start + timedelta(minutes=15)
    # The scheduler runs every 15 minutes, so each seller can only be due once
    # per day. We treat the alert as due for the single tick window that covers
    # its chosen time, i.e. [alert_time, alert_time + 15 minutes).
    return window_start <= now < window_end


def run_scheduler_tick_now(now: Optional[datetime] = None) -> None:
    current_time = now or _get_now_ist()

    for seller in database.get_all_active_sellers():
        seller_settings = database.get_seller_settings(seller.seller_id)
        if not _is_due(current_time, seller_settings.daily_alert_time):
            continue

        seller_skus = database.get_skus_for_seller(seller.seller_id)
        current_dates = {current_time.date(), datetime.now().date()}

        for sku in seller_skus:
            recent_actions = database.get_agent_action_history(sku.sku_id, limit=5)
            if any(
                action.trigger == "scheduled" and action.action_date in current_dates
                for action in recent_actions
            ):
                continue

            try:
                result = run_agent_cycle(seller.seller_id, sku.sku_id, trigger="scheduled")
            except AgentCoreError as exc:
                logger.error(
                    "Scheduler agent cycle failed for seller_id=%s sku_id=%s: %s",
                    seller.seller_id,
                    sku.sku_id,
                    exc,
                )
                continue

            if result.get("notification_suppressed"):
                logger.info(
                    "Scheduler price change below threshold, skipping notification for seller_id=%s sku_id=%s",
                    seller.seller_id,
                    sku.sku_id,
                )
                continue

            try:
                delivery_result = send_whatsapp_message(seller.seller_id, result["seller_message"])
            except Exception as exc:  # pragma: no cover - defensive guard
                logger.warning(
                    "Scheduler WhatsApp send failed for seller_id=%s sku_id=%s: %s",
                    seller.seller_id,
                    sku.sku_id,
                    exc,
                )
                continue

            if delivery_result.get("status") != "sent":
                logger.warning(
                    "Scheduler WhatsApp delivery was not sent for seller_id=%s sku_id=%s: %s",
                    seller.seller_id,
                    sku.sku_id,
                    delivery_result,
                )
                continue

            logger.info(
                "Scheduler delivered message seller_id=%s sku_id=%s chosen_price=%s stockout_severity=%s",
                seller.seller_id,
                sku.sku_id,
                result.get("chosen_price"),
                result.get("stockout_severity"),
            )


def run_scheduler_tick() -> None:
    run_scheduler_tick_now()
