from __future__ import annotations

import json
from typing import Any
from urllib.parse import urlparse

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

DURATION_OPTIONS: list[int] = [1, 2, 4, 8, 12, 24]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    # Discord / Auth
    DISCORD_CLIENT_ID: str
    DISCORD_CLIENT_SECRET: str
    NEXTAUTH_SECRET: str
    NEXTAUTH_URL: str

    INTERNAL_API_SECRET: str

    # MongoDB
    MONGODB_URI: str

    # Proxmox VE
    PVE_HOST: str
    PVE_NODE: str = "pve"
    PVE_TOKEN_ID: str
    PVE_TOKEN_SECRET: str
    PVE_VERIFY_SSL: bool = False

    # Template VMIDs
    TEMPLATE_UBUNTU_18: int = 0
    TEMPLATE_UBUNTU_20: int = 0
    TEMPLATE_UBUNTU_22: int = 0
    TEMPLATE_UBUNTU_24: int = 0
    TEMPLATE_CENTOS_7: int = 0
    TEMPLATE_CENTOS_8: int = 0
    TEMPLATE_DEBIAN_11: int = 0
    TEMPLATE_DEBIAN_12: int = 0

    # VM allocation
    VM_STORAGE: str
    VM_BRIDGE: str
    VM_VMID_MIN: int = 100000
    VM_VMID_MAX: int = 101000

    # Networking
    VM_IP_RANGE: str
    VM_GATEWAY: str
    VM_DNS: str

    # Resource limits per VM
    RESOURCE_LIMIT_CPU: int
    RESOURCE_LIMIT_RAM_GB: int
    RESOURCE_LIMIT_DISK_GB: int

    # GPU pool — stored as a JSON string in env
    RESOURCE_GPU_POOL: list[dict[str, Any]] = []

    # Pricing
    PRICE_CPU_CORE_HOUR: float
    PRICE_RAM_GB_HOUR: float
    PRICE_DISK_GB_HOUR: float
    PRICE_GPU_HOUR: float

    # Admin Discord IDs (comma-separated in env)
    ADMIN_DISCORD_IDS: list[str] = []

    # ------------------------------------------------------------------ #
    # Validators
    # ------------------------------------------------------------------ #

    @field_validator("RESOURCE_GPU_POOL", mode="before")
    @classmethod
    def parse_gpu_pool(cls, v: Any) -> list[dict[str, Any]]:
        if isinstance(v, str):
            try:
                parsed = json.loads(v)
            except json.JSONDecodeError as exc:
                raise ValueError(f"RESOURCE_GPU_POOL must be valid JSON: {exc}") from exc
            if not isinstance(parsed, list):
                raise ValueError("RESOURCE_GPU_POOL must be a JSON array")
            return parsed
        if isinstance(v, list):
            return v
        raise ValueError("RESOURCE_GPU_POOL must be a JSON array string or list")

    @field_validator("ADMIN_DISCORD_IDS", mode="before")
    @classmethod
    def parse_admin_ids(cls, v: Any) -> list[str]:
        if isinstance(v, (int, float)):
            return [str(int(v))]
        if isinstance(v, str):
            return [item.strip() for item in v.split(",") if item.strip()]
        if isinstance(v, list):
            return [str(item) for item in v]
        raise ValueError("ADMIN_DISCORD_IDS must be a comma-separated string or list")

    # ------------------------------------------------------------------ #
    # Convenience helpers
    # ------------------------------------------------------------------ #

    def get_template_vmid(self, os: str) -> int | None:
        """Return the template VMID for the given OS slug, or None if not configured."""
        mapping: dict[str, int] = {
            "ubuntu-18": self.TEMPLATE_UBUNTU_18,
            "ubuntu-20": self.TEMPLATE_UBUNTU_20,
            "ubuntu-22": self.TEMPLATE_UBUNTU_22,
            "ubuntu-24": self.TEMPLATE_UBUNTU_24,
            "centos-7": self.TEMPLATE_CENTOS_7,
            "centos-8": self.TEMPLATE_CENTOS_8,
            "debian-11": self.TEMPLATE_DEBIAN_11,
            "debian-12": self.TEMPLATE_DEBIAN_12,
        }
        vmid = mapping.get(os.lower())
        if not vmid:
            return None
        return vmid

    @property
    def cors_origins(self) -> list[str]:
        origins: list[str] = []
        parsed = urlparse(self.NEXTAUTH_URL)
        if parsed.scheme and parsed.netloc:
            origins.append(f"{parsed.scheme}://{parsed.netloc}")
        return origins

settings = Settings()  # type: ignore[call-arg]
