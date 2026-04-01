from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel


class TransactionResponse(BaseModel):
    id: str
    user_id: str
    type: str          # "credit" | "debit"
    amount: int
    description: str
    reference_id: str | None = None  # vm_id or code_id
    created_at: datetime

    model_config = {"from_attributes": True}
