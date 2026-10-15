"""MCP (Model Context Protocol) endpoint so AI agents can manage a user's VMs.

Served over Streamable HTTP at ``/mcp/`` and authenticated with a personal API
token (``Authorization: Bearer pvp_...``) that users create on the /mcp page.
Every tool acts as the token's owner and reuses the regular route handlers, so
ownership checks, pricing and validation are identical to the web UI.
"""

from __future__ import annotations

import asyncio
import json
from typing import Any, Literal

from fastapi import HTTPException
from fastapi.encoders import jsonable_encoder
from mcp.server.mcpserver import Context, MCPServer
from mcp.server.mcpserver.exceptions import ToolError
from mcp.server.transport_security import TransportSecuritySettings
from pydantic import ValidationError
from starlette.types import ASGIApp, Receive, Scope, Send

from auth import _serialize_doc
from config import DURATION_OPTIONS, settings
from database import get_db
from models.code import CodeRedeemRequest
from models.vm import VMCreateRequest, VMRenewRequest
from routes.api_tokens import get_user_by_api_token
from routes.codes import redeem_code as redeem_code_route
from routes.me import get_me, get_my_transactions
from routes.resources import get_pricing
from routes.resources import get_resources as get_resources_route
from routes.vms import list_my_vms, remove_vm, renew_vm_endpoint, vm_action
from services.vm_lifecycle import calculate_cost
from services.vm_lifecycle import create_vm as create_vm_service

OS_CHOICES = [
    "ubuntu-18", "ubuntu-20", "ubuntu-22", "ubuntu-24",
    "centos-7", "centos-8", "debian-11", "debian-12",
]

