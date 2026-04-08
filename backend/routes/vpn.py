from __future__ import annotations

from fastapi import APIRouter, Depends, Header, HTTPException
from motor.motor_asyncio import AsyncIOMotorDatabase

from auth import get_current_user
from config import settings
from database import get_db
from services.vpn import (
    build_client_config,
    get_or_create_vpn_config,
    get_server_public_key,
    set_server_public_key,
)

router = APIRouter(tags=["vpn"], prefix="/vpn")


def _vpn_enabled() -> None:
    if not settings.NEED_VPN:
        raise HTTPException(status_code=404, detail="VPN not enabled")


def _check_daemon_secret(secret: str | None) -> None:
    if not settings.VPN_DAEMON_SECRET or secret != settings.VPN_DAEMON_SECRET:
        raise HTTPException(status_code=403, detail="Invalid or missing daemon secret")


# ---------------------------------------------------------------------------
# GET /vpn/config  — retrieve the current user's WireGuard config
# ---------------------------------------------------------------------------
@router.get("/config")
async def get_vpn_config(
    current_user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    _vpn_enabled()
    doc = await db.vpn_configs.find_one({"user_id": current_user["discord_id"]})
    if doc is None:
        raise HTTPException(status_code=404, detail="No VPN config found")
    server_pubkey = await get_server_public_key(db)
    return {
        "vpn_ip": doc["vpn_ip"],
        "public_key": doc["public_key"],
        "config": build_client_config(doc["private_key"], doc["vpn_ip"], server_pubkey),
        "created_at": doc["created_at"],
    }


# ---------------------------------------------------------------------------
# POST /vpn/config  — generate config if missing, always return it
# ---------------------------------------------------------------------------
@router.post("/config")
async def create_vpn_config(
    current_user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    _vpn_enabled()
    try:
        doc, created = await get_or_create_vpn_config(current_user["discord_id"], db)
    except ValueError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    server_pubkey = await get_server_public_key(db)
    return {
        "vpn_ip": doc["vpn_ip"],
        "public_key": doc["public_key"],
        "config": build_client_config(doc["private_key"], doc["vpn_ip"], server_pubkey),
        "created_at": doc["created_at"],
        "created": created,
    }


# ---------------------------------------------------------------------------
# GET /vpn/peers  — daemon-only: list all peers for wg syncconf
# The daemon sends its own public key via X-Server-Pubkey so the panel
# always has the authoritative server key for generating client configs.
# ---------------------------------------------------------------------------
@router.get("/peers")
async def list_vpn_peers(
    x_daemon_secret: str | None = Header(default=None, alias="X-Daemon-Secret"),
    x_server_pubkey: str | None = Header(default=None, alias="X-Server-Pubkey"),
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    _vpn_enabled()
    _check_daemon_secret(x_daemon_secret)

    # Update the stored server public key whenever the daemon checks in
    if x_server_pubkey:
        await set_server_public_key(x_server_pubkey, db)

    peers: list[dict] = []
    async for doc in db.vpn_configs.find({}):
        peers.append({
            "user_id": doc["user_id"],
            "public_key": doc["public_key"],
            "vpn_ip": doc["vpn_ip"],
        })

    return {"peers": peers}
