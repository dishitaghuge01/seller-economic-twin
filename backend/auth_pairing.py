import os
import re

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

import database
from auth_utils import mint_seller_jwt
from whatsapp import send_whatsapp_message

router = APIRouter()

SANDBOX_JOIN_KEYWORD = os.getenv("TWILIO_SANDBOX_JOIN_KEYWORD", "")
WA_ME_LINK = (
    f"https://wa.me/14155238886?text=join%20{SANDBOX_JOIN_KEYWORD.replace(' ', '%20')}"
    if SANDBOX_JOIN_KEYWORD
    else "https://wa.me/14155238886"
)


class StartPairingRequest(BaseModel):
    phone_number: str
    seller_name: str | None = None


def _normalize_phone(phone_number: str) -> str:
    phone = (phone_number or "").strip()
    if not phone.startswith("+"):
        raise HTTPException(status_code=400, detail="Invalid phone number")

    digits_only = re.sub(r"\D", "", phone)
    if not 8 <= len(digits_only) <= 15:
        raise HTTPException(status_code=400, detail="Invalid phone number")
    return f"+{digits_only}"


# These endpoints intentionally bypass get_current_seller so a new seller can
# obtain a token from the pairing flow itself. The only abuse mitigation built
# in at the moment is the 30-second debounce in upsert_pairing_session; if this
# becomes public-facing traffic, a per-IP rate limit would be the next step.
@router.post("/auth/start-pairing")
async def start_pairing(body: StartPairingRequest):
    phone = _normalize_phone(body.phone_number)
    seller_name = body.seller_name.strip() if body.seller_name else None
    database.upsert_pairing_session(phone, seller_name=seller_name)

    existing_seller = database.get_seller_by_phone(phone)
    if existing_seller is not None:
        if existing_seller.seller_name == "New Seller" and seller_name:
            database.update_seller_name(existing_seller.seller_id, seller_name)
        try:
            token = mint_seller_jwt(existing_seller.auth_user_id)
            result = send_whatsapp_message(
                existing_seller.seller_id,
                f"Yahan aapka login link hai: {os.getenv('FRONTEND_URL', 'http://localhost:3000')}?token={token}",
            )
            if result.get("status") == "sent":
                database.complete_pairing_session(phone, token, existing_seller.seller_id)
        except Exception:
            pass

    return {"status": "pending", "wa_link": WA_ME_LINK}


def _demo_login_enabled() -> bool:
    return (os.getenv("DEMO_LOGIN_ENABLED", "").strip().lower() == "true")


@router.get("/auth/demo-login")
async def demo_login():
    if not _demo_login_enabled():
        raise HTTPException(status_code=404, detail="Not Found")

    demo_seller_id = os.getenv("DEMO_SELLER_ID", "riya_sharma")
    seller = database.get_seller_by_id(demo_seller_id)
    if seller is None:
        raise HTTPException(status_code=500, detail="Demo seller not seeded — run seed_data.py")

    token = mint_seller_jwt(seller.auth_user_id, expiry_days=1)
    return {"token": token, "seller_name": seller.seller_name}


@router.get("/auth/pairing-status")
async def pairing_status(phone_number: str):
    phone = _normalize_phone(phone_number)
    session = database.get_pairing_session(phone)
    if session is None:
        return {"status": "expired"}
    if session["status"] == "complete":
        return {"status": "complete", "token": session["jwt_token"]}
    return {"status": "pending"}