mcp = MCPServer(
    "pve-vm-panel",
    title="PVE VM Panel",
    instructions=(
        "Manage virtual machines on a Proxmox VE panel on behalf of the signed-in user. "
        "VMs cost points (charged up front for the chosen duration) and are deleted "
        "automatically when they expire. Call get_resources before create_vm to see "
        "available OS templates, free capacity, GPUs and pricing, and estimate_cost to "
        "check the price. create_vm returns SSH credentials exactly once; show them to "
        "the user. delete_vm is irreversible and does not refund points."
    ),
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


async def _user(ctx: Context) -> dict:
    request = ctx.request_context.request
    discord_id = request.scope.get("state", {}).get("mcp_discord_id") if request else None
    if not discord_id:
        raise ToolError("Not authenticated")
    user = await get_db().users.find_one({"discord_id": discord_id})
    if user is None:
        raise ToolError("User not found")
    return _serialize_doc(user)


async def _call(coro) -> Any:
    """Run a route handler and turn HTTP/validation errors into tool errors."""
    try:
        return jsonable_encoder(await coro)
    except HTTPException as exc:
        raise ToolError(str(exc.detail)) from exc
    except (ValueError, ValidationError) as exc:
        raise ToolError(str(exc)) from exc


# ---------------------------------------------------------------------------
# Tools
# ---------------------------------------------------------------------------


@mcp.tool()
async def get_account(ctx: Context) -> dict:
    """Get the current user's account: Discord username, point balance and active VM count."""
    user = await _user(ctx)
    return await _call(get_me(current_user=user, db=get_db()))


@mcp.tool()
async def get_resources(ctx: Context) -> dict:
    """Get everything needed to plan a VM: free cluster capacity (CPU cores, RAM GB,
    disk GB), GPU availability, available OS templates, allowed durations, and the
    per-hour point price of each resource."""
    user = await _user(ctx)
    db = get_db()
    resources = await _call(get_resources_route(_current_user=user, db=db))
    pricing = await _call(get_pricing(_current_user=user))
    return {
        **resources,
        "os_templates": [os for os in OS_CHOICES if settings.get_template_vmid(os)],
        "duration_hours_options": DURATION_OPTIONS,
        "pricing_points_per_hour": {
            "cpu_core": pricing["price_cpu"],
            "ram_gb": pricing["price_ram"],
            "disk_gb": pricing["price_disk"],
            "gpu": pricing["price_gpu"],
        },
    }


@mcp.tool()
async def estimate_cost(
    cpu_cores: int,
    ram_gb: int,
    disk_gb: int,
    duration_hours: int,
    gpu: bool = False,
) -> dict:
    """Estimate the point cost of a VM (or of renewing one) with this spec for
    duration_hours. Does not create anything."""
    if duration_hours not in DURATION_OPTIONS:
        raise ToolError(f"duration_hours must be one of {DURATION_OPTIONS}")
    return {"points": calculate_cost(cpu_cores, ram_gb, disk_gb, gpu, duration_hours)}


@mcp.tool()
async def list_vms(ctx: Context) -> list[dict]:
    """List the current user's VMs (newest first) with id, status, spec, IP,
    SSH username and expiry. Use the `id` field for other VM tools."""
    user = await _user(ctx)
    return await _call(list_my_vms(current_user=user, db=get_db()))


@mcp.tool()
async def create_vm(
    ctx: Context,
    os: str,
    cpu_cores: int,
    ram_gb: int,
    disk_gb: int,
    duration_hours: int,
    gpu_id: str | None = None,
    ssh_public_key: str | None = None,
) -> dict:
    """Create and boot a new VM, charging points up front. Takes a minute or two.

    Args:
        os: OS template slug, one of `os_templates` from get_resources (e.g. "ubuntu-24").
        cpu_cores: Number of CPU cores.
        ram_gb: RAM in GB.
        disk_gb: Disk size in GB.
        duration_hours: Lifetime before auto-deletion; one of `duration_hours_options`.
        gpu_id: Optional GPU id from get_resources (must be available).
        ssh_public_key: Optional SSH public key to install for the VM user.

    Returns the VM id, IP address, SSH username and password. The password is
    only returned here, so pass it on to the user.
    """
    user = await _user(ctx)
    try:
        body = VMCreateRequest(
            os=os,
            cpu_cores=cpu_cores,
            ram_gb=ram_gb,
            disk_gb=disk_gb,
            gpu_id=gpu_id,
            duration_hours=duration_hours,
            ssh_public_key=ssh_public_key,
        )
    except ValidationError as exc:
        raise ToolError(str(exc)) from exc

    # Relay provisioning steps as MCP progress notifications; this also keeps
    # the response stream alive through proxies while the VM is cloned/booted.
    queue: asyncio.Queue = asyncio.Queue()

    async def _relay_progress() -> None:
        done = 0
        while True:
            event = await queue.get()
            if event.get("status") == "done":
                done += 1
            await ctx.report_progress(done, message=f"{event.get('step')}: {event.get('status')}")

    relay = asyncio.create_task(_relay_progress())
    try:
        result = await _call(create_vm_service(body, user, get_db(), progress=queue))
    finally:
        relay.cancel()
    return result


@mcp.tool()
async def vm_power(
    ctx: Context,
    vm_id: str,
    action: Literal["start", "stop", "restart"],
) -> dict:
    """Start, stop (hard power-off) or restart one of the user's VMs and wait
    until it reaches the target state."""
    user = await _user(ctx)
    return await _call(vm_action(vm_id=vm_id, action=action, current_user=user, db=get_db()))


@mcp.tool()
async def renew_vm(ctx: Context, vm_id: str, duration_hours: int) -> dict:
    """Extend a VM's expiry by duration_hours (one of the allowed durations),
    charging points for the added time. Returns the new expiry and balance."""
    user = await _user(ctx)
    try:
        body = VMRenewRequest(duration_hours=duration_hours)
    except ValidationError as exc:
        raise ToolError(str(exc)) from exc
    return await _call(
        renew_vm_endpoint(vm_id=vm_id, body=body, current_user=user, db=get_db())
    )


@mcp.tool()
async def delete_vm(ctx: Context, vm_id: str) -> dict:
    """Permanently delete one of the user's VMs and all of its data. This cannot
    be undone and remaining time is not refunded. Confirm with the user first."""
    user = await _user(ctx)
    await _call(remove_vm(vm_id=vm_id, current_user=user, db=get_db()))
    return {"deleted": vm_id}


@mcp.tool()
async def list_transactions(ctx: Context, skip: int = 0, limit: int = 20) -> dict:
    """List the user's point transactions (charges, refunds, top-ups), newest first."""
    user = await _user(ctx)
    if skip < 0 or not 1 <= limit <= 100:
        raise ToolError("skip must be >= 0 and limit between 1 and 100")
    return await _call(
        get_my_transactions(skip=skip, limit=limit, current_user=user, db=get_db())
    )


@mcp.tool()
async def redeem_code(ctx: Context, code: str) -> dict:
    """Redeem a gift code to add points to the user's balance."""
    user = await _user(ctx)
    body = CodeRedeemRequest(code=code)
    return await _call(redeem_code_route(body=body, current_user=user, db=get_db()))


# ---------------------------------------------------------------------------
# ASGI app
# ---------------------------------------------------------------------------


class _ApiTokenAuth:
    """Reject requests without a valid personal API token; stash the owner's id."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        headers = dict(scope.get("headers") or [])
        auth = headers.get(b"authorization", b"").decode()
        token = auth[7:].strip() if auth[:7].lower() == "bearer " else ""
        user = await get_user_by_api_token(token, get_db()) if token else None
        if user is None:
            body = json.dumps({"detail": "Invalid or missing API token"}).encode()
            await send({
                "type": "http.response.start",
                "status": 401,
                "headers": [
                    (b"content-type", b"application/json"),
                    (b"www-authenticate", b"Bearer"),
                ],
            })
            await send({"type": "http.response.body", "body": body})
            return

        scope.setdefault("state", {})["mcp_discord_id"] = user["discord_id"]
        await self.app(scope, receive, send)


def build_mcp_app() -> ASGIApp:
    """Build the ASGI app to mount at /mcp. Run `mcp.session_manager.run()` in the
    host app's lifespan."""
    app = mcp.streamable_http_app(
        streamable_http_path="/",
        stateless_http=True,
        # Requests arrive via the Next.js proxy with arbitrary Host headers, and
        # every request carries a bearer token, so DNS-rebinding checks don't apply.
        transport_security=TransportSecuritySettings(enable_dns_rebinding_protection=False),
    )
    return _ApiTokenAuth(app)
