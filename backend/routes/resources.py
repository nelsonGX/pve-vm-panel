from __future__ import annotations

from fastapi import APIRouter, Depends
from motor.motor_asyncio import AsyncIOMotorDatabase

from config import settings
from database import get_db

router = APIRouter(tags=["resources"])


@router.get("/pricing")
async def get_pricing():
    """Return pricing constants for client-side cost calculation."""
    return {
        "price_cpu": settings.PRICE_CPU_CORE_HOUR,
        "price_ram": settings.PRICE_RAM_GB_HOUR,
        "price_disk": settings.PRICE_DISK_GB_HOUR,
        "price_gpu": settings.PRICE_GPU_HOUR,
    }


@router.get("/resources")
async def get_resources(db: AsyncIOMotorDatabase = Depends(get_db)):
    """Return available vs total cluster resources."""

    # Aggregate used resources from active VMs
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

    # GPU availability
    gpu_statuses = []
    for gpu_cfg in settings.RESOURCE_GPU_POOL:
        in_use = await db.vms.find_one(
            {
                "gpu_id": gpu_cfg["id"],
                "status": {"$in": ["provisioning", "running"]},
            }
        )
        gpu_statuses.append({"id": gpu_cfg["id"], "available": in_use is None})

    return {
        "cpu": {
            "available": max(0, settings.RESOURCE_LIMIT_CPU - used["used_cpu"]),
            "total": settings.RESOURCE_LIMIT_CPU,
        },
        "ram_gb": {
            "available": max(0, settings.RESOURCE_LIMIT_RAM_GB - used["used_ram_gb"]),
            "total": settings.RESOURCE_LIMIT_RAM_GB,
        },
        "disk_gb": {
            "available": max(0, settings.RESOURCE_LIMIT_DISK_GB - used["used_disk_gb"]),
            "total": settings.RESOURCE_LIMIT_DISK_GB,
        },
        "gpus": gpu_statuses,
    }
