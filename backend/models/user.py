from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel


class UserResponse(BaseModel):
    discord_id: str
    discord_username: str
    discord_avatar: str | None = None
    points: int
    created_at: datetime

    model_config = {"from_attributes": True}
