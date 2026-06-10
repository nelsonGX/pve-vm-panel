from __future__ import annotations

import asyncio
import ipaddress
import logging
import math
import random
import secrets
import string
import uuid
from urllib.parse import quote
from datetime import datetime, timedelta, timezone

import bcrypt
from bson import ObjectId
from motor.motor_asyncio import AsyncIOMotorDatabase
from pymongo.errors import DuplicateKeyError
from pymongo import ReturnDocument

from config import settings
from models.vm import BulkVMCreateRequest, VMCreateRequest, VMCreateResponse
from services.pve import PVEError, pve_client

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Streaming progress helper
# ---------------------------------------------------------------------------


async def _emit(queue: asyncio.Queue | None, step: str, status: str) -> None:
    """Push a progress event to the SSE queue. No-op when queue is None."""
    if queue is not None:
        await queue.put({"type": "step", "step": step, "status": status})


# ---------------------------------------------------------------------------
# Cost calculation
# ---------------------------------------------------------------------------


def calculate_cost(
    cpu_cores: int,
    ram_gb: int,
    disk_gb: int,
    has_gpu: bool,
    duration_hours: int,
) -> int:
    """Return the integer point cost for the given spec, minimum 1."""
    cost = (
        cpu_cores * settings.PRICE_CPU_CORE_HOUR
        + ram_gb * settings.PRICE_RAM_GB_HOUR
        + disk_gb * settings.PRICE_DISK_GB_HOUR
        + (settings.PRICE_GPU_HOUR if has_gpu else 0)
    ) * duration_hours
    return max(1, math.ceil(cost))


# ---------------------------------------------------------------------------
# IP allocation
# ---------------------------------------------------------------------------


async def get_available_ip(db: AsyncIOMotorDatabase) -> str | None:
    """Return the lowest IP in the configured pool not currently in use by an active VM."""
    network = ipaddress.ip_network(settings.VM_IP_RANGE, strict=False)
    gateway = ipaddress.ip_address(settings.VM_GATEWAY)

    used_cursor = db.vms.find(
        {"status": {"$in": ["provisioning", "running"]}, "ip_address": {"$exists": True}},
        {"ip_address": 1},
    )
    used_ips: set[ipaddress.IPv4Address | ipaddress.IPv6Address] = set()
    async for doc in used_cursor:
        try:
            used_ips.add(ipaddress.ip_address(doc["ip_address"]))
        except ValueError:
            pass

    reserved = {network.network_address, network.broadcast_address, gateway}

    for host in network.hosts():
        if host in reserved:
            continue
        if host not in used_ips:
            return str(host)

    return None


# ---------------------------------------------------------------------------
# Password helpers
# ---------------------------------------------------------------------------

_ALPHANUM = string.ascii_letters + string.digits


def _generate_password(length: int = 16) -> str:
    return "".join(secrets.choice(_ALPHANUM) for _ in range(length))


def _hash_password(plaintext: str) -> str:
    return bcrypt.hashpw(plaintext.encode(), bcrypt.gensalt()).decode()


# ---------------------------------------------------------------------------
# Document helpers
# ---------------------------------------------------------------------------


def _serialize_doc(doc: dict) -> dict:
    out: dict = {}
    for k, v in doc.items():
        if isinstance(v, ObjectId):
            out[k] = str(v)
        else:
            out[k] = v
    return out


def _gpu_hostpci_config(gpu_cfg: dict) -> dict[str, str]:
    hostpci_slots = gpu_cfg.get("hostpci_slots") or [gpu_cfg["pci_id"].split(".", 1)[0]]
    hostpci_options = gpu_cfg.get("hostpci_options") or []
    config: dict[str, str] = {}

    for index, pci_slot in enumerate(hostpci_slots):
        options = hostpci_options[index] if index < len(hostpci_options) else "pcie=1"
        config[f"hostpci{index}"] = f"{pci_slot},{options}" if options else pci_slot

    return config


# ---------------------------------------------------------------------------
# Resource availability helper
# ---------------------------------------------------------------------------


async def _get_available_resources(db: AsyncIOMotorDatabase) -> dict:
    """Return currently available cluster resources (same logic as GET /resources)."""
    pipeline = [
        {"$match": {"status": {"$in": ["provisioning", "running"]}}},
        {
            "$group": {
                "_id": None,
                "used_cpu": {"$sum": "$cpu_cores"},
                "used_ram_gb": {"$sum": "$ram_gb"},
                "used_disk_gb": {"$sum": "$disk_gb"},
            }
        },
    ]
    result = await db.vms.aggregate(pipeline).to_list(length=1)
    used = result[0] if result else {"used_cpu": 0, "used_ram_gb": 0, "used_disk_gb": 0}
    return {
        "cpu": max(0, settings.RESOURCE_LIMIT_CPU - used["used_cpu"]),
        "ram_gb": max(0, settings.RESOURCE_LIMIT_RAM_GB - used["used_ram_gb"]),
        "disk_gb": max(0, settings.RESOURCE_LIMIT_DISK_GB - used["used_disk_gb"]),
    }


