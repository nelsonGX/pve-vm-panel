from __future__ import annotations

import secrets
from datetime import datetime, timezone

from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException, Query
from motor.motor_asyncio import AsyncIOMotorDatabase
from pydantic import BaseModel
from pymongo import ReturnDocument

from auth import require_admin
from database import get_db
from models.code import CodeCreateRequest, CodeResponse
from services.vm_lifecycle import delete_vm

router = APIRouter(prefix="/admin", tags=["admin"])


@router.get("/check")
async def admin_check(_admin: dict = Depends(require_admin)):
    """Returns 200 if the caller is an admin, 403 otherwise (via dependency)."""
    return {"is_admin": True}


# =========================================================================
# VMs
# =========================================================================


@router.get("/vms")
async def admin_list_vms(
    skip: int = Query(default=0, ge=0),
    limit: int = Query(default=50, ge=1, le=200),
    status: str | None = Query(default=None),
    _admin: dict = Depends(require_admin),
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    query: dict = {}
    if status:
        query["status"] = status
    cursor = db.vms.find(query).sort("created_at", -1).skip(skip).limit(limit)
    docs = await cursor.to_list(length=limit)
    total = await db.vms.count_documents(query)
    return {
        "total": total,
        "skip": skip,
        "limit": limit,
        "items": [_vm_doc(d) for d in docs],
    }


@router.delete("/vms/{vm_id}", status_code=204)
async def admin_delete_vm(
    vm_id: str,
    _admin: dict = Depends(require_admin),
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    try:
        oid = ObjectId(vm_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid vm_id")

    vm_doc = await db.vms.find_one({"_id": oid})
    if vm_doc is None:
        raise HTTPException(status_code=404, detail="VM not found")

    if vm_doc["status"] not in ("provisioning", "running"):
        raise HTTPException(status_code=400, detail="VM is not active")

    await delete_vm(vm_doc, db)


# =========================================================================
# Users
# =========================================================================


@router.get("/users")
async def admin_list_users(
    skip: int = Query(default=0, ge=0),
    limit: int = Query(default=50, ge=1, le=200),
    _admin: dict = Depends(require_admin),
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    cursor = db.users.find({}).sort("created_at", -1).skip(skip).limit(limit)
    docs = await cursor.to_list(length=limit)
    total = await db.users.count_documents({})
    return {
        "total": total,
        "skip": skip,
        "limit": limit,
        "items": [_user_doc(d) for d in docs],
    }


class AdjustPointsBody(BaseModel):
    delta: int          # positive = add, negative = remove
    reason: str = "Admin adjustment"


@router.post("/users/{user_id}/adjust-points")
async def admin_adjust_points(
    user_id: str,
    body: AdjustPointsBody,
    _admin: dict = Depends(require_admin),
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    # user_id can be ObjectId or discord_id
    query: dict
    try:
        query = {"_id": ObjectId(user_id)}
    except Exception:
        query = {"discord_id": user_id}

    updated = await db.users.find_one_and_update(
        query,
        {"$inc": {"points": body.delta}},
        return_document=ReturnDocument.AFTER,
    )
    if updated is None:
        raise HTTPException(status_code=404, detail="User not found")

    # Record transaction
    tx_type = "credit" if body.delta >= 0 else "debit"
    await db.transactions.insert_one(
        {
            "user_id": updated["discord_id"],
            "type": tx_type,
            "amount": abs(body.delta),
            "description": body.reason,
            "reference_id": None,
            "created_at": datetime.now(timezone.utc),
        }
    )

    return {"discord_id": updated["discord_id"], "new_balance": updated["points"]}


# =========================================================================
# Codes
# =========================================================================


def _make_code_str() -> str:
    """Generate PANEL-XXXX-XXXX code."""
    alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
    part1 = "".join(secrets.choice(alphabet) for _ in range(4))
    part2 = "".join(secrets.choice(alphabet) for _ in range(4))
    return f"PANEL-{part1}-{part2}"


@router.post("/codes")
async def admin_create_code(
    body: CodeCreateRequest,
    _admin: dict = Depends(require_admin),
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    now = datetime.now(timezone.utc)
    code_str = body.code.strip().upper() if body.code else _make_code_str()

    # Ensure uniqueness (retry on collision)
    for _attempt in range(5):
        existing = await db.codes.find_one({"code": code_str})
        if existing is None:
            break
        code_str = _make_code_str()
    else:
        raise HTTPException(status_code=500, detail="Could not generate unique code after 5 attempts")

    doc = {
        "code": code_str,
        "points_value": body.points_value,
        "max_uses": body.max_uses,
        "current_uses": 0,
        "whitelist_discord_ids": body.whitelist_discord_ids,
        "expires_at": body.expires_at,
        "created_at": now,
        "is_active": True,
    }
    result = await db.codes.insert_one(doc)
    doc["_id"] = result.inserted_id
    return _code_doc(doc)


@router.get("/codes")
async def admin_list_codes(
    skip: int = Query(default=0, ge=0),
    limit: int = Query(default=50, ge=1, le=200),
    active_only: bool = Query(default=False),
    _admin: dict = Depends(require_admin),
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    query: dict = {}
    if active_only:
        query["is_active"] = True
    cursor = db.codes.find(query).sort("created_at", -1).skip(skip).limit(limit)
    docs = await cursor.to_list(length=limit)
    total = await db.codes.count_documents(query)
    return {
        "total": total,
        "skip": skip,
        "limit": limit,
        "items": [_code_doc(d) for d in docs],
    }


@router.delete("/codes/{code_id}", status_code=204)
async def admin_delete_code(
    code_id: str,
    _admin: dict = Depends(require_admin),
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    try:
        oid = ObjectId(code_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid code_id")

    result = await db.codes.delete_one({"_id": oid})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Code not found")


# =========================================================================
# Serialisers
# =========================================================================


def _vm_doc(doc: dict) -> dict:
    return {
        "vm_id": str(doc["_id"]),
        "vmid": doc["vmid"],
        "user_id": doc["user_id"],
        "os": doc["os"],
        "cpu_cores": doc["cpu_cores"],
        "ram_gb": doc["ram_gb"],
        "disk_gb": doc["disk_gb"],
        "gpu_id": doc.get("gpu_id"),
        "ip_address": doc.get("ip_address"),
        "username": doc.get("username"),
        "status": doc["status"],
        "created_at": doc["created_at"],
        "expires_at": doc["expires_at"],
        "points_charged": doc.get("points_charged", 0),
    }


def _user_doc(doc: dict) -> dict:
    return {
        "id": str(doc["_id"]),
        "discord_id": doc["discord_id"],
        "discord_username": doc.get("discord_username", ""),
        "discord_avatar": doc.get("discord_avatar"),
        "points": doc.get("points", 0),
        "created_at": doc.get("created_at"),
    }


def _code_doc(doc: dict) -> dict:
    return {
        "id": str(doc["_id"]),
        "code": doc["code"],
        "points_value": doc["points_value"],
        "max_uses": doc["max_uses"],
        "current_uses": doc.get("current_uses", 0),
        "whitelist_discord_ids": doc.get("whitelist_discord_ids", []),
        "expires_at": doc.get("expires_at"),
        "created_at": doc["created_at"],
        "is_active": doc.get("is_active", True),
    }
