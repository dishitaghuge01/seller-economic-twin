from fastapi import HTTPException

import database


def resolve_default_sku(seller_id: str) -> str:
    skus = database.get_skus_for_seller(seller_id)
    if not skus:
        raise HTTPException(status_code=404, detail="No SKU found for seller")
    if len(skus) == 1:
        return skus[0].sku_id

    latest_sku_id = None
    latest_timestamp = None
    for sku in skus:
        actions = database.get_agent_action_history(sku.sku_id, limit=1)
        if not actions:
            continue
        action = actions[0]
        candidate_time = action.created_at
        if latest_timestamp is None or candidate_time > latest_timestamp:
            latest_timestamp = candidate_time
            latest_sku_id = sku.sku_id
    if latest_sku_id is not None:
        return latest_sku_id
    return skus[0].sku_id