# ---------------------------------------------------------------------------
# Main creation flow
# ---------------------------------------------------------------------------


async def create_vm(
    request: VMCreateRequest,
    current_user: dict,
    db: AsyncIOMotorDatabase,
    progress: asyncio.Queue | None = None,
) -> VMCreateResponse:
    """Full 9-step VM creation flow. Pass an asyncio.Queue to receive SSE progress events."""

    discord_id = current_user["discord_id"]

    # ------------------------------------------------------------------
    # Pre-flight: validate OS and get template VMID
    # ------------------------------------------------------------------
    template_vmid = settings.get_template_vmid(request.os)
    if template_vmid is None or template_vmid == 0:
        raise ValueError(f"OS '{request.os}' is not supported or template not configured")

    # ------------------------------------------------------------------
    # Pre-flight: available resource checks
    # ------------------------------------------------------------------
    avail = await _get_available_resources(db)
    if request.cpu_cores > avail["cpu"]:
        raise ValueError(
            f"Not enough CPU available: need {request.cpu_cores} cores, only {avail['cpu']} free"
        )
    if request.ram_gb > avail["ram_gb"]:
        raise ValueError(
            f"Not enough RAM available: need {request.ram_gb}GB, only {avail['ram_gb']}GB free"
        )
    if request.disk_gb > avail["disk_gb"]:
        raise ValueError(
            f"Not enough disk available: need {request.disk_gb}GB, only {avail['disk_gb']}GB free"
        )

    # ------------------------------------------------------------------
    # Pre-flight: GPU validation (no side effects)
    # ------------------------------------------------------------------
    has_gpu = request.gpu_id is not None
    gpu_cfg: dict | None = None
    gpu_pci_ids: list[str] = []
    if request.gpu_id:
        gpu_cfg = next(
            (g for g in settings.RESOURCE_GPU_POOL if g["id"] == request.gpu_id), None
        )
        if gpu_cfg is None:
            raise ValueError(f"GPU '{request.gpu_id}' not in pool")
        gpu_pci_ids = list(gpu_cfg.get("pci_ids") or [gpu_cfg["pci_id"]])
        gpu_in_use = await db.vms.find_one(
            {"gpu_id": request.gpu_id, "status": {"$in": ["provisioning", "running"]}}
        )
        if gpu_in_use:
            raise ValueError(f"GPU '{request.gpu_id}' is currently in use")

    cost = calculate_cost(
        request.cpu_cores, request.ram_gb, request.disk_gb, has_gpu, request.duration_hours
    )

    # ------------------------------------------------------------------
    # Step 1: Reserve — deduct points and reserve unique resources atomically
    # ------------------------------------------------------------------
    await _emit(progress, "reserve", "loading")
    now = datetime.now(timezone.utc)
    expires_at = now + timedelta(hours=request.duration_hours)
    password = _generate_password()
    username = "root"
    prefix_len = ipaddress.ip_network(settings.VM_IP_RANGE, strict=False).prefixlen
    updated_user: dict | None = None
    insert_result = None
    vm_id: str | None = None
    vmid: int | None = None
    ip_address: str | None = None
    vm_name: str | None = None

    for _attempt in range(5):
        ip_address = await get_available_ip(db)
        if ip_address is None:
            raise ValueError("No available IP addresses in the pool")

        try:
            vmid = await pve_client.select_free_vmid()
        except PVEError as exc:
            raise ValueError(str(exc)) from exc

        vm_name = f"vm-{discord_id[:8]}-{vmid}"
        vm_doc = {
            "vmid": vmid,
            "user_id": discord_id,
            "os": request.os,
            "cpu_cores": request.cpu_cores,
            "ram_gb": request.ram_gb,
            "disk_gb": request.disk_gb,
            "gpu_id": request.gpu_id,
            "gpu_pci_id": gpu_pci_ids[0] if gpu_pci_ids else None,
            "gpu_pci_ids": gpu_pci_ids,
            "ip_address": ip_address,
            "username": username,
            "status": "provisioning",
            "created_at": now,
            "expires_at": expires_at,
            "points_charged": cost,
            "name": vm_name,
        }

        try:
            async with await db.client.start_session() as session:
                async with session.start_transaction():
                    updated_user = await db.users.find_one_and_update(
                        {"discord_id": discord_id, "points": {"$gte": cost}},
                        {"$inc": {"points": -cost}},
                        return_document=ReturnDocument.AFTER,
                        session=session,
                    )
                    if updated_user is None:
                        raise ValueError("Insufficient points to create VM")

                    insert_result = await db.vms.insert_one(vm_doc, session=session)
                    vm_id = str(insert_result.inserted_id)
            break
        except DuplicateKeyError:
            continue
    else:
        raise ValueError("Could not reserve VM resources due to concurrent allocations")

    if (
        insert_result is None
        or updated_user is None
        or vm_id is None
        or vmid is None
        or ip_address is None
        or vm_name is None
    ):
        raise ValueError("Failed to reserve VM resources")

    await _emit(progress, "reserve", "done")

    # ------------------------------------------------------------------
    # Steps 2–8: Provision VM in Proxmox (with full cleanup on failure)
    # ------------------------------------------------------------------
    pve_vm_created = False
    try:
        # Step 2: Clone template — retry if stale LVM artifacts cause "already exists" errors.
        await _emit(progress, "clone", "loading")
        _CLONE_MAX_RETRIES = 3

        async def _on_single_clone_progress(pct: float) -> None:
            if progress is not None:
                await progress.put({"type": "clone_progress", "percent": pct})

        for _clone_attempt in range(_CLONE_MAX_RETRIES):
            try:
                clone_upid = await pve_client.clone_vm(
                    template_vmid=template_vmid,
                    newid=vmid,
                    name=vm_name,
                    storage=settings.VM_STORAGE,
                    target=settings.PVE_NODE,
                )
                await pve_client.poll_task(clone_upid, timeout_seconds=120, on_progress=_on_single_clone_progress)
                pve_vm_created = True
                break
            except Exception as clone_exc:
                if _clone_attempt < _CLONE_MAX_RETRIES - 1 and "already exists" in str(clone_exc).lower():
                    logger.warning(
                        "Clone for vmid=%d failed with stale disk artifact (attempt %d/%d), "
                        "purging and retrying: %s",
                        vmid, _clone_attempt + 1, _CLONE_MAX_RETRIES, clone_exc,
                    )
                    try:
                        del_upid = await pve_client.delete_vm(vmid)
                        await pve_client.poll_task(del_upid, timeout_seconds=60)
                    except Exception:
                        pass
                    await asyncio.sleep(3)
                else:
                    raise

        await _emit(progress, "clone", "done")

        # Step 3: Move disk to target storage (skip if already there)
        await _emit(progress, "storage", "loading")
        vm_cfg = await pve_client.get_vm_config(vmid)
        sata0_val = vm_cfg.get("sata0", "")
        disk_storage = sata0_val.split(":")[0] if ":" in sata0_val else ""
        if disk_storage != settings.VM_STORAGE:
            move_upid = await pve_client.move_disk(vmid, "sata0", settings.VM_STORAGE)
            await pve_client.poll_task(move_upid, timeout_seconds=600)

        # Step 4: Set CPU, RAM, and network bridge
        await pve_client.update_vm_config(
            vmid,
            cpu="host",
            cores=request.cpu_cores,
            memory=request.ram_gb * 1024,
            net0=f"model=virtio,bridge={settings.VM_BRIDGE}",
        )

        # Step 5: Resize disk
        await pve_client.resize_disk(vmid, "sata0", f"{request.disk_gb}G")
        await _emit(progress, "storage", "done")

        # Step 6: Attach GPU if requested
        await _emit(progress, "configure", "loading")
        if gpu_cfg is not None:
            await pve_client.update_vm_config(
                vmid,
                **_gpu_hostpci_config(gpu_cfg),
            )

        # Step 7: Configure cloud-init
        cloudinit_cfg: dict = dict(
            cipassword=password,
            ipconfig0=f"ip={ip_address}/{prefix_len},gw={settings.VM_GATEWAY}",
            nameserver=settings.VM_DNS,
            ciupgrade=0,
        )
        if request.ssh_public_key:
            cloudinit_cfg["sshkeys"] = quote(request.ssh_public_key, safe="")
        await pve_client.update_vm_config(vmid, **cloudinit_cfg)
        await _emit(progress, "configure", "done")

        # Step 8: Start VM and poll until running
        await _emit(progress, "start", "loading")
        await pve_client.start_vm(vmid)
        await _poll_vm_running(vmid, timeout_seconds=180)
        await _emit(progress, "start", "done")

    except Exception as exc:
        logger.error("VM creation failed for vmid=%s: %s", vmid, exc)
        if pve_vm_created:
            try:
                await pve_client.stop_vm(vmid)
            except Exception:
                pass
            try:
                del_upid = await pve_client.delete_vm(vmid)
                await pve_client.poll_task(del_upid, timeout_seconds=120)
            except Exception:
                pass

        await db.vms.update_one(
            {"_id": insert_result.inserted_id},
            {"$set": {"status": "error", "error": str(exc)}},
        )
        await _refund_points(discord_id, cost, db)
        raise ValueError(f"VM provisioning failed: {exc}") from exc

    # ------------------------------------------------------------------
    # Step 9: Finalise
    # ------------------------------------------------------------------
    started_at = datetime.now(timezone.utc)
    password_hash = _hash_password(password)

    await db.vms.update_one(
        {"_id": insert_result.inserted_id},
        {
            "$set": {
                "status": "running",
                "started_at": started_at,
                "expires_at": expires_at,
                "password_hash": password_hash,
            }
        },
    )

    await db.transactions.insert_one(
        {
            "user_id": discord_id,
            "type": "debit",
            "amount": cost,
            "description": f"VM created: {vm_name} ({request.os}, {request.duration_hours}h)",
            "reference_id": vm_id,
            "created_at": now,
        }
    )

    return VMCreateResponse(
        vm_id=vm_id,
        vmid=vmid,
        ip_address=ip_address,
        username=username,
        password=password,
        expires_at=expires_at,
        points_charged=cost,
    )


