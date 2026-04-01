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

    # Collect IPs in use
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

    user_id = current_user["_id"] if "_id" in current_user else current_user.get("id")
    discord_id = current_user["discord_id"]

    # ------------------------------------------------------------------
    # Step 1: Validate OS and get template VMID
    # ------------------------------------------------------------------
    template_vmid = settings.get_template_vmid(request.os)
    if template_vmid is None or template_vmid == 0:
        raise ValueError(f"OS '{request.os}' is not supported or template not configured")

    # ------------------------------------------------------------------
    # Step 2: Pre-flight resource checks
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
    # Step 3: Calculate cost and deduct points atomically
    # ------------------------------------------------------------------
    has_gpu = request.gpu_id is not None
    cost = calculate_cost(
        request.cpu_cores, request.ram_gb, request.disk_gb, has_gpu, request.duration_hours
    )

    user_filter = {"discord_id": discord_id, "points": {"$gte": cost}}
    updated_user = await db.users.find_one_and_update(
        user_filter,
        {"$inc": {"points": -cost}},
        return_document=ReturnDocument.AFTER,
    )
    if updated_user is None:
        raise ValueError("Insufficient points to create VM")

    # ------------------------------------------------------------------
    # Step 4: GPU reservation (atomic)
    # ------------------------------------------------------------------
    gpu_pci_id: str | None = None
    if request.gpu_id:
        gpu_cfg = next(
            (g for g in settings.RESOURCE_GPU_POOL if g["id"] == request.gpu_id), None
        )
        if gpu_cfg is None:
            await _refund_points(discord_id, cost, db)
            raise ValueError(f"GPU '{request.gpu_id}' not in pool")

        gpu_pci_id = gpu_cfg["pci_id"]

        # Check no active VM already holds this GPU
        gpu_in_use = await db.vms.find_one(
            {
                "gpu_id": request.gpu_id,
                "status": {"$in": ["provisioning", "running"]},
            }
        )
        if gpu_in_use:
            await _refund_points(discord_id, cost, db)
            raise ValueError(f"GPU '{request.gpu_id}' is currently in use")

    # ------------------------------------------------------------------
    # Step 5: IP allocation
    # ------------------------------------------------------------------
    ip_address = await get_available_ip(db)
    if ip_address is None:
        await _refund_points(discord_id, cost, db)
        raise ValueError("No available IP addresses in the pool")

    # ------------------------------------------------------------------
    # Step 6: Select free VMID from Proxmox
    # ------------------------------------------------------------------
    try:
        vmid = await pve_client.select_free_vmid()
    except PVEError as exc:
        await _refund_points(discord_id, cost, db)
        raise ValueError(str(exc)) from exc

    # ------------------------------------------------------------------
    # Step 7: Insert VM document in DB (status=provisioning)
    # ------------------------------------------------------------------
    now = datetime.now(timezone.utc)
    expires_at = now + timedelta(hours=request.duration_hours)
    password = _generate_password()
    password_hash = _hash_password(password)
    username = settings.get_default_username(request.os)
    vm_name = f"vm-{discord_id[:8]}-{vmid}"

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
        "password_hash": password_hash,
        "status": "provisioning",
        "created_at": now,
        "expires_at": expires_at,
        "points_charged": cost,
        "name": vm_name,
    }
    insert_result = await db.vms.insert_one(vm_doc)
    vm_id = str(insert_result.inserted_id)

    # ------------------------------------------------------------------
    # Step 8: Provision VM in Proxmox
    # ------------------------------------------------------------------
    pve_vm_created = False
    try:
        # 8a. Clone template
        upid = await pve_client.clone_vm(
            template_vmid=template_vmid,
            newid=vmid,
            name=vm_name,
            storage=settings.VM_STORAGE,
            target=settings.PVE_NODE,
        )
        await pve_client.poll_task(upid, timeout_seconds=300)
        pve_vm_created = True

        # 8b. Configure CPU / RAM / network
        cidr = ipaddress.ip_network(settings.VM_IP_RANGE, strict=False).prefixlen
        config: dict = {
            "cores": request.cpu_cores,
            "memory": request.ram_gb * 1024,
            "net0": f"virtio,bridge={settings.VM_BRIDGE}",
            "ipconfig0": f"ip={ip_address}/{cidr},gw={settings.VM_GATEWAY}",
            "nameserver": settings.VM_DNS,
            "ciuser": username,
            "cipassword": password,
            "sshkeys": "",
        }
        if gpu_pci_id:
            config["hostpci0"] = f"{gpu_pci_id},pcie=1"

        await pve_client.update_vm_config(vmid, **config)

        # 8c. Resize disk
        current_cfg = await pve_client.get_vm_config(vmid)
        disk_key = "scsi0" if "scsi0" in current_cfg else "virtio0"
        resize_upid = await pve_client.resize_disk(
            vmid, disk_key, f"{request.disk_gb}G"
        )
        if resize_upid:
            await pve_client.poll_task(resize_upid, timeout_seconds=120)

        # 8d. Start VM
        start_upid = await pve_client.start_vm(vmid)
        await pve_client.poll_task(start_upid, timeout_seconds=120)

    except Exception as exc:
        logger.error("VM creation failed for vmid=%s: %s", vmid, exc)
        # Cleanup
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
    # Step 9: Mark VM as running and record transaction
    # ------------------------------------------------------------------
    await db.vms.update_one(
        {"_id": insert_result.inserted_id},
        {"$set": {"status": "running"}},
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
# Deletion flow
# ---------------------------------------------------------------------------


async def delete_vm(vm_doc: dict, db: AsyncIOMotorDatabase) -> None:
    """Delete a VM from Proxmox and mark it expired in DB."""
    vmid = vm_doc["vmid"]
    vm_object_id = ObjectId(vm_doc["_id"]) if not isinstance(vm_doc["_id"], ObjectId) else vm_doc["_id"]

    # Mark as deleting
    await db.vms.update_one(
        {"_id": vm_object_id},
        {"$set": {"status": "deleting"}},
    )

    try:
        # Stop first (ignore errors — VM might already be stopped)
        try:
            await pve_client.stop_vm(vmid)
            await asyncio.sleep(2)  # brief pause before delete
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


