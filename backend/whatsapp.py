import logging
import os
import uuid
from typing import Any, Dict, Optional

from fastapi import APIRouter, HTTPException, Request, Response
from fastapi.responses import JSONResponse
from twilio import request_validator
from twilio.base.exceptions import TwilioRestException
from twilio.rest import Client
from twilio.twiml.messaging_response import MessagingResponse

import database
from agent_core import AgentCoreError, run_agent_cycle
from auth_utils import mint_seller_jwt
from models import Conversation
from sku_resolution import resolve_default_sku

logger = logging.getLogger(__name__)
router = APIRouter()


def _get_twilio_account_sid() -> str:
    return os.getenv("TWILIO_ACCOUNT_SID", "")


def _get_twilio_auth_token() -> str:
    return os.getenv("TWILIO_AUTH_TOKEN", "")


def _get_twilio_whatsapp_number() -> str:
    return os.getenv("TWILIO_WHATSAPP_NUMBER", "")


def _get_internal_api_key() -> str:
    return os.getenv("INTERNAL_API_KEY", "")


def _fallback_message(language_preference: Optional[str]) -> str:
    if language_preference == "hi":
        return "Maaf kijiye, abhi thodi problem ho rahi hai. Thodi der baad try karein."
    return "Sorry, I'm having trouble right now. Please try again in a few minutes."


async def _get_form_data(request: Request) -> Dict[str, str]:
    form = await request.form()
    return {key: value for key, value in form.items()}


@router.post("/webhook")
async def whatsapp_webhook(request: Request) -> Response:
    signature = request.headers.get("X-Twilio-Signature", "")
    if not signature:
        logger.warning("Rejected Twilio webhook without signature")
        return Response(status_code=403)

    # Render and similar reverse proxies commonly present the inbound request
    # as http:// even when the public URL is https://. Reconstruct the URL
    # from X-Forwarded-Proto when available so Twilio signature validation
    # works in production.
    forwarded_proto = request.headers.get("x-forwarded-proto")
    if forwarded_proto:
        scheme = forwarded_proto.split(",")[0].strip()
    else:
        scheme = request.url.scheme

    forwarded_host = request.headers.get("x-forwarded-host") or request.headers.get("host") or request.url.netloc
    url = f"{scheme}://{forwarded_host}{request.url.path}"

    form_data = await _get_form_data(request)
    validator = request_validator.RequestValidator(_get_twilio_auth_token())
    if not validator.validate(url, form_data, signature):
        logger.warning("Rejected Twilio webhook with invalid signature")
        return Response(status_code=403)

    message_sid = form_data.get("MessageSid", "")
    if message_already_processed(message_sid):
        return Response(content="<Response></Response>", media_type="application/xml")

    from_number = form_data.get("From", "")
    if from_number.startswith("whatsapp:"):
        from_number = from_number[len("whatsapp:"):]

    seller = database.get_seller_by_phone(from_number)
    if seller is None:
        seller = database.create_seller_from_phone(from_number)

    token = mint_seller_jwt(seller.auth_user_id)
    database.complete_pairing_session(from_number, token, seller.seller_id)

    inbound_msg = Conversation(
        message_id=str(uuid.uuid4()),
        seller_id=seller.seller_id,
        direction="inbound",
        message_body=form_data.get("Body", ""),
        message_sid=message_sid,
    )
    database.insert_conversation_message(inbound_msg)

    if not database.get_skus_for_seller(seller.seller_id):
        frontend_url = os.getenv("FRONTEND_URL", "http://localhost:3000")
        response_text = (
            "Namaste! Aapka account ban gaya hai. Apna pehla product add karne ke liye "
            f"dashboard kholein: {frontend_url}?token={token}"
        )
    else:
        resolved_sku_id = resolve_default_sku(seller.seller_id)
        try:
            agent_result = run_agent_cycle(
                seller.seller_id,
                resolved_sku_id,
                trigger="user_message",
                message_text=form_data.get("Body", ""),
            )
            response_text = agent_result["seller_message"]
        except AgentCoreError as exc:
            logger.warning("Agent cycle failed for seller %s: %s", seller.seller_id, exc)
            response_text = _fallback_message(seller.language_preference)

    outbound_msg = Conversation(
        message_id=str(uuid.uuid4()),
        seller_id=seller.seller_id,
        direction="outbound",
        message_body=response_text,
        message_sid=None,
    )
    database.insert_conversation_message(outbound_msg)

    twiml = MessagingResponse()
    twiml.message(response_text)
    return Response(content=str(twiml), media_type="application/xml")


def send_whatsapp_message(seller_id: str, message_body: str) -> dict:
    seller = database.get_seller_by_id(seller_id)
    if seller is None:
        return {"status": "error", "reason": "seller_not_found"}

    client = Client(_get_twilio_account_sid(), _get_twilio_auth_token())

    try:
        message = client.messages.create(
            from_=_get_twilio_whatsapp_number(),
            to=f"whatsapp:{seller.phone_number}",
            body=message_body,
        )
    except Exception as exc:
        error_code = getattr(exc, "code", None)
        error_text = str(exc)
        if error_code == 63016 or "63016" in error_text:
            logger.warning(
                "Skipped outbound WhatsApp send for seller %s because it was outside 24h window (Twilio Sandbox constraint): %s",
                seller.seller_id,
                error_text,
            )
            return {"status": "skipped", "reason": "outside 24h window"}
        logger.error("Twilio send failed for seller %s: %s", seller.seller_id, exc)
        return {"status": "error", "detail": str(exc)}

    database.insert_conversation_message(
        Conversation(
            message_id=str(uuid.uuid4()),
            seller_id=seller.seller_id,
            direction="outbound",
            message_body=message_body,
            message_sid=getattr(message, "sid", None),
        )
    )
    return {"status": "sent", "message_sid": getattr(message, "sid", None)}


@router.post("/send")
async def send_whatsapp_route(request: Request) -> JSONResponse:
    provided_key = request.headers.get("X-Internal-Key")
    if not provided_key or provided_key != _get_internal_api_key():
        return JSONResponse(status_code=401, content={"detail": "Unauthorized"})

    payload = await request.json()
    result = send_whatsapp_message(payload.get("seller_id"), payload.get("message_body"))

    if result["status"] == "sent":
        return JSONResponse(status_code=200, content=result)
    if result["status"] == "skipped":
        return JSONResponse(status_code=200, content=result)
    if result.get("reason") == "seller_not_found":
        return JSONResponse(status_code=404, content={"detail": "Seller not found"})
    return JSONResponse(status_code=502, content={"detail": result.get("detail", "Twilio send failed")})


def message_already_processed(message_sid: str) -> bool:
    return database.message_already_processed(message_sid)