# ---------------------------------------------------------------------------
# VM status polling helper
# ---------------------------------------------------------------------------


async def _poll_vm_running(
    vmid: int,
    timeout_seconds: int = 180,
    poll_interval: float = 5.0,
) -> None:
    """Poll GET status/current until status == 'running'. Raises PVEError on timeout."""
    elapsed = 0.0
    while elapsed < timeout_seconds:
        await asyncio.sleep(poll_interval)
        elapsed += poll_interval
        status_data = await pve_client.get_vm_status(vmid)
        if status_data and status_data.get("status") == "running":
            return
    raise PVEError(f"VM {vmid} did not reach 'running' state after {timeout_seconds}s")


# ---------------------------------------------------------------------------
# Deletion flow
# ---------------------------------------------------------------------------


_DELETE_MAX_RETRIES = 10
_DELETE_RETRY_DELAY = 30  # seconds between retries when VM is locked


async def delete_vm(vm_doc: dict, db: AsyncIOMotorDatabase) -> None:
    """Delete a VM from Proxmox and mark it expired in DB.

    Retries up to _DELETE_MAX_RETRIES times when the VM is locked in Proxmox,
    waiting _DELETE_RETRY_DELAY seconds between attempts.
    """
    vmid = vm_doc["vmid"]
    vm_object_id = (
        ObjectId(vm_doc["_id"]) if not isinstance(vm_doc["_id"], ObjectId) else vm_doc["_id"]
    )

    await db.vms.update_one(
        {"_id": vm_object_id},
        {"$set": {"status": "deleting"}},
    )

    last_exc: Exception | None = None
    for attempt in range(_DELETE_MAX_RETRIES):
        try:
            # Wait up to 60s for any active Proxmox lock to clear
            try:
                await pve_client.wait_for_vm_unlock(vmid, timeout_seconds=60)
            except Exception:
                pass  # best-effort; proceed and let delete fail if still locked

            try:
                await pve_client.stop_vm(vmid)
                await asyncio.sleep(2)
            except Exception:
                pass

            del_upid = await pve_client.delete_vm(vmid)
            await pve_client.poll_task(del_upid, timeout_seconds=180)
            last_exc = None
            break  # success
        except Exception as exc:
            last_exc = exc
            if attempt < _DELETE_MAX_RETRIES - 1 and "lock" in str(exc).lower():
                logger.warning(
                    "VM vmid=%s is locked (attempt %d/%d), retrying in %ds: %s",
                    vmid, attempt + 1, _DELETE_MAX_RETRIES, _DELETE_RETRY_DELAY, exc,
                )
                await asyncio.sleep(_DELETE_RETRY_DELAY)
            else:
                break  # non-lock error or last attempt

    if last_exc is not None:
        logger.error("Failed to delete vmid=%s from Proxmox: %s", vmid, last_exc)
        await db.vms.update_one(
            {"_id": vm_object_id},
            {"$set": {"status": "error", "error": f"Deletion failed: {last_exc}"}},
        )
        return

    await db.vms.update_one(
        {"_id": vm_object_id},
        {"$set": {"status": "expired", "deleted_at": datetime.now(timezone.utc)}},
    )


