from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from motor.motor_asyncio import AsyncIOMotorDatabase

from auth import get_current_user
from database import get_db

router = APIRouter(tags=["me"])


# -------------------------------------------------------------------------
# GET /me
# -------------------------------------------------------------------------

@router.get("/me")
async def get_me(
    current_user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    active_vm_count = await db.vms.count_documents(
        {
            "user_id": current_user["discord_id"],
            "status": {"$in": ["provisioning", "running"]},
        }
    )
    return _to_user_response(current_user, active_vm_count)


# -------------------------------------------------------------------------
# GET /me/transactions
# -------------------------------------------------------------------------

@router.get("/me/transactions")
async def get_my_transactions(
    skip: int = Query(default=0, ge=0),
    limit: int = Query(default=20, ge=1, le=100),
    current_user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    discord_id = current_user["discord_id"]
    cursor = (
        db.transactions.find({"user_id": discord_id})
        .sort("created_at", -1)
        .skip(skip)
        .limit(limit)
    )
    docs = await cursor.to_list(length=limit)
    total = await db.transactions.count_documents({"user_id": discord_id})
    return {
        "total": total,
        "skip": skip,
        "limit": limit,
        "items": [_to_transaction_response(d) for d in docs],
    }


# -------------------------------------------------------------------------
# Helpers
# -------------------------------------------------------------------------

def _to_user_response(doc: dict, active_vm_count: int) -> dict:
    return {
        "discord_id": doc["discord_id"],
        "discord_username": doc.get("discord_username", ""),
        "discord_avatar": doc.get("discord_avatar"),
        "points": doc.get("points", 0),
        "active_vm_count": active_vm_count,
        "created_at": doc.get("created_at"),
    }


def _to_transaction_response(doc: dict) -> dict:
    return {
        "id": str(doc["_id"]),
        "user_id": doc["user_id"],
        "type": doc["type"],
        "amount": doc["amount"],
        "description": doc.get("description", ""),
        "reference_id": doc.get("reference_id"),
        "created_at": doc["created_at"],
    }
