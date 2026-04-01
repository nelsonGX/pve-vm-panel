from __future__ import annotations

from datetime import datetime, timezone

from bson import ObjectId
from fastapi import Depends, Header, HTTPException, Request
from motor.motor_asyncio import AsyncIOMotorDatabase
from pymongo import ReturnDocument

from config import settings
from database import get_db


async def verify_internal_secret(
    authorization: str | None = Header(default=None),
) -> None:
    """Validate that the request carries the correct internal Bearer token."""
    expected = f"Bearer {settings.INTERNAL_API_SECRET}"
    if not authorization or authorization != expected:
        raise HTTPException(status_code=401, detail="Invalid or missing internal API secret")


async def get_current_user(
    x_discord_id: str | None = Header(default=None),
    _: None = Depends(verify_internal_secret),
    db: AsyncIOMotorDatabase = Depends(get_db),
) -> dict:
    """Return the user document for the authenticated Discord user."""
    if not x_discord_id:
        raise HTTPException(status_code=401, detail="X-Discord-Id header is required")

    user = await db.users.find_one({"discord_id": x_discord_id})
    if user is None:
        raise HTTPException(status_code=401, detail="User not found")

    return _serialize_doc(user)


async def require_admin(
    current_user: dict = Depends(get_current_user),
) -> dict:
    """Raise 403 if the current user is not an admin."""
    if current_user["discord_id"] not in settings.ADMIN_DISCORD_IDS:
        raise HTTPException(status_code=403, detail="Admin access required")
    return current_user


async def upsert_user(
    discord_id: str,
    username: str,
    avatar: str | None,
    db: AsyncIOMotorDatabase,
) -> dict:
    """Upsert a user document (called after Discord OAuth login)."""
    now = datetime.now(timezone.utc)
    result = await db.users.find_one_and_update(
        {"discord_id": discord_id},
        {
            "$set": {
                "discord_username": username,
                "discord_avatar": avatar,
                "updated_at": now,
            },
            "$setOnInsert": {
                "discord_id": discord_id,
                "points": 0,
                "created_at": now,
            },
        },
        upsert=True,
        return_document=ReturnDocument.AFTER,
    )
    return _serialize_doc(result)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _serialize_doc(doc: dict) -> dict:
    """Convert ObjectId fields to strings so the dict is JSON-serialisable."""
    out: dict = {}
    for k, v in doc.items():
        if isinstance(v, ObjectId):
            out[k] = str(v)
        elif isinstance(v, dict):
            out[k] = _serialize_doc(v)
        elif isinstance(v, list):
            out[k] = [str(i) if isinstance(i, ObjectId) else i for i in v]
        else:
            out[k] = v
    return out