# ---------------------------------------------------------------------------
# Renewal flow
# ---------------------------------------------------------------------------


async def renew_vm(
    vm_doc: dict,
    duration_hours: int,
    db: AsyncIOMotorDatabase,
) -> dict:
    """Extend a VM's expiry by ``duration_hours``, charging for the added time.

    The new expiry is computed from the later of the current expiry or now, so
    renewing an already-expiring VM stacks the extension on top of remaining time.
    Points are deducted and the expiry extended atomically; the VM must still be in
    a renewable state ('running' or 'stopped') when the transaction commits.
    """
    discord_id = vm_doc["user_id"]
    has_gpu = vm_doc.get("gpu_id") is not None
    cost = calculate_cost(
        vm_doc["cpu_cores"], vm_doc["ram_gb"], vm_doc["disk_gb"], has_gpu, duration_hours
    )

    vm_object_id = (
        ObjectId(vm_doc["_id"]) if not isinstance(vm_doc["_id"], ObjectId) else vm_doc["_id"]
    )

    now = datetime.now(timezone.utc)
    current_expires = vm_doc.get("expires_at")
    if current_expires is not None and current_expires.tzinfo is None:
        current_expires = current_expires.replace(tzinfo=timezone.utc)
    base = current_expires if current_expires and current_expires > now else now
    new_expires_at = base + timedelta(hours=duration_hours)

    updated_user: dict | None = None
    async with await db.client.start_session() as session:
        async with session.start_transaction():
            updated_user = await db.users.find_one_and_update(
                {"discord_id": discord_id, "points": {"$gte": cost}},
                {"$inc": {"points": -cost}},
                return_document=ReturnDocument.AFTER,
                session=session,
            )
            if updated_user is None:
                raise ValueError(f"Insufficient points: need {cost}")

            update_result = await db.vms.update_one(
                {"_id": vm_object_id, "status": {"$in": ["running", "stopped"]}},
                {
                    "$set": {"expires_at": new_expires_at},
                    "$inc": {"points_charged": cost},
                },
                session=session,
            )
            if update_result.modified_count == 0:
                raise ValueError("VM cannot be renewed in its current state")

    await db.transactions.insert_one(
        {
            "user_id": discord_id,
            "type": "debit",
            "amount": cost,
            "description": f"VM renewed: {vm_doc.get('name') or vm_doc['vmid']} (+{duration_hours}h)",
            "reference_id": str(vm_object_id),
            "created_at": now,
        }
    )

    return {
        "expires_at": new_expires_at,
        "points_charged": cost,
        "points_balance": updated_user.get("points", 0),
    }


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


