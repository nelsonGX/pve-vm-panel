from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, field_validator

from config import DURATION_OPTIONS


class VMCreateRequest(BaseModel):
    os: str
    cpu_cores: int
    ram_gb: int
    disk_gb: int
    gpu_id: str | None = None
    duration_hours: int

    @field_validator("duration_hours")
    @classmethod
    def validate_duration(cls, v: int) -> int:
        if v not in DURATION_OPTIONS:
            raise ValueError(f"duration_hours must be one of {DURATION_OPTIONS}")
        return v

    @field_validator("cpu_cores")
    @classmethod
    def validate_cpu(cls, v: int) -> int:
        if v < 1:
            raise ValueError("cpu_cores must be at least 1")
        return v

    @field_validator("ram_gb")
    @classmethod
    def validate_ram(cls, v: int) -> int:
        if v < 1:
            raise ValueError("ram_gb must be at least 1")
        return v

    @field_validator("disk_gb")
    @classmethod
    def validate_disk(cls, v: int) -> int:
        if v < 1:
            raise ValueError("disk_gb must be at least 1")
        return v


class VMCreateResponse(BaseModel):
    vm_id: str
    vmid: int
    ip_address: str
    username: str
    password: str
    expires_at: datetime
    points_charged: int


class BulkVMCreateRequest(BaseModel):
    os: str
    cpu_cores: int
    ram_gb: int
    disk_gb: int
    duration_hours: int
    count: int
    password_mode: str  # "random" or "unified"
    unified_password: str | None = None
    source_vmid: int | None = None  # PVE vmid of user's own VM to use as template

    @field_validator("duration_hours")
    @classmethod
    def validate_duration(cls, v: int) -> int:
        if v not in DURATION_OPTIONS:
            raise ValueError(f"duration_hours must be one of {DURATION_OPTIONS}")
        return v

    @field_validator("cpu_cores")
    @classmethod
    def validate_cpu(cls, v: int) -> int:
        if v < 1:
            raise ValueError("cpu_cores must be at least 1")
        return v

    @field_validator("ram_gb")
    @classmethod
    def validate_ram(cls, v: int) -> int:
        if v < 1:
            raise ValueError("ram_gb must be at least 1")
        return v

    @field_validator("disk_gb")
    @classmethod
    def validate_disk(cls, v: int) -> int:
        if v < 1:
            raise ValueError("disk_gb must be at least 1")
        return v

    @field_validator("count")
    @classmethod
    def validate_count(cls, v: int) -> int:
        if v < 1 or v > 50:
            raise ValueError("count must be between 1 and 50")
        return v

    @field_validator("password_mode")
    @classmethod
    def validate_password_mode(cls, v: str) -> str:
        if v not in ("random", "unified"):
            raise ValueError("password_mode must be 'random' or 'unified'")
        return v


class VMResponse(BaseModel):
    vm_id: str
    vmid: int
    user_id: str
    os: str
    cpu_cores: int
    ram_gb: int
    disk_gb: int
    gpu_id: str | None = None
    ip_address: str | None = None
    username: str
    status: str
    created_at: datetime
    expires_at: datetime
    points_charged: int

    model_config = {"from_attributes": True}
