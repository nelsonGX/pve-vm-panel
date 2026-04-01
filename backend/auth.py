from __future__ import annotations

from datetime import datetime, timezone

from bson import ObjectId
from fastapi import Depends, Header, HTTPException
from motor.motor_asyncio import AsyncIOMotorDatabase
from pymongo import ReturnDocument
from config import settings

from database import get_db


async def get_current_user(
    x_discord_id: str | None = Header(default=None),
    db: AsyncIOMotorDatabase = Depends(get_db),
) -> dict:
    """Return the user for the Discord ID injected by the Next.js proxy.

    The proxy calls getToken() server-side and sets X-Discord-Id.
    FastAPI only listens on localhost so no additional secret is needed.
    """
    if not x_discord_id:
        raise HTTPException(status_code=401, detail="Not authenticated")

    user = await db.users.find_one({"discord_id": x_discord_id})
    if user is None:
        # Auto-create on first authenticated request (upsert from proxy headers)
        user = await upsert_user(discord_id=x_discord_id, username=x_discord_id, avatar=None, db=db)

    return _serialize_doc(user)


async def require_admin(
    current_user: dict = Depends(get_current_user),
) -> dict:
    if current_user["discord_id"] not in settings.ADMIN_DISCORD_IDS:
        raise HTTPException(status_code=403, detail="Admin access required")
    return current_user


async def upsert_user(
    discord_id: str,
    username: str,
    avatar: str | None,
    db: AsyncIOMotorDatabase,
) -> dict:
    now = datetime.now(timezone.utc)
    result = await db.users.find_one_and_update(
        {"discord_id": discord_id},
        {
            "$set": {"discord_username": username, "discord_avatar": avatar, "updated_at": now},
            "$setOnInsert": {"discord_id": discord_id, "points": 0, "created_at": now},
        },
        upsert=True,
        return_document=ReturnDocument.AFTER,
    )
    return _serialize_doc(result)


def _serialize_doc(doc: dict) -> dict:
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