async def _refund_points(discord_id: str, amount: int, db: AsyncIOMotorDatabase) -> None:
    await db.users.update_one(
        {"discord_id": discord_id},
        {"$inc": {"points": amount}},
    )
    await db.transactions.insert_one(
        {
            "user_id": discord_id,
            "type": "credit",
            "amount": amount,
            "description": "VM creation refund",
            "reference_id": None,
            "created_at": datetime.now(timezone.utc),
        }
    )


# ---------------------------------------------------------------------------
# Bulk creation helpers
# ---------------------------------------------------------------------------


async def _emit_prep(queue: asyncio.Queue | None, step: str, status: str) -> None:
    if queue is not None:
        await queue.put({"type": "prep_step", "step": step, "status": status})


async def _emit_vm_step(queue: asyncio.Queue | None, vm_index: int, step: str, status: str) -> None:
    if queue is not None:
        await queue.put({"type": "vm_step", "vm_index": vm_index, "step": step, "status": status})


async def _poll_vm_stopped(
    vmid: int,
    timeout_seconds: int = 120,
    poll_interval: float = 3.0,
) -> None:
    elapsed = 0.0
    while elapsed < timeout_seconds:
        await asyncio.sleep(poll_interval)
        elapsed += poll_interval
        status_data = await pve_client.get_vm_status(vmid)
        if status_data and status_data.get("status") == "stopped":
            return
    raise PVEError(f"VM {vmid} did not stop after {timeout_seconds}s")


async def get_multiple_available_ips(count: int, db: AsyncIOMotorDatabase) -> list[str]:
    """Return `count` available IPs from the pool without overlap."""
    network = ipaddress.ip_network(settings.VM_IP_RANGE, strict=False)
    gateway = ipaddress.ip_address(settings.VM_GATEWAY)

    used_cursor = db.vms.find(
        {"status": {"$in": ["provisioning", "running"]}, "ip_address": {"$exists": True}},
        {"ip_address": 1},
    )
    used_ips: set = set()
    async for doc in used_cursor:
        try:
            used_ips.add(ipaddress.ip_address(doc["ip_address"]))
        except ValueError:
            pass

    reserved = {network.network_address, network.broadcast_address, gateway}
    available: list[str] = []
    for host in network.hosts():
        if host in reserved or host in used_ips:
            continue
        available.append(str(host))
        if len(available) == count:
            break

    if len(available) < count:
        raise ValueError(f"Not enough available IPs (need {count}, found {len(available)})")
    return available


