from __future__ import annotations

from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorDatabase
from pymongo.errors import OperationFailure

from config import settings

ACTIVE_VM_STATUSES = ["provisioning", "running", "deleting"]

_client: AsyncIOMotorClient | None = None


def get_client() -> AsyncIOMotorClient:
    global _client
    if _client is None:
        _client = AsyncIOMotorClient(settings.MONGODB_URI)
    return _client


def get_db() -> AsyncIOMotorDatabase:
    return get_client().get_default_database()


async def _ensure_named_index(
    collection,
    keys,
    name: str,
    **options,
) -> None:
    """Create or replace a named index when its definition changes."""
    try:
        await collection.create_index(keys, name=name, **options)
    except OperationFailure as exc:
        if exc.code not in (85, 86):
            raise

        requested_key = list(keys) if isinstance(keys, list) else [(keys, 1)]
        index_info = await collection.index_information()
        conflicting_names = [
            index_name
            for index_name, info in index_info.items()
            if info.get("key") == requested_key and index_name != name
        ]

        for index_name in conflicting_names:
            await collection.drop_index(index_name)

        if name in index_info:
            await collection.drop_index(name)

        await collection.create_index(keys, name=name, **options)


async def create_indexes() -> None:
    """Create all required MongoDB indexes. Safe to call on every startup (idempotent)."""
    db = get_db()

    # users
    await _ensure_named_index(db.users, "discord_id", "users_discord_id_unique", unique=True)

    # codes
    await _ensure_named_index(db.codes, "code", "codes_code_unique", unique=True)

    # vms — partial unique index on ip_address for active VMs only
    await _ensure_named_index(
        db.vms,
        "ip_address",
        "vms_ip_active_unique",
        unique=True,
        partialFilterExpression={"status": {"$in": ACTIVE_VM_STATUSES}},
    )
    await _ensure_named_index(
        db.vms,
        "gpu_id",
        "vms_gpu_active_unique",
        unique=True,
        partialFilterExpression={
            "status": {"$in": ACTIVE_VM_STATUSES},
            "gpu_id": {"$type": "string"},
        },
    )
    await _ensure_named_index(
        db.vms,
        "vmid",
        "vms_vmid_active_unique",
        unique=True,
        partialFilterExpression={"status": {"$in": ACTIVE_VM_STATUSES}},
    )

    # transactions
    await _ensure_named_index(db.transactions, "user_id", "transactions_user_id")
    await _ensure_named_index(
        db.redemptions,
        [("code_id", 1), ("discord_id", 1)],
        "redemptions_code_user_unique",
        unique=True,
    )


async def close_client() -> None:
    global _client
    if _client is not None:
        _client.close()
        _client = None
