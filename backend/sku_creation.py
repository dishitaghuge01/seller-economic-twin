import re
import uuid
from typing import Callable, Optional

import database
from models import SKU


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


def create_sku_for_seller(
    seller_id: str,
    sku_name: str,
    current_stock: int,
    reorder_point: int,
    unit_cost: int,
    price_floor: int,
    price_ceiling: int,
    generate_sku_id: Optional[Callable[[str], str]] = None,
) -> SKU:
    cleaned_name = (sku_name or "").strip()
    if not cleaned_name:
        raise ValueError("Product name is required")
    if current_stock < 0:
        raise ValueError("Current stock must be 0 or greater")
    if reorder_point < 0:
        raise ValueError("Reorder point must be 0 or greater")

    sku_id = (generate_sku_id or _generate_sku_id)(cleaned_name)
    sku = SKU(
        sku_id=sku_id,
        seller_id=seller_id,
        sku_name=cleaned_name,
        current_stock=current_stock,
        reorder_point=reorder_point,
        unit_cost=unit_cost,
        price_floor=price_floor,
        price_ceiling=price_ceiling,
        current_chosen_price=None,
    )
    database.insert_sku(sku)
    database.recompute_price_arms(sku.sku_id, sku.price_floor, sku.price_ceiling)
    return sku
