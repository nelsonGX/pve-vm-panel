from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel


class CodeCreateRequest(BaseModel):
    points_value: int
    max_uses: int = 0
    whitelist_discord_ids: list[str] = []
    expires_at: datetime | None = None
    code: str | None = None


class CodeRedeemRequest(BaseModel):
    code: str


class CodeResponse(BaseModel):
    id: str
    code: str
    points_value: int
    max_uses: int
    current_uses: int
    whitelist_discord_ids: list[str]
    expires_at: datetime | None = None
    created_at: datetime
    is_active: bool

    model_config = {"from_attributes": True}
