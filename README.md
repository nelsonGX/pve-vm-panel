# PVE VM Panel

This project is a small self-hosted VM panel for Proxmox VE.

Users sign in with Discord, see available cluster resources, spend points to create VMs, manage their running machines, and redeem codes for more points. Admins can manage users, VMs, and redemption codes from the web UI.

## Cool Screenshots
Dashboard
<img width="1293" height="936" alt="image" src="https://github.com/user-attachments/assets/5ffdac0f-10d7-4121-a552-98089579aa78" />
My VMs
<img width="1270" height="506" alt="image" src="https://github.com/user-attachments/assets/d1451bed-2c95-4fcf-a6da-cd0841ac77dd" />
Create VM
<img width="1272" height="514" alt="image" src="https://github.com/user-attachments/assets/462d7b0c-3484-4ab8-9e89-82977d995f12" />
VM Provisioning
<img width="545" height="329" alt="image" src="https://github.com/user-attachments/assets/c0b01e1a-2e64-432d-87b2-e399d85328af" />
VM Created
<img width="526" height="533" alt="image" src="https://github.com/user-attachments/assets/6b16830b-8995-41dc-9e0f-ac153e758b66" />


## What It Does

- Discord login with NextAuth
- Shows cluster resource availability
- Creates single or bulk VMs from Proxmox templates
- Supports optional GPU assignment
- Charges points based on CPU, RAM, disk, GPU, and duration
- Lets users start, stop, restart, and delete their VMs
- Expires VMs automatically
- Includes an admin page for:
  - viewing users
  - adjusting points
  - creating redemption codes
  - force deleting VMs
- Optional WireGuard VPN proxy so users can reach VMs that have no public IP

## Stack

- Frontend: Next.js
- Backend: FastAPI
- Database: MongoDB
- Hypervisor: Proxmox VE API

## Project Structure

- `frontend/`: Next.js app and UI
- `backend/`: FastAPI API, Proxmox logic, scheduled jobs
- `proxy-daemon/`: WireGuard proxy daemon (optional, for VPN access to VMs)
- `.env.example`: required environment variables

## Requirements

Before deploying, you need:

- Node.js
- Python 3.13+
- MongoDB
- A Proxmox VE node with API token access
- Discord OAuth application credentials

## Configuration

Copy `.env.example` to /frontend/`.env` and /backend/`.env` and fill in all required values.

## Local Development

### 1. Start the backend

From `backend/`:

```bash
uv sync
uv run fastapi dev --port 8124 --reload
```

If you do not use `uv`, install from `requirements.txt` or `pyproject.toml` and run:

```bash
fastapi dev --port 8124 --reload
```

### 2. Start the frontend

From `frontend/`:

```bash
npm install
npm run dev
```

The frontend runs on `http://localhost:3000` and expects the backend on `http://localhost:8124`.

## Simple Deployment

The simplest production setup is:

1. Run the FastAPI backend on the same server, port `8124`
2. Run the Next.js frontend on the same server, port `3000`
3. Put Nginx or Caddy in front of both
4. Keep MongoDB reachable by the backend

Recommended layout:

- `https://your-domain.com` -> Next.js frontend
- Next.js proxies `/api/v1/*` requests to the FastAPI backend
- FastAPI talks to MongoDB and Proxmox

## Example Production Steps

### Backend

```bash
cd backend
uv sync
uv run fastapi start --host 127.0.0.1 --port 8124
```

### Frontend

```bash
cd frontend
npm install
npm run build
npm run start
```

## WireGuard VPN (Optional)

If your VMs don't have public IPs, the panel can provide each user a personal WireGuard config that routes their traffic through a cloud proxy server.

### How it works

```
User device  ──(WireGuard)──►  Proxy server  ──(LAN/route)──►  VM (private IP)
```

The proxy daemon runs on the cloud server, pulls the peer list from the panel every 30 seconds, and applies changes live with `wg set` (never restarting the interface).

### Setup

#### 1. Panel env vars

Add these to your `.env` (backend) and `.env.local` (frontend):

```env
NEED_VPN=true
VPN_SUBNET=10.100.0.0/24          # address space for VPN clients
VPN_SERVER_ENDPOINT=1.2.3.4:51820 # public IP/host of the proxy server
VPN_DAEMON_SECRET=a-long-random-secret
```

Set `NEXT_PUBLIC_NEED_VPN=true` in `frontend/.env.local`.

> `VPN_SERVER_PUBLIC_KEY` is **not required** — the daemon registers its public key automatically on first sync.

#### 2. Deploy the proxy daemon

Copy the `proxy-daemon/` folder to your cloud server and run:

```bash
cd proxy-daemon
sudo bash install.sh
```

The script will:
- Install WireGuard and Python
- Generate a WireGuard server keypair
- Prompt for `PANEL_API_URL`, `DAEMON_SECRET`, VPN subnet, listen port, and network interface
- Write `/opt/wg-daemon/.env`
- Install and enable `wg-daemon.service`

Then start it:

```bash
systemctl start wg-daemon
journalctl -u wg-daemon -f
```

On startup the daemon logs its public key:

```
Server public key: <base64>
```

The panel picks this up automatically on the next sync — no manual copy-paste of keys needed.

#### 3. Make the proxy reachable to VMs

The proxy server needs a route to your VM private network (e.g. `10.86.0.0/16`). Options:

- Deploy the proxy on the same LAN as the PVE host
- Add a static route on the proxy pointing at the PVE host's IP
- Run a second WireGuard tunnel between the proxy and the PVE host

#### User flow

When a user creates their first VM (and VPN is enabled), the panel automatically generates a WireGuard config for them and shows a prompt to download it. They can also retrieve it anytime from **Header → VPN Config**.
