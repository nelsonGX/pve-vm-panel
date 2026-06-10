from __future__ import annotations

import logging
import secrets
from datetime import datetime, timezone

import httpx
from fastapi import APIRouter, Depends, HTTPException
from motor.motor_asyncio import AsyncIOMotorDatabase
from pymongo import ReturnDocument

from auth import get_current_user
from config import settings
from database import get_db
from models.payment import PayIntentRequest, PayVerifyRequest

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/pay", tags=["pay"])


def _require_enabled() -> None:
    if not settings.payments_enabled:
        raise HTTPException(
            status_code=503,
            detail="Credit payments are not configured on this server.",
        )


async def _fga_post(path: str, data: dict) -> dict:
    """POST form-encoded to a Friend Group Auth endpoint with client auth."""
    payload = {
        "client_id": settings.AUTH_CLIENT_ID,
        "client_secret": settings.AUTH_CLIENT_SECRET,
        **data,
    }
    url = f"{settings.AUTH_BASE_URL.rstrip('/')}{path}"
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.post(url, data=payload)
    except httpx.HTTPError as exc:
        logger.error("Friend Group Auth request failed: %s", exc)
        raise HTTPException(status_code=502, detail="Payment provider unreachable") from exc

    if resp.status_code >= 400:
        detail = "Payment provider error"
        try:
            body = resp.json()
            detail = body.get("error_description") or body.get("error") or detail
        except Exception:  # noqa: BLE001 - non-JSON error body
            pass
        logger.warning("FGA %s -> %s: %s", path, resp.status_code, resp.text[:300])
        raise HTTPException(status_code=502, detail=detail)

    return resp.json()


# -------------------------------------------------------------------------
# GET /pay/config — tells the frontend whether to show the top-up UI
# -------------------------------------------------------------------------
@router.get("/config")
async def pay_config(_: dict = Depends(get_current_user)):
    return {
        "enabled": settings.payments_enabled,
        "points_per_credit": settings.POINTS_PER_CREDIT,
    }


# -------------------------------------------------------------------------
# POST /pay/intent — create a payment intent and return the checkout URL
# -------------------------------------------------------------------------
@router.post("/intent")
async def create_intent(
    body: PayIntentRequest,
    current_user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    _require_enabled()
    discord_id = current_user["discord_id"]
    credits = body.credits
    points = credits * settings.POINTS_PER_CREDIT

    # Fresh idempotency key per attempt — never reuse a ref across amounts.
    ref = f"topup-{discord_id}-{secrets.token_hex(8)}"
    description = f"{points} points ({credits} credits) — Nelson's Free VM"

    result = await _fga_post(
        "/api/pay/intent",
        {
            "amount": credits,  # 1 credit = 1 TWD; no markup applied here
            "ref": ref,
            "redirect_uri": settings.payment_return_url,
            "description": description,
        },
    )

    intent_id = result.get("intent_id")
    url = result.get("url")
    if not intent_id or not url:
        raise HTTPException(status_code=502, detail="Malformed intent response")

    now = datetime.now(timezone.utc)
    await db.payments.insert_one(
        {
            "ref": ref,
            "intent_id": intent_id,
            "discord_id": discord_id,
            "credits": credits,
            "points": points,
            "status": "pending",
            "created_at": now,
        }
    )

    return {"intent_id": intent_id, "url": url, "credits": credits, "points": points}


# -------------------------------------------------------------------------
# POST /pay/verify — verify a returned intent server-side and grant points
# -------------------------------------------------------------------------
@router.post("/verify")
async def verify_intent(
    body: PayVerifyRequest,
    current_user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    _require_enabled()
    discord_id = current_user["discord_id"]

    payment = await db.payments.find_one(
        {"intent_id": body.intent_id, "discord_id": discord_id}
    )
    if payment is None:
        raise HTTPException(status_code=404, detail="Payment not found")

    # Already settled — return the prior outcome without re-granting.
    if payment["status"] == "completed":
        user = await db.users.find_one({"discord_id": discord_id})
        return {
            "status": "completed",
            "paid": True,
            "points_awarded": payment.get("points", 0),
            "new_balance": (user or {}).get("points", 0),
            "already_credited": True,
        }

    # Authoritative server-side check with the payment provider.
    result = await _fga_post("/api/pay/verify", {"intent_id": body.intent_id})
    paid = result.get("paid") is True
    status = result.get("status", "unknown")

    if not paid:
        await db.payments.update_one(
            {"_id": payment["_id"], "status": "pending"},
            {"$set": {"status": status, "updated_at": datetime.now(timezone.utc)}},
        )
        return {"status": status, "paid": False}

    # Sanity: the provider must confirm the same amount we created the intent for.
    if result.get("amount") != payment["credits"]:
        logger.error(
            "Amount mismatch for intent %s: provider=%s stored=%s",
            body.intent_id, result.get("amount"), payment["credits"],
        )
        raise HTTPException(status_code=409, detail="Payment amount mismatch")

    points = payment["points"]
    updated_user = None

    # Atomically claim the grant so concurrent verifies can't double-credit.
    async with await db.client.start_session() as session:
        async with session.start_transaction():
            now = datetime.now(timezone.utc)
            claimed = await db.payments.find_one_and_update(
                {"_id": payment["_id"], "status": "pending"},
                {"$set": {"status": "completed", "completed_at": now}},
                session=session,
            )
            # claimed is None → another request already credited it; the
            # transaction commits as a harmless no-op and we report success.
            if claimed is not None:
                updated_user = await db.users.find_one_and_update(
                    {"discord_id": discord_id},
                    {"$inc": {"points": points}},
                    return_document=ReturnDocument.AFTER,
                    session=session,
                )
                await db.transactions.insert_one(
                    {
                        "user_id": discord_id,
                        "type": "credit",
                        "amount": points,
                        "description": f"Credit top-up: {payment['credits']} credits",
                        "reference_id": body.intent_id,
                        "created_at": now,
                    },
                    session=session,
                )

    if updated_user is None:
        # Lost the race — read the current balance for the response.
        user = await db.users.find_one({"discord_id": discord_id})
        return {
            "status": "completed",
            "paid": True,
            "points_awarded": points,
            "new_balance": (user or {}).get("points", 0),
            "already_credited": True,
        }

    return {
        "status": "completed",
        "paid": True,
        "points_awarded": points,
        "new_balance": updated_user["points"],
        "already_credited": False,
    }
