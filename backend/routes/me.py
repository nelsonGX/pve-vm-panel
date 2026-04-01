from __future__ import annotations

from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException, Query
from motor.motor_asyncio import AsyncIOMotorDatabase
from pydantic import BaseModel

from auth import get_current_user, upsert_user, verify_internal_secret
from database import get_db
from models.transaction import TransactionResponse
from models.user import UserResponse

router = APIRouter(tags=["me"])


# -------------------------------------------------------------------------
# POST /me  — called by Next.js after OAuth login to upsert user
# -------------------------------------------------------------------------

class UpsertUserBody(BaseModel):
    discord_id: str
    discord_username: str
    discord_avatar: str | None = None


@router.post("/me", response_model=UserResponse)
async def upsert_me(
    body: UpsertUserBody,
    _: None = Depends(verify_internal_secret),
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    user = await upsert_user(
        discord_id=body.discord_id,
        username=body.discord_username,
        avatar=body.discord_avatar,
        db=db,
    )
    return _to_user_response(user)


# -------------------------------------------------------------------------
# GET /me
# -------------------------------------------------------------------------

@router.get("/me", response_model=UserResponse)
async def get_me(
    current_user: dict = Depends(get_current_user),
):
    return _to_user_response(current_user)


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

def _to_user_response(doc: dict) -> dict:
    return {
        "discord_id": doc["discord_id"],
        "discord_username": doc.get("discord_username", ""),
        "discord_avatar": doc.get("discord_avatar"),
        "points": doc.get("points", 0),
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
