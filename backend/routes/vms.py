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
from models.vm import BulkVMCreateRequest, VMCreateRequest, VMCreateResponse, VMResponse
from services.vm_lifecycle import bulk_create_vms, create_vm, delete_vm
from services.pve import PVEError, pve_client

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


@router.post("/vms/bulk/stream")
async def provision_vms_bulk_stream(
    body: BulkVMCreateRequest,
    current_user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    """Stream bulk VM provisioning progress as Server-Sent Events.

    Events:
      data: {"type": "prep_step", "step": "<name>", "status": "loading"|"done"|"error"}
      data: {"type": "vm_step", "vm_index": N, "step": "<name>", "status": "loading"|"done"|"error"}
      data: {"type": "vm_done", "vm_index": N, "credentials": {...}}
      data: {"type": "vm_error", "vm_index": N, "message": "<msg>"}
      data: {"type": "complete", "total": N, "succeeded": M}
      data: {"type": "error", "message": "<msg>"}
    """
    queue: asyncio.Queue = asyncio.Queue()

    async def _run() -> None:
        try:
            results = await bulk_create_vms(body, current_user, db, progress=queue)
            await queue.put({
                "type": "complete",
                "total": body.count,
                "succeeded": len(results),
            })
        except ValueError as exc:
            await queue.put({"type": "error", "message": str(exc)})
        except Exception as exc:
            await queue.put({"type": "error", "message": f"Unexpected error: {exc}"})
        finally:
            await queue.put(None)

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


@router.delete("/vms/bulk/{bulk_id}", status_code=204)
async def remove_bulk_vms(
    bulk_id: str,
    current_user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    discord_id = current_user["discord_id"]
    docs = await db.vms.find(
        {
            "bulk_id": bulk_id,
            "user_id": discord_id,
            "status": {"$in": ["provisioning", "running", "stopped"]},
        }
    ).to_list(length=200)

    if not docs:
        raise HTTPException(status_code=404, detail="No manageable VMs found for this bulk ID")

    await asyncio.gather(*[delete_vm(doc, db) for doc in docs], return_exceptions=True)


@router.post("/vms/bulk/{bulk_id}/{action}")
async def bulk_vm_action(
    bulk_id: str,
    action: str,
    current_user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    discord_id = current_user["discord_id"]
    action_config = _get_action_config(action)
    docs = await db.vms.find(
        {
            "bulk_id": bulk_id,
            "user_id": discord_id,
            "status": action_config["allowed_statuses"],
        }
    ).to_list(length=200)

    if not docs:
        raise HTTPException(
            status_code=404,
            detail=f"No VMs in this bulk group can be {action_config['verb']}",
        )

    results = await asyncio.gather(
        *[_run_vm_action(doc, db, action) for doc in docs],
        return_exceptions=True,
    )
    failures = [r for r in results if isinstance(r, Exception)]
    if failures:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to {action} {len(failures)} of {len(docs)} VMs",
        )

    return {"updated": len(docs), "action": action}


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

    if vm_doc["status"] not in ("provisioning", "running", "stopped"):
        raise HTTPException(status_code=400, detail="VM cannot be deleted in its current state")

    await delete_vm(vm_doc, db)


@router.post("/vms/{vm_id}/{action}")
async def vm_action(
    vm_id: str,
    action: str,
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

    await _run_vm_action(vm_doc, db, action)
    return {"action": action, "vm_id": vm_id}


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
        "bulk_id": doc.get("bulk_id"),
    }


def _get_action_config(action: str) -> dict:
    configs = {
        "start": {
            "allowed_statuses": {"$in": ["stopped"]},
            "verb": "started",
            "result_status": "running",
        },
        "stop": {
            "allowed_statuses": {"$in": ["running"]},
            "verb": "stopped",
            "result_status": "stopped",
        },
        "restart": {
            "allowed_statuses": {"$in": ["running"]},
            "verb": "restarted",
            "result_status": "running",
        },
    }
    config = configs.get(action)
    if config is None:
        raise HTTPException(status_code=404, detail="Unknown VM action")
    return config


async def _run_vm_action(vm_doc: dict, db: AsyncIOMotorDatabase, action: str) -> None:
    action_config = _get_action_config(action)
    current_status = vm_doc.get("status")
    if current_status not in action_config["allowed_statuses"]["$in"]:
        raise HTTPException(
            status_code=400,
            detail=f"VM cannot be {action_config['verb']} while status is '{current_status}'",
        )

    vmid = vm_doc["vmid"]
    vm_object_id = vm_doc["_id"]
    try:
        if action == "start":
            await pve_client.start_vm(vmid)
            await _poll_for_state(vmid, "running")
        elif action == "stop":
            await pve_client.stop_vm(vmid)
            await _poll_for_state(vmid, "stopped")
        elif action == "restart":
            reboot_upid = await pve_client.restart_vm(vmid)
            if reboot_upid:
                await pve_client.poll_task(reboot_upid, timeout_seconds=300)
            await _poll_for_state(vmid, "running")

        await db.vms.update_one(
            {"_id": vm_object_id},
            {"$set": {"status": action_config["result_status"]}},
        )
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Failed to {action} VM {vmid}: {exc}") from exc


async def _poll_for_state(
    vmid: int,
    expected_state: str,
    timeout_seconds: int = 180,
    poll_interval: float = 3.0,
) -> None:
    elapsed = 0.0
    while elapsed < timeout_seconds:
        await asyncio.sleep(poll_interval)
        elapsed += poll_interval
        try:
            status_data = await pve_client.get_vm_status(vmid)
        except Exception as exc:
            raise PVEError(f"Failed to query VM {vmid} status: {exc}") from exc

        if status_data and status_data.get("status") == expected_state:
            return

    raise PVEError(f"VM {vmid} did not reach '{expected_state}' after {timeout_seconds}s")
