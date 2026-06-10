from __future__ import annotations

from pydantic import BaseModel, Field


class PayIntentRequest(BaseModel):
    # Number of credits to charge (1 credit = 1 TWD). Grants
    # credits * POINTS_PER_CREDIT app points.
    credits: int = Field(gt=0, le=100000)


class PayVerifyRequest(BaseModel):
    intent_id: str
