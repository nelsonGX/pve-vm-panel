from __future__ import annotations

import asyncio
import re
import random
from collections.abc import Callable, Coroutine
from typing import Any

import httpx

from config import settings


class PVEError(Exception):
    """Raised when a Proxmox API call returns a task failure or HTTP error."""


class PVEClient:
    """Async Proxmox VE API wrapper using httpx."""

    def __init__(self) -> None:
        self._base = f"{settings.PVE_HOST.rstrip('/')}/api2/json"
        self._headers = {
            "Authorization": f"PVEAPIToken={settings.PVE_TOKEN_ID}={settings.PVE_TOKEN_SECRET}",
        }
        self._verify = settings.PVE_VERIFY_SSL
        self._node = settings.PVE_NODE

    def _client(self) -> httpx.AsyncClient:
        return httpx.AsyncClient(
            headers=self._headers,
            verify=self._verify,
            timeout=30.0,
        )

    # ------------------------------------------------------------------ #
    # Low-level helpers
    # ------------------------------------------------------------------ #

    async def _get(self, path: str, **params: Any) -> Any:
        async with self._client() as c:
            r = await c.get(f"{self._base}{path}", params=params or None)
            r.raise_for_status()
            return r.json().get("data")

    async def _post(self, path: str, **body: Any) -> Any:
        async with self._client() as c:
            r = await c.post(f"{self._base}{path}", json=body or None)
            r.raise_for_status()
            return r.json().get("data")

    async def _put(self, path: str, **body: Any) -> Any:
        async with self._client() as c:
            r = await c.put(f"{self._base}{path}", json=body or None)
            r.raise_for_status()
            return r.json().get("data")

    async def _delete(self, path: str, **params: Any) -> Any:
        async with self._client() as c:
            r = await c.delete(f"{self._base}{path}", params=params or None)
            r.raise_for_status()
            return r.json().get("data")

    # ------------------------------------------------------------------ #
    # Node
    # ------------------------------------------------------------------ #

    async def get_node_status(self) -> dict:
        return await self._get(f"/nodes/{self._node}/status")

    async def list_vms(self) -> list[dict]:
        data = await self._get(f"/nodes/{self._node}/qemu")
        return data or []

    # ------------------------------------------------------------------ #
    # VM config / status
    # ------------------------------------------------------------------ #

    async def get_vm_config(self, vmid: int) -> dict:
        return await self._get(f"/nodes/{self._node}/qemu/{vmid}/config")

    async def get_vm_status(self, vmid: int) -> dict:
        return await self._get(f"/nodes/{self._node}/qemu/{vmid}/status/current")

    # ------------------------------------------------------------------ #
    # Lifecycle
    # ------------------------------------------------------------------ #

    async def clone_vm(
        self,
        template_vmid: int,
        newid: int,
        name: str,
        storage: str,
        target: str,
    ) -> str:
        """Clone a template. Returns the UPID task string."""
        data = await self._post(
            f"/nodes/{self._node}/qemu/{template_vmid}/clone",
            newid=newid,
            name=name,
            storage=storage,
            target=target,
            full=1,
        )
        return str(data)

    async def update_vm_config(self, vmid: int, **config: Any) -> None:
        await self._put(f"/nodes/{self._node}/qemu/{vmid}/config", **config)

    async def resize_disk(self, vmid: int, disk: str, size: str) -> str | None:
        """Resize a disk. `size` should be like '+20G' or '50G'. Returns UPID or None."""
        data = await self._put(
            f"/nodes/{self._node}/qemu/{vmid}/resize",
            disk=disk,
            size=size,
        )
        return str(data) if data else None

    async def move_disk(self, vmid: int, disk: str, storage: str) -> str:
        """Move disk to a different storage pool. Returns UPID."""
        data = await self._post(
            f"/nodes/{self._node}/qemu/{vmid}/move_disk",
            disk=disk,
            storage=storage,
            delete=1,
        )
        return str(data)

    async def start_vm(self, vmid: int) -> str:
        """Start a VM. Returns UPID."""
        data = await self._post(f"/nodes/{self._node}/qemu/{vmid}/status/start")
        return str(data)

    async def stop_vm(self, vmid: int) -> None:
        await self._post(f"/nodes/{self._node}/qemu/{vmid}/status/stop")

    async def restart_vm(self, vmid: int) -> str:
        """Restart a VM. Returns UPID when Proxmox provides one."""
        data = await self._post(f"/nodes/{self._node}/qemu/{vmid}/status/reboot")
        return str(data) if data is not None else ""

    async def delete_vm(self, vmid: int) -> str:
        """Delete a VM (with purge). Returns UPID."""
        data = await self._delete(
            f"/nodes/{self._node}/qemu/{vmid}",
            purge=1,
            **{"destroy-unreferenced-disks": 1},
        )
        return str(data)

    async def convert_to_template(self, vmid: int) -> None:
        """Convert a VM into a Proxmox template (in-place, non-reversible)."""
        await self._post(f"/nodes/{self._node}/qemu/{vmid}/template")

    async def is_vm_locked(self, vmid: int) -> bool:
        """Return True if the VM currently has a lock set in its config."""
        try:
            config = await self.get_vm_config(vmid)
            return bool(config.get("lock"))
        except Exception:
            return False

    async def wait_for_vm_unlock(
        self,
        vmid: int,
        timeout_seconds: int = 300,
        poll_interval: float = 5.0,
    ) -> None:
        """Block until the VM is no longer locked. Raises PVEError on timeout."""
        elapsed = 0.0
        while elapsed < timeout_seconds:
            if not await self.is_vm_locked(vmid):
                return
            await asyncio.sleep(poll_interval)
            elapsed += poll_interval
        raise PVEError(f"VM {vmid} still locked after {timeout_seconds}s")

    # ------------------------------------------------------------------ #
    # Task polling
    # ------------------------------------------------------------------ #

    _TRANSFER_RE = re.compile(r'\((\d+(?:\.\d+)?)%\)')

    async def poll_task(
        self,
        upid: str,
        timeout_seconds: int = 300,
        poll_interval: float = 2.0,
        on_progress: Callable[[float], Coroutine[Any, Any, None]] | None = None,
    ) -> str:
        """Poll a Proxmox task until it completes. Returns `exitstatus` string.

        Raises `PVEError` on task failure or timeout.

        When `on_progress` is provided:
        - The task log is polled each iteration for "transferred … (X%)" lines.
        - `on_progress` is called with the latest percentage (0–100).
        - `timeout_seconds` acts as an *idle* timeout: it resets whenever new
          log lines appear, so an actively-cloning task will never be cut off.

        Without `on_progress`, `timeout_seconds` is a hard total-elapsed cap.
        """
        node = self._node
        log_start = 0
        loop = asyncio.get_event_loop()

        if on_progress:
            # Idle-timeout mode: track when we last saw new log activity.
            last_activity = loop.time()
            while True:
                await asyncio.sleep(poll_interval)
                now = loop.time()

                try:
                    data = await self._get(f"/nodes/{node}/tasks/{upid}/status")
                except httpx.HTTPStatusError as exc:
                    raise PVEError(f"Failed to poll task {upid}: {exc}") from exc

                try:
                    log_data = await self._get(
                        f"/nodes/{node}/tasks/{upid}/log",
                        start=log_start,
                        limit=200,
                    )
                    entries = log_data if isinstance(log_data, list) else (log_data or {}).get("data") or []
                    latest_pct: float | None = None
                    for entry in entries:
                        line = entry.get("t", "")
                        m = self._TRANSFER_RE.search(line)
                        if m:
                            latest_pct = float(m.group(1))
                        entry_n = entry.get("n", 0)
                        if entry_n > log_start:
                            log_start = entry_n
                            last_activity = now  # new log line → reset idle timer
                    if latest_pct is not None:
                        await on_progress(latest_pct)
                except Exception:
                    pass  # log polling is best-effort

                status = data.get("status") if data else None
                if status == "stopped":
                    exitstatus = data.get("exitstatus", "")
                    if exitstatus != "OK":
                        raise PVEError(f"Task {upid} failed with exitstatus: {exitstatus!r}")
                    return exitstatus

                if now - last_activity > timeout_seconds:
                    raise PVEError(f"Task {upid} timed out after {timeout_seconds}s of inactivity")
        else:
            # Hard-elapsed-timeout mode (original behaviour).
            elapsed = 0.0
            while elapsed < timeout_seconds:
                await asyncio.sleep(poll_interval)
                elapsed += poll_interval

                try:
                    data = await self._get(f"/nodes/{node}/tasks/{upid}/status")
                except httpx.HTTPStatusError as exc:
                    raise PVEError(f"Failed to poll task {upid}: {exc}") from exc

                status = data.get("status") if data else None
                if status == "stopped":
                    exitstatus = data.get("exitstatus", "")
                    if exitstatus != "OK":
                        raise PVEError(f"Task {upid} failed with exitstatus: {exitstatus!r}")
                    return exitstatus

            raise PVEError(f"Task {upid} timed out after {timeout_seconds}s")

    # ------------------------------------------------------------------ #
    # VMID selection
    # ------------------------------------------------------------------ #

    async def select_free_vmid(self) -> int:
        """Return a random free VMID in the configured range. Retries up to 10 times."""
        existing_vms = await self.list_vms()
        used_vmids = {int(vm["vmid"]) for vm in existing_vms}

        low = settings.VM_VMID_MIN
        high = settings.VM_VMID_MAX
        candidates = list(range(low, high + 1))
        random.shuffle(candidates)

        for candidate in candidates[:10]:
            if candidate not in used_vmids:
                return candidate

        raise PVEError(
            f"No free VMID available in range [{low}, {high}] after 10 attempts"
        )


# Module-level singleton
pve_client = PVEClient()
