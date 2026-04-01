from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from database import close_client, create_indexes
from jobs import setup_scheduler, start_scheduler, stop_scheduler
from routes.admin import router as admin_router
from routes.codes import router as codes_router
from routes.me import router as me_router
from routes.resources import router as resources_router
from routes.vms import router as vms_router

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # ---- startup ----
    logger.info("Starting PVE VM Store API…")
    await create_indexes()
    logger.info("MongoDB indexes ensured")
    setup_scheduler(app)
    start_scheduler()
    yield
    # ---- shutdown ----
    logger.info("Shutting down…")
    stop_scheduler()
    await close_client()
    logger.info("Shutdown complete")


app = FastAPI(
    title="PVE VM Store API",
    version="1.0.0",
    root_path="/api/v1",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# -------------------------------------------------------------------------
# Routers
# -------------------------------------------------------------------------
app.include_router(resources_router)
app.include_router(me_router)
app.include_router(codes_router)
app.include_router(vms_router)
app.include_router(admin_router)


# -------------------------------------------------------------------------
# Health check (no auth required)
# -------------------------------------------------------------------------
@app.get("/health", tags=["health"])
async def health_check():
    return {"status": "ok"}
