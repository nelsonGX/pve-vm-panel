from __future__ import annotations

import secrets
from datetime import datetime, timezone

from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException
from motor.motor_asyncio import AsyncIOMotorDatabase
from pymongo import ReturnDocument

from auth import get_current_user
from database import get_db
from models.code import CodeRedeemRequest

router = APIRouter(tags=["codes"])


def _generate_code() -> str:
    """Generate a PANEL-XXXX-XXXX formatted code."""
    part1 = secrets.token_urlsafe(3).upper()[:4]
    part2 = secrets.token_urlsafe(3).upper()[:4]
    return f"PANEL-{part1}-{part2}"


@router.post("/redeem")
@router.post("/codes/redeem")
async def redeem_code(
    body: CodeRedeemRequest,
    current_user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    discord_id = current_user["discord_id"]
    code_str = body.code.strip().upper()

    # Run inside a MongoDB session for atomicity
    async with await db.client.start_session() as session:
        async with session.start_transaction():
            now = datetime.now(timezone.utc)

            # 1. Look up code
            code_doc = await db.codes.find_one({"code": code_str}, session=session)
            if code_doc is None or not code_doc.get("is_active", True):
                raise HTTPException(status_code=404, detail="Code not found or inactive")

            # 2. Expiry check
            if code_doc.get("expires_at") and code_doc["expires_at"] < now:
                raise HTTPException(status_code=400, detail="Code has expired")

            # 3. Whitelist check
            whitelist = code_doc.get("whitelist_discord_ids", [])
            if whitelist and discord_id not in whitelist:
                raise HTTPException(status_code=403, detail="You are not authorised to use this code")

            # 4. Usage limit check
            max_uses = code_doc.get("max_uses", 0)
            current_uses = code_doc.get("current_uses", 0)
            if max_uses > 0 and current_uses >= max_uses:
                raise HTTPException(status_code=400, detail="Code has reached its usage limit")

            # 5. Check if this user already redeemed this code
            already = await db.redemptions.find_one(
                {"code_id": str(code_doc["_id"]), "discord_id": discord_id},
                session=session,
            )
            if already:
                raise HTTPException(status_code=400, detail="You have already redeemed this code")

            points_value = code_doc["points_value"]

            # 6. Increment code usage
            await db.codes.update_one(
                {"_id": code_doc["_id"]},
                {"$inc": {"current_uses": 1}},
                session=session,
            )

            # 7. Deactivate if now at max
            new_uses = current_uses + 1
            if max_uses > 0 and new_uses >= max_uses:
                await db.codes.update_one(
                    {"_id": code_doc["_id"]},
                    {"$set": {"is_active": False}},
                    session=session,
                )

            # 8. Record redemption
            await db.redemptions.insert_one(
                {
                    "code_id": str(code_doc["_id"]),
                    "discord_id": discord_id,
                    "redeemed_at": now,
                },
                session=session,
            )

            # 9. Credit points
            updated_user = await db.users.find_one_and_update(
                {"discord_id": discord_id},
                {"$inc": {"points": points_value}},
                return_document=ReturnDocument.AFTER,
                session=session,
            )

            # 10. Record transaction
            await db.transactions.insert_one(
                {
                    "user_id": discord_id,
                    "type": "credit",
                    "amount": points_value,
                    "description": f"Code redeemed: {code_str}",
                    "reference_id": str(code_doc["_id"]),
                    "created_at": now,
                },
                session=session,
            )

    return {
        "points_awarded": points_value,
        "new_balance": updated_user["points"],
    }
