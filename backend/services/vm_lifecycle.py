from __future__ import annotations

import asyncio
import ipaddress
import logging
import math
import secrets
import string
from datetime import datetime, timedelta, timezone

import bcrypt
from bson import ObjectId
from motor.motor_asyncio import AsyncIOMotorDatabase
from pymongo import ReturnDocument

from config import settings
from models.vm import VMCreateRequest, VMCreateResponse
from services.pve import PVEError, pve_client

logger = logging.getLogger(__name__)

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


# ---------------------------------------------------------------------------
# Main creation flow
# ---------------------------------------------------------------------------


async def create_vm(
    request: VMCreateRequest,
    current_user: dict,
    db: AsyncIOMotorDatabase,
) -> VMCreateResponse:
    """Full 9-step VM creation flow."""

    discord_id = current_user["discord_id"]

    # ------------------------------------------------------------------
    # Pre-flight: validate OS and get template VMID
    # ------------------------------------------------------------------
    template_vmid = settings.get_template_vmid(request.os)
    if template_vmid is None or template_vmid == 0:
        raise ValueError(f"OS '{request.os}' is not supported or template not configured")

    # ------------------------------------------------------------------
    # Pre-flight: resource limit checks
    # ------------------------------------------------------------------
    if request.cpu_cores > settings.RESOURCE_LIMIT_CPU:
        raise ValueError(
            f"CPU cores {request.cpu_cores} exceeds limit {settings.RESOURCE_LIMIT_CPU}"
        )
    if request.ram_gb > settings.RESOURCE_LIMIT_RAM_GB:
        raise ValueError(
            f"RAM {request.ram_gb}GB exceeds limit {settings.RESOURCE_LIMIT_RAM_GB}GB"
        )
    if request.disk_gb > settings.RESOURCE_LIMIT_DISK_GB:
        raise ValueError(
            f"Disk {request.disk_gb}GB exceeds limit {settings.RESOURCE_LIMIT_DISK_GB}GB"
        )

    # ------------------------------------------------------------------
    # Pre-flight: GPU validation (no side effects)
    # ------------------------------------------------------------------
    has_gpu = request.gpu_id is not None
    gpu_pci_id: str | None = None
    if request.gpu_id:
        gpu_cfg = next(
            (g for g in settings.RESOURCE_GPU_POOL if g["id"] == request.gpu_id), None
        )
        if gpu_cfg is None:
            raise ValueError(f"GPU '{request.gpu_id}' not in pool")
        gpu_pci_id = gpu_cfg["pci_id"]
        gpu_in_use = await db.vms.find_one(
            {"gpu_id": request.gpu_id, "status": {"$in": ["provisioning", "running"]}}
        )
        if gpu_in_use:
            raise ValueError(f"GPU '{request.gpu_id}' is currently in use")

    # ------------------------------------------------------------------
    # Pre-flight: IP allocation and VMID selection
    # ------------------------------------------------------------------
    ip_address = await get_available_ip(db)
    if ip_address is None:
        raise ValueError("No available IP addresses in the pool")

    cost = calculate_cost(
        request.cpu_cores, request.ram_gb, request.disk_gb, has_gpu, request.duration_hours
    )

    try:
        vmid = await pve_client.select_free_vmid()
    except PVEError as exc:
        raise ValueError(str(exc)) from exc

    # ------------------------------------------------------------------
    # Step 1: Reserve — deduct points atomically, insert VM document
    # ------------------------------------------------------------------
    updated_user = await db.users.find_one_and_update(
        {"discord_id": discord_id, "points": {"$gte": cost}},
        {"$inc": {"points": -cost}},
        return_document=ReturnDocument.AFTER,
    )
    if updated_user is None:
        raise ValueError("Insufficient points to create VM")

    now = datetime.now(timezone.utc)
    expires_at = now + timedelta(hours=request.duration_hours)
    password = _generate_password()
    username = settings.get_default_username(request.os)
    vm_name = f"vm-{discord_id[:8]}-{vmid}"
    prefix_len = ipaddress.ip_network(settings.VM_IP_RANGE, strict=False).prefixlen

    vm_doc = {
        "vmid": vmid,
        "user_id": discord_id,
        "os": request.os,
        "cpu_cores": request.cpu_cores,
        "ram_gb": request.ram_gb,
        "disk_gb": request.disk_gb,
        "gpu_id": request.gpu_id,
        "gpu_pci_id": gpu_pci_id,
        "ip_address": ip_address,
        "username": username,
        "status": "provisioning",
        "created_at": now,
        "expires_at": expires_at,
        "points_charged": cost,
        "name": vm_name,
    }
    insert_result = await db.vms.insert_one(vm_doc)
    vm_id = str(insert_result.inserted_id)

    # ------------------------------------------------------------------
    # Steps 2–8: Provision VM in Proxmox (with full cleanup on failure)
    # ------------------------------------------------------------------
    pve_vm_created = False
    try:
        # Step 2: Clone template
        clone_upid = await pve_client.clone_vm(
            template_vmid=template_vmid,
            newid=vmid,
            name=vm_name,
            storage=settings.VM_STORAGE,
            target=settings.PVE_NODE,
        )
        await pve_client.poll_task(clone_upid, timeout_seconds=300)
        pve_vm_created = True

        # Step 3: Move disk to target storage (skip if already there)
        vm_cfg = await pve_client.get_vm_config(vmid)
        sata0_val = vm_cfg.get("sata0", "")
        disk_storage = sata0_val.split(":")[0] if ":" in sata0_val else ""
        if disk_storage != settings.VM_STORAGE:
            move_upid = await pve_client.move_disk(vmid, "sata0", settings.VM_STORAGE)
            await pve_client.poll_task(move_upid, timeout_seconds=600)

        # Step 4: Set CPU and RAM
        await pve_client.update_vm_config(
            vmid,
            cpu="host",
            cores=request.cpu_cores,
            memory=request.ram_gb * 1024,
        )

        # Step 5: Resize disk
        await pve_client.resize_disk(vmid, "sata0", f"{request.disk_gb}G")

        # Step 6: Attach GPU if requested
        if gpu_pci_id:
            await pve_client.update_vm_config(
                vmid,
                hostpci0=f"{gpu_pci_id},pcie=1,x-vga=1",
            )

        # Step 7: Configure cloud-init
        await pve_client.update_vm_config(
            vmid,
            cipassword=password,
            ipconfig0=f"ip={ip_address}/{prefix_len},gw={settings.VM_GATEWAY}",
            nameserver=settings.VM_DNS,
            ciupgrade=0,
        )

        # Step 8: Start VM and poll until running
        await pve_client.start_vm(vmid)
        await _poll_vm_running(vmid, timeout_seconds=180)

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


async def delete_vm(vm_doc: dict, db: AsyncIOMotorDatabase) -> None:
    """Delete a VM from Proxmox and mark it expired in DB."""
    vmid = vm_doc["vmid"]
    vm_object_id = (
        ObjectId(vm_doc["_id"]) if not isinstance(vm_doc["_id"], ObjectId) else vm_doc["_id"]
    )

    await db.vms.update_one(
        {"_id": vm_object_id},
        {"$set": {"status": "deleting"}},
    )

    try:
        try:
            await pve_client.stop_vm(vmid)
            await asyncio.sleep(2)
        except Exception:
            pass

        del_upid = await pve_client.delete_vm(vmid)
        await pve_client.poll_task(del_upid, timeout_seconds=180)
    except Exception as exc:
        logger.error("Failed to delete vmid=%s from Proxmox: %s", vmid, exc)
        await db.vms.update_one(
            {"_id": vm_object_id},
            {"$set": {"status": "error", "error": f"Deletion failed: {exc}"}},
        )
        return

    await db.vms.update_one(
        {"_id": vm_object_id},
        {"$set": {"status": "expired", "deleted_at": datetime.now(timezone.utc)}},
    )


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
