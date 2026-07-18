import os
from datetime import datetime, timedelta, timezone
from typing import Optional

import jwt
from fastapi import Depends, Header, HTTPException

import database
from models import Seller


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


def mint_seller_jwt(auth_user_id: str, expiry_days: int = 7) -> str:
    """
    Mints a JWT with the claim shape expected by main.py's auth dependency:
    sub=auth_user_id, aud="authenticated", plus an exp claim so it expires.
    The token is signed with the same SUPABASE_JWT_SECRET used to verify
    tokens elsewhere in the app.
    """
    now = datetime.now(timezone.utc)
    payload = {
        "sub": auth_user_id,
        "aud": "authenticated",
        "iat": now,
        "exp": now + timedelta(days=expiry_days),
    }
    secret = os.environ["SUPABASE_JWT_SECRET"]
    return jwt.encode(payload, secret, algorithm="HS256")
