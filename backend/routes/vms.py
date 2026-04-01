from __future__ import annotations

import asyncio
import json
from datetime import datetime, timezone

from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from motor.motor_asyncio import AsyncIOMotorDatabase

from auth import get_current_user
from database import get_db
from models.vm import VMCreateRequest, VMCreateResponse, VMResponse
from services.vm_lifecycle import create_vm, delete_vm

router = APIRouter(tags=["vms"])


@router.get("/vms")
async def list_my_vms(
    current_user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    """Return all VMs belonging to the current user, newest first."""
    discord_id = current_user["discord_id"]
    cursor = db.vms.find({"user_id": discord_id}).sort("created_at", -1)
    docs = await cursor.to_list(length=500)
    return [_vm_to_response(d) for d in docs]


@router.post("/vms", response_model=VMCreateResponse)
async def provision_vm(
    body: VMCreateRequest,
    current_user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    try:
        return await create_vm(body, current_user, db)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/vms/stream")
async def provision_vm_stream(
    body: VMCreateRequest,
    current_user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    """Stream VM provisioning progress as Server-Sent Events (text/event-stream).

    Events:
      data: {"type": "step", "step": "<name>", "status": "loading"|"done"}
      data: {"type": "complete", "data": {credentials}}
      data: {"type": "error", "message": "<msg>"}
    """
    queue: asyncio.Queue = asyncio.Queue()

    async def _run() -> None:
        try:
            result = await create_vm(body, current_user, db, progress=queue)
            await queue.put({
                "type": "complete",
                "data": {
                    "vm_id": result.vm_id,
                    "vmid": result.vmid,
                    "ip_address": result.ip_address,
                    "username": result.username,
                    "password": result.password,
                    "expires_at": result.expires_at.isoformat(),
                    "points_charged": result.points_charged,
                },
            })
        except ValueError as exc:
            await queue.put({"type": "error", "message": str(exc)})
        except Exception as exc:
            await queue.put({"type": "error", "message": f"Unexpected error: {exc}"})
        finally:
            await queue.put(None)  # sentinel — signals end of stream

    asyncio.create_task(_run())

    async def _stream():
        while True:
            item = await queue.get()
            if item is None:
                break
            yield f"data: {json.dumps(item)}\n\n"

    return StreamingResponse(
        _stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.delete("/vms/{vm_id}", status_code=204)
async def remove_vm(
    vm_id: str,
    current_user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    try:
        oid = ObjectId(vm_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid vm_id")

    vm_doc = await db.vms.find_one({"_id": oid})
    if vm_doc is None:
        raise HTTPException(status_code=404, detail="VM not found")

    if vm_doc["user_id"] != current_user["discord_id"]:
        raise HTTPException(status_code=403, detail="You do not own this VM")

    if vm_doc["status"] not in ("provisioning", "running"):
        raise HTTPException(status_code=400, detail="VM is not active")

    await delete_vm(vm_doc, db)


# ---------------------------------------------------------------------------
# Helper
# ---------------------------------------------------------------------------


def _ensure_utc(dt: datetime) -> datetime:
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt


def _vm_to_response(doc: dict) -> dict:
    return {
        "id": str(doc["_id"]),
        "vmid": doc["vmid"],
        "user_id": doc["user_id"],
        "name": doc.get("name", ""),
        "os": doc["os"],
        "cpu_cores": doc["cpu_cores"],
        "ram_gb": doc["ram_gb"],
        "disk_gb": doc["disk_gb"],
        "has_gpu": doc.get("gpu_id") is not None,
        "ip": doc.get("ip_address"),
        "username": doc.get("username"),
        "status": doc["status"],
        "created_at": _ensure_utc(doc["created_at"]),
        "expires_at": _ensure_utc(doc["expires_at"]),
        "points_charged": doc.get("points_charged", 0),
    }
