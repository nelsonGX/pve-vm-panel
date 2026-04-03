# PVE VM Panel

This project is a small self-hosted VM panel for Proxmox VE.

Users sign in with Discord, see available cluster resources, spend points to create VMs, manage their running machines, and redeem codes for more points. Admins can manage users, VMs, and redemption codes from the web UI.

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

## Stack

- Frontend: Next.js
- Backend: FastAPI
- Database: MongoDB
- Hypervisor: Proxmox VE API

## Project Structure

- `frontend/`: Next.js app and UI
- `backend/`: FastAPI API, Proxmox logic, scheduled jobs
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