from __future__ import annotations

import hashlib
import secrets
from datetime import datetime, timezone

from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException
from motor.motor_asyncio import AsyncIOMotorDatabase
from pydantic import BaseModel, field_validator

from auth import get_current_user
from database import get_db

router = APIRouter(tags=["api-tokens"])

TOKEN_PREFIX = "pvp_"
MAX_TOKENS_PER_USER = 10


class ApiTokenCreateRequest(BaseModel):
    name: str

    @field_validator("name")
    @classmethod
    def validate_name(cls, v: str) -> str:
        name = v.strip()
        if not name or len(name) > 64:
            raise ValueError("name must be 1-64 characters")
        return name


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


async def get_user_by_api_token(token: str, db: AsyncIOMotorDatabase) -> dict | None:
    """Resolve a personal API token to its owner's user doc, or None if invalid."""
    if not token.startswith(TOKEN_PREFIX):
        return None
    token_doc = await db.api_tokens.find_one_and_update(
        {"token_hash": hash_token(token)},
        {"$set": {"last_used_at": datetime.now(timezone.utc)}},
    )
    if token_doc is None:
        return None
    return await db.users.find_one({"discord_id": token_doc["user_id"]})


@router.get("/me/api-tokens")
async def list_api_tokens(
    current_user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    docs = await (
        db.api_tokens.find({"user_id": current_user["discord_id"]})
        .sort("created_at", -1)
        .to_list(length=MAX_TOKENS_PER_USER)
    )
    return [_to_token_response(d) for d in docs]


@router.post("/me/api-tokens")
async def create_api_token(
    body: ApiTokenCreateRequest,
    current_user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    discord_id = current_user["discord_id"]
    count = await db.api_tokens.count_documents({"user_id": discord_id})
    if count >= MAX_TOKENS_PER_USER:
        raise HTTPException(
            status_code=400,
            detail=f"You can have at most {MAX_TOKENS_PER_USER} API tokens",
        )

    token = TOKEN_PREFIX + secrets.token_urlsafe(32)
    doc = {
        "user_id": discord_id,
        "name": body.name,
        "token_hash": hash_token(token),
        "token_hint": token[:8] + "…" + token[-4:],
        "created_at": datetime.now(timezone.utc),
        "last_used_at": None,
    }
    result = await db.api_tokens.insert_one(doc)
    doc["_id"] = result.inserted_id

    # The plaintext token is only ever returned here.
    return {**_to_token_response(doc), "token": token}


@router.delete("/me/api-tokens/{token_id}", status_code=204)
async def delete_api_token(
    token_id: str,
    current_user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    try:
        oid = ObjectId(token_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid token_id")

    result = await db.api_tokens.delete_one(
        {"_id": oid, "user_id": current_user["discord_id"]}
    )
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Token not found")


def _to_token_response(doc: dict) -> dict:
    return {
        "id": str(doc["_id"]),
        "name": doc["name"],
        "token_hint": doc["token_hint"],
        "created_at": _ensure_utc(doc["created_at"]),
        "last_used_at": _ensure_utc(doc.get("last_used_at")),
    }


def _ensure_utc(dt: datetime | None) -> datetime | None:
    if dt is not None and dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt
