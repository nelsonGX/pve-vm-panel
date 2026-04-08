#!/usr/bin/env python3
"""
WireGuard proxy daemon for pve-vm-panel.

Periodically pulls the list of VPN peers from the panel backend and
applies them to the local WireGuard interface using `wg set` (per-peer
add/remove), so the interface config (ListenPort, Address, etc.) is
never touched during a sync.

Interface lifecycle is managed via systemctl (wg-quick@<iface>).

Usage:
    python daemon.py

Configuration via environment variables or .env file (see config.env.example).
"""
from __future__ import annotations

import asyncio
import logging
import os
import subprocess
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
WG_ADDRESS: str = os.environ["WG_ADDRESS"]
WG_LISTEN_PORT: int = int(os.getenv("WG_LISTEN_PORT", "51820"))
SYNC_INTERVAL: int = int(os.getenv("SYNC_INTERVAL", "30"))

POSTUP: str = os.getenv("WG_POSTUP", "")
POSTDOWN: str = os.getenv("WG_POSTDOWN", "")


# ---------------------------------------------------------------------------
# Derive server public key from private key once at startup
# ---------------------------------------------------------------------------

def _derive_public_key(private_key_b64: str) -> str:
    result = subprocess.run(
        ["wg", "pubkey"],
        input=private_key_b64,
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        raise RuntimeError(f"wg pubkey failed: {result.stderr.strip()}")
    return result.stdout.strip()


SERVER_PUBLIC_KEY: str = _derive_public_key(WG_SERVER_PRIVATE_KEY)


# ---------------------------------------------------------------------------
# Shell helpers
# ---------------------------------------------------------------------------

def _run(cmd: list[str], input: str | None = None) -> str:
    result = subprocess.run(cmd, input=input, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(f"Command {' '.join(cmd)!r} failed: {result.stderr.strip()}")
    return result.stdout.strip()


# ---------------------------------------------------------------------------
# Interface lifecycle (systemctl)
# ---------------------------------------------------------------------------

def _interface_active() -> bool:
    result = subprocess.run(
        ["systemctl", "is-active", f"wg-quick@{WG_INTERFACE}"],
        capture_output=True,
        text=True,
    )
    return result.stdout.strip() == "active"


def _write_full_conf(peers: list[dict]) -> None:
    """Persist wg0.conf so the interface survives reboots."""
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
    for peer in peers:
        lines += [
            "[Peer]",
            f"PublicKey = {peer['public_key']}",
            f"AllowedIPs = {peer['vpn_ip']}/32",
            "",
        ]
    conf = "\n".join(lines)
    path = Path(WG_CONF_PATH)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(conf)
    path.chmod(0o600)
    logger.debug("Wrote config to %s", WG_CONF_PATH)


def _ensure_interface_up(peers: list[dict]) -> None:
    """Write config and start the interface via systemctl if not already active."""
    _write_full_conf(peers)
    if _interface_active():
        logger.debug("Interface %s is already active", WG_INTERFACE)
        return
    logger.info("Starting wg-quick@%s via systemctl...", WG_INTERFACE)
    _run(["systemctl", "start", f"wg-quick@{WG_INTERFACE}"])
    logger.info("Interface %s started", WG_INTERFACE)


# ---------------------------------------------------------------------------
# Live peer management — wg set (never touches ListenPort / Address)
# ---------------------------------------------------------------------------

def _current_peers() -> set[str]:
    """Return the set of public keys currently registered on the interface."""
    try:
        output = _run(["wg", "show", WG_INTERFACE, "peers"])
        return {line.strip() for line in output.splitlines() if line.strip()}
    except RuntimeError:
        return set()


def _apply_peer_diff(desired: list[dict]) -> None:
    """Add new peers and remove stale ones using `wg set`, leaving interface config alone."""
    desired_map = {p["public_key"]: p for p in desired}
    current = _current_peers()

    added = 0
    for pubkey, peer in desired_map.items():
        if pubkey not in current:
            _run(["wg", "set", WG_INTERFACE, "peer", pubkey,
                  "allowed-ips", f"{peer['vpn_ip']}/32"])
            logger.info("Added peer %s (%s)", pubkey[:12] + "...", peer["vpn_ip"])
            added += 1

    removed = 0
    for pubkey in current:
        if pubkey not in desired_map:
            _run(["wg", "set", WG_INTERFACE, "peer", pubkey, "remove"])
            logger.info("Removed stale peer %s", pubkey[:12] + "...")
            removed += 1

    if added or removed:
        logger.info("Peers updated: +%d / -%d (total %d)", added, removed, len(desired_map))


# ---------------------------------------------------------------------------
# Panel API client
# ---------------------------------------------------------------------------

async def fetch_peers(client: httpx.AsyncClient) -> list[dict]:
    """Pull the current peer list from the panel, registering our public key."""
    resp = await client.get(
        f"{PANEL_API_URL}/vpn/peers",
        headers={
            "X-Daemon-Secret": DAEMON_SECRET,
            "X-Server-Pubkey": SERVER_PUBLIC_KEY,
        },
    )
    resp.raise_for_status()
    return resp.json().get("peers", [])


# ---------------------------------------------------------------------------
# Sync loop
# ---------------------------------------------------------------------------

async def sync_loop() -> None:
    logger.info(
        "Daemon starting — interface=%s, panel=%s, interval=%ds",
        WG_INTERFACE, PANEL_API_URL, SYNC_INTERVAL,
    )
    logger.info("Server public key: %s", SERVER_PUBLIC_KEY)

    # Initial startup: write config and start interface
    _ensure_interface_up([])

    last_peer_keys: set[str] = set()

    async with httpx.AsyncClient(timeout=15) as client:
        while True:
            try:
                peers = await fetch_peers(client)
                current_keys = {p["public_key"] for p in peers}

                if current_keys != last_peer_keys:
                    logger.info(
                        "Peer list changed (%d → %d), applying...",
                        len(last_peer_keys), len(peers),
                    )
                    _apply_peer_diff(peers)
                    _write_full_conf(peers)   # persist for reboots
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