async def _provision_vm_from_template(
    vm_index: int,
    template_vmid: int,
    password: str,
    vmid: int,
    vm_doc_id: ObjectId,
    ip_address: str,
    vm_name: str,
    expires_at: datetime,
    single_cost: int,
    request: BulkVMCreateRequest,
    db: AsyncIOMotorDatabase,
    prefix_len: int,
    progress: asyncio.Queue | None = None,
) -> VMCreateResponse:
    """Provision a single VM from a pre-determined template as part of a bulk operation."""
    pve_vm_created = False
    try:
        # Clone template — retry if stale LVM artifacts from a prior failed clone
        # cause "already exists" errors on the target VMID.
        await _emit_vm_step(progress, vm_index, "clone", "loading")
        _CLONE_MAX_RETRIES = 3

        async def _on_clone_progress(pct: float) -> None:
            if progress is not None:
                await progress.put({
                    "type": "vm_clone_progress",
                    "vm_index": vm_index,
                    "percent": pct,
                })

        for _clone_attempt in range(_CLONE_MAX_RETRIES):
            try:
                clone_upid = await pve_client.clone_vm(
                    template_vmid=template_vmid,
                    newid=vmid,
                    name=vm_name,
                    storage=settings.VM_STORAGE,
                    target=settings.PVE_NODE,
                )
                await pve_client.poll_task(clone_upid, timeout_seconds=600, on_progress=_on_clone_progress)
                pve_vm_created = True
                break
            except Exception as clone_exc:
                if _clone_attempt < _CLONE_MAX_RETRIES - 1 and "already exists" in str(clone_exc).lower():
                    logger.warning(
                        "Clone for vmid=%d failed with stale disk artifact (attempt %d/%d), "
                        "purging and retrying: %s",
                        vmid, _clone_attempt + 1, _CLONE_MAX_RETRIES, clone_exc,
                    )
                    try:
                        del_upid = await pve_client.delete_vm(vmid)
                        await pve_client.poll_task(del_upid, timeout_seconds=60)
                    except Exception:
                        pass
                    await asyncio.sleep(3)
                else:
                    raise

        await _emit_vm_step(progress, vm_index, "clone", "done")

        # Configure storage, CPU, RAM, disk, cloud-init
        await _emit_vm_step(progress, vm_index, "configure", "loading")
        vm_cfg = await pve_client.get_vm_config(vmid)
        sata0_val = vm_cfg.get("sata0", "")
        disk_storage = sata0_val.split(":")[0] if ":" in sata0_val else ""
        if disk_storage != settings.VM_STORAGE:
            move_upid = await pve_client.move_disk(vmid, "sata0", settings.VM_STORAGE)
            await pve_client.poll_task(move_upid, timeout_seconds=600)

        await pve_client.update_vm_config(
            vmid,
            cpu="host",
            cores=request.cpu_cores,
            memory=request.ram_gb * 1024,
            net0=f"model=virtio,bridge={settings.VM_BRIDGE}",
        )
        await pve_client.resize_disk(vmid, "sata0", f"{request.disk_gb}G")
        cloudinit_cfg: dict = dict(
            cipassword=password,
            ipconfig0=f"ip={ip_address}/{prefix_len},gw={settings.VM_GATEWAY}",
            nameserver=settings.VM_DNS,
            ciupgrade=0,
        )
        if request.ssh_public_key:
            cloudinit_cfg["sshkeys"] = quote(request.ssh_public_key, safe="")
        await pve_client.update_vm_config(vmid, **cloudinit_cfg)
        await _emit_vm_step(progress, vm_index, "configure", "done")

        # Start VM
        await _emit_vm_step(progress, vm_index, "start", "loading")
        await pve_client.start_vm(vmid)
        await _poll_vm_running(vmid, timeout_seconds=180)
        await _emit_vm_step(progress, vm_index, "start", "done")

    except Exception as exc:
        logger.error("Bulk VM index=%d vmid=%d failed: %s", vm_index, vmid, exc)
        if pve_vm_created:
            try:
                await pve_client.stop_vm(vmid)
            except Exception:
                pass
            try:
                del_upid = await pve_client.delete_vm(vmid)
                await pve_client.poll_task(del_upid, timeout_seconds=120)
            except Exception:
                pass
        await db.vms.update_one(
            {"_id": vm_doc_id},
            {"$set": {"status": "error", "error": str(exc)}},
        )
        if progress is not None:
            await progress.put({"type": "vm_error", "vm_index": vm_index, "message": str(exc)})
        raise ValueError(f"VM {vm_index + 1} failed: {exc}") from exc

    # Finalize DB record
    await db.vms.update_one(
        {"_id": vm_doc_id},
        {
            "$set": {
                "status": "running",
                "started_at": datetime.now(timezone.utc),
                "password_hash": _hash_password(password),
            }
        },
    )

    result = VMCreateResponse(
        vm_id=str(vm_doc_id),
        vmid=vmid,
        ip_address=ip_address,
        username="root",
        password=password,
        expires_at=expires_at,
        points_charged=single_cost,
    )

    if progress is not None:
        await progress.put({
            "type": "vm_done",
            "vm_index": vm_index,
            "credentials": {
                "vm_id": result.vm_id,
                "ip_address": result.ip_address,
                "username": result.username,
                "password": result.password,
                "expires_at": result.expires_at.isoformat(),
            },
        })

    return result


