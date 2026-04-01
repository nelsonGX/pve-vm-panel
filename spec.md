# PVE Spot VM Panel — Project Specification

> A friend-facing web panel for sharing Proxmox VE server resources via a point-based economy. Users spend points to spin up short-lived VMs (spot-style), and the system automatically reclaims them when the time expires.

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Tech Stack](#2-tech-stack)
3. [Environment Configuration](#3-environment-configuration)
4. [Data Models](#4-data-models)
5. [Authentication](#5-authentication)
6. [Point Economy](#6-point-economy)
7. [Resource Limit System](#7-resource-limit-system)
8. [VM Lifecycle](#8-vm-lifecycle)
9. [PVE API Reference](#9-pve-api-reference)
10. [Frontend Pages & UI](#10-frontend-pages--ui)
11. [Backend API Routes](#11-backend-api-routes)
12. [Background Jobs](#12-background-jobs)
13. [Error Handling & Edge Cases](#13-error-handling--edge-cases)

---

## 1. Project Overview

The panel lets the server owner share Proxmox VE node resources with a whitelisted group of friends. Resources are not free — they cost **points**, which the owner distributes via redemption codes. VMs are ephemeral: they are automatically destroyed when their reserved time window expires.

Key design constraints:
- **No overselling.** The system tracks allocated resources in real time and blocks creation when headroom is exhausted.
- **No GPU overselling.** GPUs are mapped 1-to-1 to PCI IDs; each GPU can only be assigned to one active VM at a time.
- **Simple UX.** The interface is responsive and minimal — not a full cloud dashboard. Friends should be able to spin up a VM in under a minute.

---

## 2. Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 14 (App Router) |
| Auth | Auth.js (Discord OAuth provider) |
| Backend | FastAPI (Python) |
| Database | MongoDB (via Motor async driver) |
| PVE Integration | Proxmox VE REST API (`proxmoxer` library recommended) |
| Routing | Next.js rewrites: `/api/v1/*` → FastAPI |
| Scheduling | APScheduler (in-process FastAPI) or separate `celery` worker |
| Styling | Tailwind CSS — simple, responsive, no unnecessary libraries |

The Next.js app acts as a reverse proxy: all requests to `/api/v1/` are forwarded to the FastAPI server running internally. Auth session state lives in Next.js; the FastAPI backend validates a shared session secret or a signed token passed from Next.js.

---

## 3. Environment Configuration

All operator-defined values live in a single `.env` file. The application must refuse to start if required variables are missing.

```env
# ── Discord OAuth ──────────────────────────────────────────────
DISCORD_CLIENT_ID=
DISCORD_CLIENT_SECRET=
NEXTAUTH_SECRET=
NEXTAUTH_URL=

# ── Internal auth between Next.js ↔ FastAPI ───────────────────
INTERNAL_API_SECRET=          # Shared secret, passed as Bearer token

# ── MongoDB ───────────────────────────────────────────────────
MONGODB_URI=

# ── Proxmox VE ────────────────────────────────────────────────
PVE_HOST=
PVE_NODE=pve                  # Node name where VMs are provisioned
PVE_TOKEN_ID=root@pam!panel   # API token ID
PVE_TOKEN_SECRET=             # API token secret
PVE_VERIFY_SSL=false          # Set true in production with valid cert

# ── VM Templates (one VMID per OS image) ──────────────────────
TEMPLATE_UBUNTU_18=9001
TEMPLATE_UBUNTU_20=9002
TEMPLATE_UBUNTU_22=9003
TEMPLATE_UBUNTU_24=9004
TEMPLATE_CENTOS_7=9005
TEMPLATE_CENTOS_8=9006
TEMPLATE_DEBIAN_11=9007
TEMPLATE_DEBIAN_12=9008

# ── VM Provisioning ───────────────────────────────────────────
VM_STORAGE=local-lvm          # Target storage for cloned disks
VM_BRIDGE=vmbr0               # Network bridge
VM_VMID_MIN=100000            # VMID range start (inclusive)
VM_VMID_MAX=101000            # VMID range end (inclusive)

# ── Network / IP Pool ─────────────────────────────────────────
VM_IP_RANGE=10.10.0.0/24      # CIDR; IPs are assigned sequentially
VM_GATEWAY=10.10.0.1
VM_DNS=8.8.8.8

# ── Resource Caps (rentable headroom on the node) ─────────────
# CPU: total cores that can be allocated across all active VMs
RESOURCE_LIMIT_CPU=32
# RAM: total GB
RESOURCE_LIMIT_RAM_GB=128
# Disk: total GB
RESOURCE_LIMIT_DISK_GB=2000

# ── GPU Pool (JSON array of objects) ──────────────────────────
# Each entry: { "id": "human-readable label", "pci_id": "0000:01:00.0" }
RESOURCE_GPU_POOL=[{"id":"RTX3090-0","pci_id":"0000:01:00.0"},{"id":"RTX3090-1","pci_id":"0000:02:00.0"}]

# ── Point Pricing ─────────────────────────────────────────────
# Points charged per unit per hour
PRICE_CPU_CORE_HOUR=1
PRICE_RAM_GB_HOUR=2
PRICE_DISK_GB_HOUR=0          # Free, or set > 0
PRICE_GPU_HOUR=20

# ── Admin ─────────────────────────────────────────────────────
ADMIN_DISCORD_IDS=123456789,987654321
```

---

## 4. Data Models

All collections live in MongoDB. Field names use `snake_case`.

### 4.1 `users`

```json
{
  "_id": "ObjectId",
  "discord_id": "string (unique)",
  "discord_username": "string",
  "discord_avatar": "string (URL)",
  "points": "int (>= 0)",
  "created_at": "datetime",
  "updated_at": "datetime"
}
```

### 4.2 `codes`

Redemption codes generated by the admin.

```json
{
  "_id": "ObjectId",
  "code": "string (unique, e.g. 'FRIEND-XK9P')",
  "points_value": "int",
  "max_uses": "int (0 = unlimited)",
  "used_count": "int",
  "whitelist_discord_ids": ["string"],
  "created_at": "datetime",
  "expires_at": "datetime | null"
}
```

### 4.3 `redemptions`

Audit log of code redemptions.

```json
{
  "_id": "ObjectId",
  "user_id": "ObjectId (ref users)",
  "code_id": "ObjectId (ref codes)",
  "points_awarded": "int",
  "redeemed_at": "datetime"
}
```

### 4.4 `vms`

```json
{
  "_id": "ObjectId",
  "user_id": "ObjectId (ref users)",
  "vmid": "int",
  "name": "string",
  "os": "string (e.g. ubuntu-22)",
  "cpu_cores": "int",
  "ram_gb": "int",
  "disk_gb": "int",
  "gpu_id": "string | null",
  "gpu_pci_id": "string | null",
  "ip_address": "string",
  "password_hash": "string",
  "status": "string (provisioning | running | expired | error)",
  "points_charged": "int",
  "started_at": "datetime",
  "expires_at": "datetime",
  "deleted_at": "datetime | null",
  "pve_node": "string",
  "error_message": "string | null"
}
```

### 4.5 `transactions`

Point ledger — append-only.

```json
{
  "_id": "ObjectId",
  "user_id": "ObjectId",
  "delta": "int (positive = credit, negative = debit)",
  "reason": "string (redemption | vm_create | vm_refund)",
  "ref_id": "ObjectId | null",
  "balance_after": "int",
  "created_at": "datetime"
}
```

---

## 5. Authentication

- Discord OAuth via Auth.js on the Next.js side.
- On first login, a `users` document is upserted on `discord_id`.
- Next.js passes requests to FastAPI with `Authorization: Bearer <INTERNAL_API_SECRET>` and `X-Discord-Id` headers. FastAPI trusts these only when the secret matches.
- No public-facing FastAPI port — all access is proxied through Next.js.
- Admin: a comma-separated list of Discord IDs in `ADMIN_DISCORD_IDS` grants access to admin routes. Checked per-request in a FastAPI dependency.

---

## 6. Point Economy

### 6.1 Code Generation (Admin Only)

Admin creates a code via the admin panel. The system generates a random code string (e.g. `PANEL-XXXX-XXXX`) or accepts a custom one.

**Admin API:** `POST /api/v1/admin/codes`

Request body:
```json
{
  "points_value": 100,
  "max_uses": 5,
  "whitelist_discord_ids": ["123456789"],
  "expires_at": "2025-12-31T00:00:00Z"
}
```

### 6.2 Code Redemption

**API:** `POST /api/v1/codes/redeem`

Validation steps (fail fast, return specific error):
1. Code exists and is not expired.
2. `used_count < max_uses` (or `max_uses == 0`).
3. If `whitelist_discord_ids` is non-empty, the user's `discord_id` must be in it.
4. The user has not already redeemed this specific code (check `redemptions` collection).

On success:
- Increment `codes.used_count`.
- Credit `users.points`.
- Insert a `redemptions` document.
- Insert a `transactions` document (`reason: "redemption"`).

All writes in a MongoDB session/transaction.

---

## 7. Resource Limit System

The system tracks **allocated** resources, not actual utilisation. A VM is "allocated" from provisioning start until deleted (status `running` or `provisioning`).

**Available** = `RESOURCE_LIMIT_*` − sum of all active VMs' allocations.

### 7.1 CPU, RAM, Disk

Queried live from the `vms` collection on every availability check:

```python
pipeline = [
  {"$match": {"status": {"$in": ["provisioning", "running"]}}},
  {"$group": {
    "_id": None,
    "used_cpu": {"$sum": "$cpu_cores"},
    "used_ram": {"$sum": "$ram_gb"},
    "used_disk": {"$sum": "$disk_gb"}
  }}
]
```

### 7.2 GPU

Each GPU entry in `RESOURCE_GPU_POOL` is either free or occupied. A GPU is occupied if any active VM document holds that `gpu_id`. The availability endpoint returns the full GPU list with an `available: bool` per GPU.

### 7.3 IP Address Pool

IP pool is derived from `VM_IP_RANGE` (excluding network, gateway, and broadcast addresses). An IP is in use if any active VM holds it. On creation, pick the lowest available IP.

---

## 8. VM Lifecycle

### 8.1 Point Calculation

Charged upfront at creation time:

```
points = ceil(
  (cpu_cores × PRICE_CPU_CORE_HOUR
  + ram_gb × PRICE_RAM_GB_HOUR
  + disk_gb × PRICE_DISK_GB_HOUR
  + gpu_count × PRICE_GPU_HOUR)
  × duration_hours
)
```

Minimum charge: 1 point. Duration options: 1h, 2h, 4h, 8h, 12h, 24h (configurable via constants in code, not env).

### 8.2 Creation Flow

The creation endpoint runs steps in sequence. Any failure triggers cleanup and a refund.

**Pre-flight checks (return error immediately if any fail):**
1. User has enough points.
2. CPU headroom available.
3. RAM headroom available.
4. Disk headroom available.
5. Requested GPU is available (if GPU requested).
6. At least one free IP available.
7. A free VMID exists in `[VM_VMID_MIN, VM_VMID_MAX]`.

**Provisioning steps:**

```
Step 1 — Reserve
  Insert VM document with status="provisioning".
  Deduct points atomically (MongoDB findOneAndUpdate with $inc).

Step 2 — Clone template
  POST /api2/json/nodes/{node}/qemu/{template_vmid}/clone
  Body: { newid, name, full: 1, storage: VM_STORAGE, target: PVE_NODE }
  Poll task: GET /api2/json/nodes/{node}/tasks/{upid}/status
  Wait for exitstatus == "OK" (timeout: 5 min, poll every 2s).

Step 3 — Move disk to target storage
  POST /api2/json/nodes/{node}/qemu/{vmid}/move_disk
  Body: { disk: "scsi0", storage: VM_STORAGE, delete: 1 }
  Poll task until complete (timeout: 10 min).
  Skip if template disk is already on VM_STORAGE.

Step 4 — Set CPU and RAM
  PUT /api2/json/nodes/{node}/qemu/{vmid}/config
  Body: { cpu: "host", cores: <n>, memory: <ram_gb * 1024> }

Step 5 — Resize disk
  PUT /api2/json/nodes/{node}/qemu/{vmid}/resize
  Body: { disk: "scsi0", size: "<disk_gb>G" }
  Note: size must be >= current disk size; use PUT (not POST).

Step 6 — Attach GPU (if requested)
  PUT /api2/json/nodes/{node}/qemu/{vmid}/config
  Body: { hostpci0: "<pci_id>,pcie=1,x-vga=1" }

Step 7 — Configure cloud-init
  PUT /api2/json/nodes/{node}/qemu/{vmid}/config
  Body:
    cipassword: <random 16-char alphanumeric password>
    ipconfig0: "ip=<ip>/<prefix_len>,gw=<VM_GATEWAY>"
    nameserver: <VM_DNS>
    ciupgrade: 0

Step 8 — Start VM
  POST /api2/json/nodes/{node}/qemu/{vmid}/status/start
  Poll GET /api2/json/nodes/{node}/qemu/{vmid}/status/current
  Wait until status == "running" (timeout: 3 min).

Step 9 — Finalise
  Update VM: status="running", started_at=now, expires_at=now+duration.
  Return login info to caller (password in plaintext, one time only).
  Store bcrypt hash of password in VM document.
```

**On any step failure:**
- Set VM `status = "error"`, store `error_message`.
- Attempt `DELETE /nodes/{node}/qemu/{vmid}?purge=1` if VMID was already created.
- Issue refund via `transactions` record (`reason: "vm_refund"`).

### 8.3 Deletion Flow

Triggered by expiry scheduler or manual user delete.

```
Step 1 — Stop VM
  POST /api2/json/nodes/{node}/qemu/{vmid}/status/stop
  Poll until stopped or already stopped (timeout: 2 min).

Step 2 — Delete VM and disks
  DELETE /api2/json/nodes/{node}/qemu/{vmid}?purge=1&destroy-unreferenced-disks=1
  Poll task until complete.

Step 3 — Update database
  Set VM status="expired", deleted_at=now.
  IP and GPU are freed (no active VM holds them).
```

No point refund on natural expiry. No refund on manual early delete either (keep it simple).

---

## 9. PVE API Reference

**Base URL:** `{PVE_HOST}/api2/json`

**Authentication header:** `Authorization: PVEAPIToken={PVE_TOKEN_ID}={PVE_TOKEN_SECRET}`

No CSRF token required when using API tokens (unlike cookie-based auth).

| Action | Method | Endpoint |
|---|---|---|
| Node status | GET | `/nodes/{node}/status` |
| List VMs | GET | `/nodes/{node}/qemu` |
| Get VM config | GET | `/nodes/{node}/qemu/{vmid}/config` |
| Get VM status | GET | `/nodes/{node}/qemu/{vmid}/status/current` |
| Clone VM | POST | `/nodes/{node}/qemu/{vmid}/clone` |
| Update VM config | PUT | `/nodes/{node}/qemu/{vmid}/config` |
| Resize disk | PUT | `/nodes/{node}/qemu/{vmid}/resize` |
| Move disk | POST | `/nodes/{node}/qemu/{vmid}/move_disk` |
| Start VM | POST | `/nodes/{node}/qemu/{vmid}/status/start` |
| Stop VM | POST | `/nodes/{node}/qemu/{vmid}/status/stop` |
| Delete VM | DELETE | `/nodes/{node}/qemu/{vmid}` |
| Get task status | GET | `/nodes/{node}/tasks/{upid}/status` |

**Clone parameters:**
```
newid      int     New VMID for the cloned VM
name       string  VM name / hostname label
full       1       Full clone (required; linked clones share the base disk)
storage    string  Target storage pool (e.g. "local-lvm")
target     string  Target node name
```

**Config update parameters (cloud-init):**
```
cpu          string  CPU type, use "host"
cores        int     vCPU count
memory       int     RAM in MB (ram_gb × 1024)
cipassword   string  Plaintext password; PVE stores it encrypted in cloud-init ISO
ipconfig0    string  "ip=A.B.C.D/24,gw=A.B.C.1"
nameserver   string  DNS server IP
ciupgrade    int     0 to skip apt upgrade on first boot
hostpci0     string  PCI passthrough: "0000:01:00.0,pcie=1,x-vga=1"
```

**Resize parameters:**
```
disk    string  Disk device name (e.g. "scsi0")
size    string  Absolute target size (e.g. "50G")
```
Use `PUT` — `POST` to the resize endpoint returns `{"data": null}` without effect.

**Delete query parameters:**
```
purge=1                         Remove from replication config
destroy-unreferenced-disks=1   Delete associated disk volumes
```

**Task polling:**
```
GET /nodes/{node}/tasks/{upid}/status
Returns: { "data": { "status": "running"|"stopped", "exitstatus": "OK"|"ERROR: ..." } }
Poll every 2 seconds. Task is done when status == "stopped".
```

**VMID selection:**
Query `GET /nodes/{node}/qemu` to get all existing VMIDs. Pick a random integer in `[VM_VMID_MIN, VM_VMID_MAX]` not present in that set. Retry up to 10 times if collision occurs.

**Recommended Python library:** `proxmoxer` — wraps auth and request handling. Use with the `requests` backend and `verify=False` when `PVE_VERIFY_SSL=false`.

---

## 10. Frontend Pages & UI

Design direction: **minimal, dark-mode-first, responsive to 375px.** No decorative chrome. Show only what users need. Handle all loading, disabled, and error states explicitly.

### 10.1 Page Index

#### `/` — Homepage

- Public-accessible node resource stats: CPU available / total, RAM, Disk, GPU slots. Data from `GET /api/v1/resources`.
- Logged-out: "Login with Discord" button + resource overview.
- Logged-in: point balance, count of active VMs, quick link to Create and My VMs.

#### `/login`

Redirect-only page. Triggers Discord OAuth flow via Auth.js.

#### `/redeem`

Single code input + submit button. Inline success/error feedback. Shows points awarded on success.

#### `/create` — VM Creation

Single-page form with real-time feedback. Layout: spec inputs on the left, sticky cost summary on the right (bottom bar on mobile).

**Form sections:**
1. OS selector — icon grid (Ubuntu 18/20/22/24, CentOS 7/8, Debian 11/12).
2. CPU cores — number input with +/− buttons (min 1).
3. RAM GB — segmented selector: 1, 2, 4, 8, 16, 32 GB.
4. Disk GB — slider or input (10 GB increments, min 10 GB).
5. GPU — toggle. If enabled, dropdown of available GPU IDs. Show "(unavailable)" on occupied GPUs.
6. Duration — segmented control: 1h / 2h / 4h / 8h / 12h / 24h.

**Cost summary panel:**
- Points required (updates on every input change, no debounce needed).
- Your balance.
- Remaining after purchase (red text if negative).
- Per-resource availability indicator (warn if requested > 80% of available).

**Create button:**
- Disabled if: insufficient points, any resource unavailable, no OS selected.
- On click: shows provisioning modal.

**Provisioning modal:**
- Ordered step list with live status (spinner / checkmark / red X):
  - Reserving resources
  - Cloning template
  - Moving disk
  - Configuring resources
  - Setting up network
  - Starting VM
- On success: show IP, OS default username (`ubuntu` for Ubuntu, `root` for CentOS/Debian), password with copy button, expiry time. Password note: "Save this — it won't be shown again."
- On error: show error message + retry or close option.

#### `/vms` — My VMs

Cards or table rows for all VMs. Active VMs show: OS icon, specs, IP, time remaining (live countdown), status badge. Delete button with confirmation dialog. Expired VMs are dimmed, show "Expired X ago."

#### `/admin`

Gated — redirect to `/` if not an admin Discord ID.

**Tabs:**
- **Codes** — create form (points value, max uses, whitelist, expiry), code list with usage counters, invalidate button.
- **VMs** — table of all active VMs: user, VMID, specs, GPU, IP, expires in, status. Force-delete button.
- **Users** — list of all users with balances. Adjust points form per user (signed delta, reason text).

### 10.2 Shared Components

| Component | Description |
|---|---|
| `ResourceBar` | Labelled progress bar: used / limit with colour shift at 80% / 100% |
| `VMCard` | Active or expired VM summary with status badge and countdown timer |
| `PointsBadge` | Current balance in header, updated after any transaction |
| `ProvisioningModal` | Step-by-step status display during VM creation |
| `ConfirmDialog` | Generic confirm/cancel modal for destructive actions |

---

## 11. Backend API Routes

All routes under `/api/v1/`. FastAPI validates auth on every request via a dependency that reads `Authorization` and `X-Discord-Id` headers.

### Public

| Method | Path | Description |
|---|---|---|
| GET | `/resources` | Available and total resources (CPU, RAM, Disk, GPU list) |

### User (requires valid Discord session)

| Method | Path | Description |
|---|---|---|
| GET | `/me` | Profile and point balance |
| GET | `/me/transactions` | Paginated transaction history |
| POST | `/codes/redeem` | Redeem a code |
| GET | `/vms` | Caller's VMs (all statuses) |
| POST | `/vms` | Create a VM |
| DELETE | `/vms/{vm_id}` | Delete an active VM (caller must own it) |

### Admin (requires Discord ID in ADMIN_DISCORD_IDS)

| Method | Path | Description |
|---|---|---|
| GET | `/admin/vms` | All VMs (any user) |
| DELETE | `/admin/vms/{vm_id}` | Force-delete any VM |
| GET | `/admin/users` | All users with balances |
| POST | `/admin/users/{user_id}/adjust-points` | Add or subtract points |
| POST | `/admin/codes` | Create redemption code |
| GET | `/admin/codes` | List all codes with usage |
| DELETE | `/admin/codes/{code_id}` | Invalidate a code |

### `POST /vms` — Request

```json
{
  "os": "ubuntu-22",
  "cpu_cores": 4,
  "ram_gb": 8,
  "disk_gb": 50,
  "gpu_id": null,
  "duration_hours": 4
}
```

### `POST /vms` — Response (success 201)

```json
{
  "vm_id": "664abc...",
  "vmid": 100042,
  "ip_address": "10.10.0.5",
  "username": "ubuntu",
  "password": "aB3kR9pQ2mXn7yLz",
  "expires_at": "2025-06-01T12:00:00Z",
  "points_charged": 72
}
```

`password` appears only in this response. Not stored in plaintext.

### `GET /resources` — Response

```json
{
  "cpu": { "available": 20, "total": 32 },
  "ram_gb": { "available": 64, "total": 128 },
  "disk_gb": { "available": 1200, "total": 2000 },
  "gpus": [
    { "id": "RTX3090-0", "available": true },
    { "id": "RTX3090-1", "available": false }
  ]
}
```

---

## 12. Background Jobs

Implemented with `APScheduler` (AsyncIOScheduler) registered in FastAPI's `lifespan` context manager.

### 12.1 VM Expiry Checker

- **Interval:** every 60 seconds.
- **Action:** Query `vms` where `status == "running"` and `expires_at <= now`. For each, run the deletion flow (section 8.3).
- **On PVE failure:** mark VM `status = "error"`, log error. Do not retry automatically (operator resolves manually).

### 12.2 Stuck Provisioning Checker

- **Interval:** every 5 minutes.
- **Action:** Query `vms` where `status == "provisioning"` and `created_at < now - 15 minutes`. Mark as `error`, attempt PVE cleanup, issue refund.

---

## 13. Error Handling & Edge Cases

| Scenario | Handling |
|---|---|
| PVE API unreachable | Return HTTP 503: "Provisioning service unavailable." |
| Clone task exits with ERROR | Log PVE error, refund points, set VM status=error |
| VMID collision on selection | Retry up to 10 times; fail with 409 if all retries collide |
| All IPs exhausted | Return 409: "No IP addresses available." |
| Disk resize requested < template size | Clamp to max(requested, template_disk_size); do not error |
| User redeems same code twice | Check `redemptions` collection; return 409 "Already redeemed." |
| Concurrent creation race on GPU | Use atomic MongoDB update with `$set` + condition; reject if GPU taken |
| Concurrent creation race on IP | Unique index on `ip_address` among active VMs; catch DuplicateKeyError, retry with next IP |
| VM delete requested while still provisioning | Set a `pending_delete` flag; expiry checker cleans it up once provisioning resolves |
| Resize PUT instead of POST | Agent note: disk resize is `PUT`, not `POST` — `POST` silently returns null |