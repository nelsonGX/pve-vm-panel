#!/usr/bin/env python3
"""
WireGuard proxy daemon for pve-vm-panel.

Periodically pulls the list of VPN peers from the panel backend and
applies them to the local WireGuard interface using `wg syncconf`, so
existing tunnels are never torn down during a refresh.

Usage:
    python daemon.py

Configuration via environment variables or .env file (see config.env.example).
"""
from __future__ import annotations

import asyncio
import logging
import os
import subprocess
import tempfile
from pathlib import Path

import httpx
from dotenv import load_dotenv

load_dotenv()

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)
logger = logging.getLogger("wg-daemon")

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
PANEL_API_URL: str = os.environ["PANEL_API_URL"].rstrip("/")
DAEMON_SECRET: str = os.environ["DAEMON_SECRET"]
WG_INTERFACE: str = os.getenv("WG_INTERFACE", "wg0")
WG_CONF_PATH: str = os.getenv("WG_CONF_PATH", f"/etc/wireguard/{WG_INTERFACE}.conf")
WG_SERVER_PRIVATE_KEY: str = os.environ["WG_SERVER_PRIVATE_KEY"]
# Address of the server's wg interface, e.g. "10.103.0.1/24"
WG_ADDRESS: str = os.environ["WG_ADDRESS"]
WG_LISTEN_PORT: int = int(os.getenv("WG_LISTEN_PORT", "51820"))
SYNC_INTERVAL: int = int(os.getenv("SYNC_INTERVAL", "30"))

# Optional: post-up / post-down rules to include in the [Interface] section.
# These are written to wg0.conf once on startup and preserved on sync.
POSTUP: str = os.getenv("WG_POSTUP", "")
POSTDOWN: str = os.getenv("WG_POSTDOWN", "")


# ---------------------------------------------------------------------------
# WireGuard helpers
# ---------------------------------------------------------------------------

def _run(cmd: list[str]) -> str:
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(f"Command {cmd!r} failed: {result.stderr.strip()}")
    return result.stdout.strip()


def _peers_conf(peers: list[dict]) -> str:
    """Build a peers-only WireGuard config string (no [Interface] section)."""
    lines: list[str] = []
    for peer in peers:
        lines.append("[Peer]")
        lines.append(f"PublicKey = {peer['public_key']}")
        lines.append(f"AllowedIPs = {peer['vpn_ip']}/32")
        lines.append("")
    return "\n".join(lines)


def _full_conf(peers: list[dict]) -> str:
    """Build a full wg0.conf including [Interface] section."""
    lines = [
        "[Interface]",
        f"PrivateKey = {WG_SERVER_PRIVATE_KEY}",
        f"Address = {WG_ADDRESS}",
        f"ListenPort = {WG_LISTEN_PORT}",
    ]
    if POSTUP:
        lines.append(f"PostUp = {POSTUP}")
    if POSTDOWN:
        lines.append(f"PostDown = {POSTDOWN}")
    lines.append("")
    lines.append(_peers_conf(peers))
    return "\n".join(lines)


def _apply_peers(peers: list[dict]) -> None:
    """Write peers-only conf to a temp file and apply with wg syncconf."""
    conf_text = _peers_conf(peers)
    with tempfile.NamedTemporaryFile(mode="w", suffix=".conf", delete=False) as f:
        f.write(conf_text)
        tmp_path = f.name
    try:
        _run(["wg", "syncconf", WG_INTERFACE, tmp_path])
        logger.info("syncconf applied %d peer(s) to %s", len(peers), WG_INTERFACE)
    finally:
        os.unlink(tmp_path)


def _write_full_conf(peers: list[dict]) -> None:
    """Persist full wg0.conf so it survives reboots."""
    conf_text = _full_conf(peers)
    path = Path(WG_CONF_PATH)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(conf_text)
    path.chmod(0o600)
    logger.debug("Wrote full config to %s", WG_CONF_PATH)


def _ensure_interface_up() -> None:
    """Bring up the WireGuard interface if it is not already running."""
    try:
        _run(["wg", "show", WG_INTERFACE])
        logger.debug("Interface %s is already up", WG_INTERFACE)
    except RuntimeError:
        logger.info("Bringing up interface %s", WG_INTERFACE)
        _write_full_conf([])
        _run(["wg-quick", "up", WG_INTERFACE])


# ---------------------------------------------------------------------------
# Derive server public key from private key
# ---------------------------------------------------------------------------

def _derive_public_key(private_key_b64: str) -> str:
    """Compute the WireGuard public key from a base64-encoded private key."""
    result = subprocess.run(
        ["wg", "pubkey"],
        input=private_key_b64,
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        raise RuntimeError(f"wg pubkey failed: {result.stderr.strip()}")
    return result.stdout.strip()


# Derived once at startup — this is the authoritative public key for this server.
SERVER_PUBLIC_KEY: str = _derive_public_key(WG_SERVER_PRIVATE_KEY)


# ---------------------------------------------------------------------------
# Panel API client
# ---------------------------------------------------------------------------

async def fetch_peers(client: httpx.AsyncClient) -> list[dict]:
    """Pull the current peer list from the panel backend, registering our public key."""
    resp = await client.get(
        f"{PANEL_API_URL}/vpn/peers",
        headers={
            "X-Daemon-Secret": DAEMON_SECRET,
            "X-Server-Pubkey": SERVER_PUBLIC_KEY,
        },
    )
    resp.raise_for_status()
    data = resp.json()
    return data.get("peers", [])


# ---------------------------------------------------------------------------
# Sync loop
# ---------------------------------------------------------------------------

async def sync_loop() -> None:
    _ensure_interface_up()
    logger.info(
        "Daemon started — interface=%s, panel=%s, interval=%ds",
        WG_INTERFACE, PANEL_API_URL, SYNC_INTERVAL,
    )
    logger.info("Server public key: %s", SERVER_PUBLIC_KEY)

    last_peer_keys: set[str] = set()

    async with httpx.AsyncClient(timeout=15) as client:
        while True:
            try:
                peers = await fetch_peers(client)
                current_keys = {p["public_key"] for p in peers}

                if current_keys != last_peer_keys:
                    logger.info(
                        "Peer list changed: %d → %d peer(s), applying...",
                        len(last_peer_keys), len(peers),
                    )
                    _apply_peers(peers)
                    _write_full_conf(peers)
                    last_peer_keys = current_keys
                else:
                    logger.debug("No peer changes (%d peer(s))", len(peers))

            except httpx.HTTPStatusError as exc:
                logger.error("Panel API error %s: %s", exc.response.status_code, exc.response.text)
            except Exception as exc:
                logger.error("Sync error: %s", exc)

            await asyncio.sleep(SYNC_INTERVAL)


if __name__ == "__main__":
    asyncio.run(sync_loop())