# ---------------------------------------------------------------------------
# Bulk creation main flow
# ---------------------------------------------------------------------------


async def bulk_create_vms(
    request: BulkVMCreateRequest,
    current_user: dict,
    db: AsyncIOMotorDatabase,
    progress: asyncio.Queue | None = None,
) -> list[VMCreateResponse]:
    """Bulk VM creation: optional template prep, then N concurrent provisions."""
    discord_id = current_user["discord_id"]
    temp_template_vmid: int | None = None

    # ------------------------------------------------------------------
    # Template preparation (if using user's own VM as source)
    # ------------------------------------------------------------------
    if request.source_vmid is not None:
        vm_doc = await db.vms.find_one({
            "vmid": request.source_vmid,
            "user_id": discord_id,
            "status": {"$in": ["running", "provisioning"]},
        })
        if vm_doc is None:
            raise ValueError(f"VM vmid={request.source_vmid} not found or not owned by you")

        source_vmid = request.source_vmid

        # Stop source VM
        await _emit_prep(progress, "stop_source", "loading")
        try:
            await pve_client.stop_vm(source_vmid)
            await _poll_vm_stopped(source_vmid, timeout_seconds=120)
        except Exception as exc:
            await _emit_prep(progress, "stop_source", "error")
            raise ValueError(f"Failed to stop source VM: {exc}") from exc
        await _emit_prep(progress, "stop_source", "done")

        # Clone source VM to temporary template VM
        await _emit_prep(progress, "clone_template", "loading")
        try:
            temp_vmid = await pve_client.select_free_vmid()
            temp_name = f"bulk-tpl-{discord_id[:8]}-{temp_vmid}"
            clone_upid = await pve_client.clone_vm(
                template_vmid=source_vmid,
                newid=temp_vmid,
                name=temp_name,
                storage=settings.VM_STORAGE,
                target=settings.PVE_NODE,
            )
            await pve_client.poll_task(clone_upid, timeout_seconds=300)
            temp_template_vmid = temp_vmid
        except Exception as exc:
            await _emit_prep(progress, "clone_template", "error")
            try:
                await pve_client.start_vm(source_vmid)
            except Exception:
                pass
            raise ValueError(f"Failed to clone source VM: {exc}") from exc
        await _emit_prep(progress, "clone_template", "done")

        # Convert clone to template
        await _emit_prep(progress, "convert_template", "loading")
        try:
            await pve_client.convert_to_template(temp_template_vmid)
        except Exception as exc:
            await _emit_prep(progress, "convert_template", "error")
            try:
                await pve_client.start_vm(source_vmid)
            except Exception:
                pass
            try:
                del_upid = await pve_client.delete_vm(temp_template_vmid)
                await pve_client.poll_task(del_upid, timeout_seconds=120)
            except Exception:
                pass
            raise ValueError(f"Failed to convert clone to template: {exc}") from exc
        await _emit_prep(progress, "convert_template", "done")

        # Start source VM back
        await _emit_prep(progress, "start_source", "loading")
        try:
            await pve_client.start_vm(source_vmid)
        except Exception as exc:
            logger.warning("Failed to restart source VM %s: %s", source_vmid, exc)
        await _emit_prep(progress, "start_source", "done")

        template_vmid = temp_template_vmid
    else:
        template_vmid = settings.get_template_vmid(request.os)
        if template_vmid is None or template_vmid == 0:
            raise ValueError(f"OS '{request.os}' is not supported or template not configured")

    # ------------------------------------------------------------------
    # Available resource checks (total needed for all N VMs)
    # ------------------------------------------------------------------
    avail = await _get_available_resources(db)
    needed_cpu  = request.cpu_cores * request.count
    needed_ram  = request.ram_gb    * request.count
    needed_disk = request.disk_gb   * request.count
    if needed_cpu > avail["cpu"]:
        raise ValueError(
            f"Not enough CPU: need {needed_cpu} cores ({request.count}×{request.cpu_cores}), only {avail['cpu']} free"
        )
    if needed_ram > avail["ram_gb"]:
        raise ValueError(
            f"Not enough RAM: need {needed_ram}GB ({request.count}×{request.ram_gb}GB), only {avail['ram_gb']}GB free"
        )
    if needed_disk > avail["disk_gb"]:
        raise ValueError(
            f"Not enough disk: need {needed_disk}GB ({request.count}×{request.disk_gb}GB), only {avail['disk_gb']}GB free"
        )

    # ------------------------------------------------------------------
    # Cost and point deduction
    # ------------------------------------------------------------------
    single_cost = calculate_cost(request.cpu_cores, request.ram_gb, request.disk_gb, False, request.duration_hours)
    total_cost = single_cost * request.count

    updated_user = await db.users.find_one_and_update(
        {"discord_id": discord_id, "points": {"$gte": total_cost}},
        {"$inc": {"points": -total_cost}},
        return_document=ReturnDocument.AFTER,
    )
    if updated_user is None:
        if temp_template_vmid is not None:
            try:
                del_upid = await pve_client.delete_vm(temp_template_vmid)
                await pve_client.poll_task(del_upid, timeout_seconds=120)
            except Exception:
                pass
        raise ValueError(f"Insufficient points: need {total_cost}")

    # ------------------------------------------------------------------
    # Pre-allocate IPs and VMIDs to avoid concurrent collisions
    # ------------------------------------------------------------------
    try:
        ip_addresses = await get_multiple_available_ips(request.count, db)
        existing_vms = await pve_client.list_vms()
        used_vmids = {int(vm["vmid"]) for vm in existing_vms}
        if temp_template_vmid is not None:
            used_vmids.add(temp_template_vmid)
        candidates = [v for v in range(settings.VM_VMID_MIN, settings.VM_VMID_MAX + 1) if v not in used_vmids]
        if len(candidates) < request.count:
            raise ValueError(f"Not enough free VMIDs (need {request.count})")
        random.shuffle(candidates)
        vmids = candidates[:request.count]
    except Exception as exc:
        await _refund_points(discord_id, total_cost, db)
        if temp_template_vmid is not None:
            try:
                del_upid = await pve_client.delete_vm(temp_template_vmid)
                await pve_client.poll_task(del_upid, timeout_seconds=120)
            except Exception:
                pass
        raise ValueError(str(exc)) from exc

    # ------------------------------------------------------------------
    # Prepare passwords and insert VM documents
    # ------------------------------------------------------------------
    if request.password_mode == "unified" and request.unified_password:
        passwords = [request.unified_password] * request.count
    else:
        passwords = [_generate_password() for _ in range(request.count)]

    now = datetime.now(timezone.utc)
    expires_at = now + timedelta(hours=request.duration_hours)
    prefix_len = ipaddress.ip_network(settings.VM_IP_RANGE, strict=False).prefixlen
    bulk_id = str(uuid.uuid4())
    vm_doc_ids: list[ObjectId] = []

    for i in range(request.count):
        vm_name = f"vm-{discord_id[:8]}-{vmids[i]}"
        vm_doc = {
            "vmid": vmids[i],
            "user_id": discord_id,
            "os": request.os,
            "cpu_cores": request.cpu_cores,
            "ram_gb": request.ram_gb,
            "disk_gb": request.disk_gb,
            "gpu_id": None,
            "gpu_pci_id": None,
            "ip_address": ip_addresses[i],
            "username": "root",
            "status": "provisioning",
            "created_at": now,
            "expires_at": expires_at,
            "points_charged": single_cost,
            "name": vm_name,
            "bulk_id": bulk_id,
        }
        result = await db.vms.insert_one(vm_doc)
        vm_doc_ids.append(result.inserted_id)

    await db.transactions.insert_one({
        "user_id": discord_id,
        "type": "debit",
        "amount": total_cost,
        "description": f"Bulk create: {request.count}x {request.os}, {request.duration_hours}h",
        "reference_id": None,
        "created_at": now,
    })

    # ------------------------------------------------------------------
    # Provision VMs with a concurrency limit to avoid overloading Proxmox
    # ------------------------------------------------------------------
    sem = asyncio.Semaphore(settings.BULK_CREATE_CONCURRENCY)

    async def _guarded(i: int):
        async with sem:
            return await _provision_vm_from_template(
                vm_index=i,
                template_vmid=template_vmid,
                password=passwords[i],
                vmid=vmids[i],
                vm_doc_id=vm_doc_ids[i],
                ip_address=ip_addresses[i],
                vm_name=f"vm-{discord_id[:8]}-{vmids[i]}",
                expires_at=expires_at,
                single_cost=single_cost,
                request=request,
                db=db,
                prefix_len=prefix_len,
                progress=progress,
            )

    tasks = [_guarded(i) for i in range(request.count)]
    results_raw = await asyncio.gather(*tasks, return_exceptions=True)

    # ------------------------------------------------------------------
    # Cleanup temp template
    # ------------------------------------------------------------------
    if temp_template_vmid is not None:
        try:
            del_upid = await pve_client.delete_vm(temp_template_vmid)
            await pve_client.poll_task(del_upid, timeout_seconds=120)
        except Exception as exc:
            logger.warning("Failed to cleanup temp template vmid=%s: %s", temp_template_vmid, exc)

    # ------------------------------------------------------------------
    # Refund for failed VMs
    # ------------------------------------------------------------------
    failed_count = sum(1 for r in results_raw if isinstance(r, Exception))
    if failed_count > 0:
        await _refund_points(discord_id, single_cost * failed_count, db)

    return [r for r in results_raw if isinstance(r, VMCreateResponse)]
