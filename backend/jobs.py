from __future__ import annotations

import logging
from datetime import datetime, timezone

from apscheduler.schedulers.asyncio import AsyncIOScheduler

from database import get_db
from services.vm_lifecycle import delete_vm

logger = logging.getLogger(__name__)

_scheduler: AsyncIOScheduler | None = None


async def check_expired_vms() -> None:
    """Find running VMs whose expiry time has passed and delete them."""
    db = get_db()
    now = datetime.now(timezone.utc)
    cursor = db.vms.find(
        {
            "status": {"$in": ["running"]},
            "expires_at": {"$lte": now},
        }
    )
    docs = await cursor.to_list(length=100)
    for vm_doc in docs:
        logger.info("Expiring VM vmid=%s id=%s", vm_doc["vmid"], vm_doc["_id"])
        try:
            await delete_vm(vm_doc, db)
        except Exception as exc:
            logger.error("Failed to expire vmid=%s: %s", vm_doc["vmid"], exc)


async def check_stuck_provisioning() -> None:
    """Find VMs stuck in 'provisioning' for more than 15 minutes and clean them up."""
    from datetime import timedelta

    db = get_db()
    cutoff = datetime.now(timezone.utc) - timedelta(minutes=15)

    cursor = db.vms.find(
        {
            "status": "provisioning",
            "created_at": {"$lte": cutoff},
        }
    )
    docs = await cursor.to_list(length=100)
    for vm_doc in docs:
        logger.warning(
            "Stuck provisioning VM vmid=%s id=%s — cleaning up", vm_doc["vmid"], vm_doc["_id"]
        )
        from bson import ObjectId
        from services.pve import pve_client

        vmid = vm_doc["vmid"]
        # Try to delete from PVE (best-effort)
        try:
            await pve_client.stop_vm(vmid)
        except Exception:
            pass
        try:
            del_upid = await pve_client.delete_vm(vmid)
            await pve_client.poll_task(del_upid, timeout_seconds=60)
        except Exception as exc:
            logger.error("PVE cleanup failed for vmid=%s: %s", vmid, exc)

        # Refund points
        discord_id = vm_doc.get("user_id")
        cost = vm_doc.get("points_charged", 0)
        if discord_id and cost > 0:
            await db.users.update_one(
                {"discord_id": discord_id},
                {"$inc": {"points": cost}},
            )
            await db.transactions.insert_one(
                {
                    "user_id": discord_id,
                    "type": "credit",
                    "amount": cost,
                    "description": f"Refund: stuck provisioning VM vmid={vmid}",
                    "reference_id": str(vm_doc["_id"]),
                    "created_at": datetime.now(timezone.utc),
                }
            )

        await db.vms.update_one(
            {"_id": vm_doc["_id"]},
            {
                "$set": {
                    "status": "error",
                    "error": "Stuck in provisioning — auto-cleaned",
                }
            },
        )


def setup_scheduler(app) -> None:  # noqa: ANN001
    """Configure and store the APScheduler on the FastAPI app state."""
    global _scheduler
    _scheduler = AsyncIOScheduler(timezone="UTC")
    _scheduler.add_job(check_expired_vms, "interval", seconds=60, id="check_expired_vms")
    _scheduler.add_job(
        check_stuck_provisioning, "interval", minutes=5, id="check_stuck_provisioning"
    )
    app.state.scheduler = _scheduler


def start_scheduler() -> None:
    if _scheduler is not None:
        _scheduler.start()
        logger.info("APScheduler started")


def stop_scheduler() -> None:
    if _scheduler is not None and _scheduler.running:
        _scheduler.shutdown(wait=False)
        logger.info("APScheduler stopped")
