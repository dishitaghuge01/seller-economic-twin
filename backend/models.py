"""
models.py

Plain Python dataclasses representing each table's row type.
These are NOT ORM models -- no inheritance, no metaclasses, no magic.
They exist purely for type safety and IDE autocomplete throughout the codebase.

Every field has an explicit type annotation. Optional fields use
Optional[type] with a default of None.
"""

from dataclasses import dataclass, field
from datetime import datetime, date, timezone
from typing import Optional


@dataclass
class Seller:
    seller_id: str
    seller_name: str
    phone_number: str          # E.164 format, e.g. "+919876543210"
    language_preference: str   # "hi" or "en"
    auth_user_id: Optional[str] = None   # UUID string, references Supabase auth.users(id)
    pending_action: Optional[str] = None
    created_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))


@dataclass
class SKU:
    sku_id: str
    seller_id: str
    sku_name: str
    current_stock: int
    reorder_point: int
    unit_cost: int             # rupees
    price_floor: int           # rupees, minimum the agent may ever set
    price_ceiling: int         # rupees, maximum the agent may ever set
    current_chosen_price: Optional[int] = None   # updated by agent each cycle
    is_active: bool = True
    created_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))

    def __post_init__(self):
        if self.price_floor >= self.price_ceiling:
            raise ValueError(
                f"price_floor ({self.price_floor}) must be less than "
                f"price_ceiling ({self.price_ceiling})"
            )
        if self.unit_cost >= self.price_floor:
            raise ValueError(
                f"unit_cost ({self.unit_cost}) must be less than "
                f"price_floor ({self.price_floor}) -- a zero-margin floor makes no sense"
            )


@dataclass
class Order:
    order_id: str
    sku_id: str
    seller_id: str
    order_date: date
    units_sold: int
    price_charged: int
    revenue: int               # units_sold * price_charged
    margin: int                # units_sold * (price_charged - unit_cost)

    def __post_init__(self):
        expected_revenue = self.units_sold * self.price_charged
        if self.revenue != expected_revenue:
            raise ValueError(
                f"revenue ({self.revenue}) does not match "
                f"units_sold * price_charged ({expected_revenue})"
            )


@dataclass
class PriceArm:
    arm_id: str
    sku_id: str
    price_value: int
    alpha: float = 1.0          # Beta distribution success count
    beta_param: float = 1.0     # Beta distribution failure count
    times_chosen: int = 0
    is_active: bool = True      # False when floor/ceiling change removes this arm
    last_updated: datetime = field(default_factory=lambda: datetime.now(timezone.utc))

    def __post_init__(self):
        if self.alpha < 1.0 or self.beta_param < 1.0:
            raise ValueError(
                "Beta distribution shape parameters must be >= 1.0. "
                f"Got alpha={self.alpha}, beta_param={self.beta_param}"
            )

    @property
    def posterior_mean(self) -> float:
        return self.alpha / (self.alpha + self.beta_param)

    @property
    def total_observations(self) -> int:
        return int(self.alpha + self.beta_param - 2)   # subtract the 2 prior counts


@dataclass
class AgentAction:
    action_id: str
    sku_id: str
    seller_id: str
    action_date: date
    tool_called: str            # "pricing" | "forecasting" | "both"
    trigger: str                # "scheduled" | "user_message"
    chosen_price: Optional[int] = None
    stockout_probability_5d: Optional[float] = None
    stockout_probability_10d: Optional[float] = None
    stockout_severity: Optional[str] = None    # "urgent" | "watch" | "safe"
    seller_message: Optional[str] = None       # the WhatsApp/dashboard message text
    reasoning_trace: Optional[str] = None      # the full LLM reasoning output
    delivered_via: Optional[str] = None        # "whatsapp" | "dashboard" | "both"
    created_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))


@dataclass
class Conversation:
    message_id: str
    seller_id: str
    direction: str              # "inbound" | "outbound"
    message_body: str
    message_sid: Optional[str] = None    # Twilio SID for inbound messages
    created_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))


@dataclass
class SellerSettings:
    seller_id: str
    daily_alert_time: str = "08:00"         # HH:MM, 24-hour format
    alert_language: str = "hi"              # "hi" or "en"
    notify_on_price_change: bool = True
    notify_on_stockout_risk: bool = True
    price_change_threshold: float = 0.05    # report only if price changes by > 5%
    updated_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))


@dataclass
class DemoState:
    seller_id: str
    current_day: int = 0
    max_days: int = 6
    shock_sku_id: Optional[str] = None
    depletion_sku_id: Optional[str] = None
    shock_triggered: bool = False
    updated_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))

@dataclass
class DemoState:
    seller_id: str
    current_day: int = 0
    max_days: int = 6
    shock_sku_id: Optional[str] = None
    depletion_sku_id: Optional[str] = None
    shock_triggered: bool = False
    updated_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
