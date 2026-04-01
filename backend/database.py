from __future__ import annotations

from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorDatabase

from config import settings

_client: AsyncIOMotorClient | None = None


def get_client() -> AsyncIOMotorClient:
    global _client
    if _client is None:
        _client = AsyncIOMotorClient(settings.MONGODB_URI)
    return _client


def get_db() -> AsyncIOMotorDatabase:
    return get_client().get_default_database()


async def create_indexes() -> None:
    """Create all required MongoDB indexes. Safe to call on every startup (idempotent)."""
    db = get_db()

    # users
    await db.users.create_index("discord_id", unique=True)

    # codes
    await db.codes.create_index("code", unique=True)

    # vms — partial unique index on ip_address for active VMs only
    await db.vms.create_index(
        "ip_address",
        unique=True,
        sparse=True,
        partialFilterExpression={"status": {"$in": ["provisioning", "running"]}},
        name="vms_ip_active_unique",
    )

    # transactions
    await db.transactions.create_index("user_id")


async def close_client() -> None:
    global _client
    if _client is not None:
        _client.close()
        _client = None
