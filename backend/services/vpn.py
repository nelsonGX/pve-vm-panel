from __future__ import annotations

import base64
import ipaddress
from datetime import datetime, timezone

from cryptography.hazmat.primitives.asymmetric.x25519 import X25519PrivateKey
from motor.motor_asyncio import AsyncIOMotorDatabase

from config import settings


def generate_keypair() -> tuple[str, str]:
    """Return (private_key_b64, public_key_b64) suitable for WireGuard."""
    key = X25519PrivateKey.generate()
    priv = base64.b64encode(key.private_bytes_raw()).decode()
    pub = base64.b64encode(key.public_key().public_bytes_raw()).decode()
    return priv, pub


async def get_available_vpn_ip(db: AsyncIOMotorDatabase) -> str | None:
    """Return the lowest unassigned IP in the VPN subnet (skipping .1 reserved for server)."""
    network = ipaddress.ip_network(settings.VPN_SUBNET, strict=False)
    hosts = list(network.hosts())
    if not hosts:
        return None
    server_ip = hosts[0]  # .1 is the WireGuard server

    used: set[ipaddress.IPv4Address | ipaddress.IPv6Address] = set()
    async for doc in db.vpn_configs.find({}, {"vpn_ip": 1}):
        try:
            used.add(ipaddress.ip_address(doc["vpn_ip"]))
        except (ValueError, KeyError):
            pass

    for host in hosts:
        if host == server_ip or host in used:
            continue
        return str(host)
    return None


def build_client_config(private_key: str, vpn_ip: str) -> str:
    """Build a WireGuard client .conf string for the given user."""
    prefix = ipaddress.ip_network(settings.VPN_SUBNET, strict=False).prefixlen
    # Route both the VPN subnet and the VM private network through the tunnel
    allowed_ips = f"{settings.VPN_SUBNET}, {settings.VM_IP_RANGE}"
    return (
        f"[Interface]\n"
        f"PrivateKey = {private_key}\n"
        f"Address = {vpn_ip}/{prefix}\n"
        f"\n"
        f"[Peer]\n"
        f"PublicKey = {settings.VPN_SERVER_PUBLIC_KEY}\n"
        f"Endpoint = {settings.VPN_SERVER_ENDPOINT}\n"
        f"AllowedIPs = {allowed_ips}\n"
        f"PersistentKeepalive = 25\n"
    )


async def get_or_create_vpn_config(
    discord_id: str,
    db: AsyncIOMotorDatabase,
) -> tuple[dict, bool]:
    """
    Return (vpn_config_doc, created).
    created=True if a new config was just generated.
    """
    existing = await db.vpn_configs.find_one({"user_id": discord_id})
    if existing:
        return existing, False

    vpn_ip = await get_available_vpn_ip(db)
    if vpn_ip is None:
        raise ValueError("No available VPN IP addresses")

    private_key, public_key = generate_keypair()
    now = datetime.now(timezone.utc)
    doc: dict = {
        "user_id": discord_id,
        "private_key": private_key,
        "public_key": public_key,
        "vpn_ip": vpn_ip,
        "created_at": now,
    }
    result = await db.vpn_configs.insert_one(doc)
    doc["_id"] = result.inserted_id
    return doc, True
