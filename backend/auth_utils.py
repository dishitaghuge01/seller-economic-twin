import os
from datetime import datetime, timedelta, timezone

import jwt


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
