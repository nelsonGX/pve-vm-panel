from __future__ import annotations

import json
import re
from typing import Any
from urllib.parse import urlparse

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

DURATION_OPTIONS: list[int] = [1, 2, 4, 8, 12, 24, 36, 48, 168, 720]  # incl. 7d, 30d
PCI_ID_RE = re.compile(
    r"^(?:(?P<domain>[0-9a-fA-F]{4}):)?"
    r"(?P<bus>[0-9a-fA-F]{2}):"
    r"(?P<slot>[0-9a-fA-F]{2})"
    r"(?:\.(?P<function>[0-7]))?$"
)
MAPPING_ID_RE = re.compile(r"^[A-Za-z0-9_.-]+$")


def normalize_pci_id(value: Any) -> str:
    if not isinstance(value, str):
        raise ValueError("PCI ID must be a string")

    pci_id = value.strip()
    match = PCI_ID_RE.fullmatch(pci_id)
    if match is None:
        raise ValueError(
            f"Invalid PCI ID '{value}'. Expected '61:00.0' or '0000:61:00.0'"
        )

    domain = match.group("domain") or "0000"
    bus = match.group("bus")
    slot = match.group("slot")
    function = match.group("function")
    suffix = f".{function}" if function is not None else ""
    return f"{domain}:{bus}:{slot}{suffix}".lower()


def pci_slot_id(pci_id: str) -> str:
    return pci_id.split(".", 1)[0]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    # Discord / Auth
    DISCORD_CLIENT_ID: str
    DISCORD_CLIENT_SECRET: str
    NEXTAUTH_SECRET: str
    NEXTAUTH_URL: str

    INTERNAL_API_SECRET: str

    # Friend Group Auth — credit payments (https://group.nelsongx.com)
    # Charging is enabled only when both client credentials are present.
    AUTH_BASE_URL: str = "https://group.nelsongx.com"
    AUTH_CLIENT_ID: str = ""
    AUTH_CLIENT_SECRET: str = ""
    # App-internal points granted per 1 credit (1 credit = 1 TWD on the
    # platform; this app issues 100 points per TWD).
    POINTS_PER_CREDIT: int = 100

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

    # Bulk VM creation: max concurrent Proxmox provisions at once
    BULK_CREATE_CONCURRENCY: int = 5

    # VPN
    NEED_VPN: bool = False
    VPN_SUBNET: str = "10.100.0.0/24"
    VPN_SERVER_ENDPOINT: str = ""   # e.g. "vpn.example.com:51820"
    VPN_SERVER_PUBLIC_KEY: str = "" # WireGuard public key of the proxy server
    VPN_DNS: str = "1.1.1.1"
    VPN_DAEMON_SECRET: str = ""     # Shared secret for the proxy-daemon sync endpoint

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
            return cls._normalize_gpu_pool(parsed)
        if isinstance(v, list):
            return cls._normalize_gpu_pool(v)
        raise ValueError("RESOURCE_GPU_POOL must be a JSON array string or list")

    @classmethod
    def _normalize_gpu_pool(cls, pool: list[Any]) -> list[dict[str, Any]]:
        normalized: list[dict[str, Any]] = []
        seen_ids: set[str] = set()

        for index, raw in enumerate(pool):
            if not isinstance(raw, dict):
                raise ValueError(f"RESOURCE_GPU_POOL entry {index} must be an object")

            gpu_id = raw.get("id")
            if not isinstance(gpu_id, str) or not gpu_id.strip():
                raise ValueError(f"RESOURCE_GPU_POOL entry {index} must include a non-empty id")
            gpu_id = gpu_id.strip()
            if gpu_id in seen_ids:
                raise ValueError(f"Duplicate GPU id '{gpu_id}' in RESOURCE_GPU_POOL")
            seen_ids.add(gpu_id)

            mapping_id = raw.get("mapping_id")
            if mapping_id is not None:
                if not isinstance(mapping_id, str) or not mapping_id.strip():
                    raise ValueError(
                        f"RESOURCE_GPU_POOL entry '{gpu_id}' mapping_id must be a non-empty string"
                    )
                mapping_id = mapping_id.strip()
                if MAPPING_ID_RE.fullmatch(mapping_id) is None:
                    raise ValueError(
                        f"RESOURCE_GPU_POOL entry '{gpu_id}' has invalid mapping_id '{mapping_id}'"
                    )

            pci_values = raw.get("pci_ids", raw.get("pci_id"))
            if pci_values is None and mapping_id is None:
                raise ValueError(
                    f"RESOURCE_GPU_POOL entry '{gpu_id}' must include mapping_id, pci_id, or pci_ids"
                )
            if pci_values is None:
                pci_ids = []
            elif isinstance(pci_values, str):
                pci_ids = [normalize_pci_id(pci_values)]
            elif isinstance(pci_values, list) and pci_values:
                pci_ids = [normalize_pci_id(item) for item in pci_values]
            else:
                raise ValueError(f"RESOURCE_GPU_POOL entry '{gpu_id}' has invalid pci_ids")

            hostpci_slots = list(dict.fromkeys(pci_slot_id(pci_id) for pci_id in pci_ids))
            options = raw.get("hostpci_options")
            hostpci_count = 1 if mapping_id is not None else len(hostpci_slots)
            if options is None:
                hostpci_options: list[str] = ["pcie=1"] * hostpci_count
            elif isinstance(options, str):
                hostpci_options = [options.strip()] + ["pcie=1"] * (hostpci_count - 1)
            elif isinstance(options, list) and len(options) == hostpci_count:
                hostpci_options = []
                for option in options:
                    if not isinstance(option, str):
                        raise ValueError(
                            f"RESOURCE_GPU_POOL entry '{gpu_id}' hostpci_options must be strings"
                        )
                    hostpci_options.append(option.strip())
            else:
                raise ValueError(
                    f"RESOURCE_GPU_POOL entry '{gpu_id}' hostpci_options must be a string "
                    "or an array matching pci_ids"
                )

            normalized.append({
                **raw,
                "id": gpu_id,
                "mapping_id": mapping_id,
                "pci_id": pci_ids[0] if pci_ids else None,
                "pci_ids": pci_ids,
                "hostpci_slots": hostpci_slots,
                "hostpci_options": hostpci_options,
            })

        return normalized

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
    def payments_enabled(self) -> bool:
        """Credit purchases are available only when FGA client creds are set."""
        return bool(self.AUTH_CLIENT_ID and self.AUTH_CLIENT_SECRET)

    @property
    def payment_return_url(self) -> str:
        """Registered return URL the user lands on after paying."""
        return f"{self.NEXTAUTH_URL.rstrip('/')}/pay/return"

    @property
    def cors_origins(self) -> list[str]:
        origins: list[str] = []
        parsed = urlparse(self.NEXTAUTH_URL)
        if parsed.scheme and parsed.netloc:
            origins.append(f"{parsed.scheme}://{parsed.netloc}")
        return origins

settings = Settings()  # type: ignore[call-arg]
