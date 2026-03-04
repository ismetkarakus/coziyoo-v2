from __future__ import annotations

from datetime import UTC, datetime
from typing import Any, Literal
from uuid import uuid4

from pydantic import BaseModel, ConfigDict, Field


class NavigateParams(BaseModel):
    screen: Literal["Menu", "Cart", "OrderStatus", "Profile"]


class AddToCartParams(BaseModel):
    productId: str
    productName: str
    quantity: int = Field(ge=1)
    price: float


class ShowOrderSummaryParams(BaseModel):
    items: list[dict[str, Any]]
    total: float


class ActionPayload(BaseModel):
    name: Literal["navigate", "add_to_cart", "show_order_summary"]
    params: dict[str, Any] = Field(default_factory=dict)


class AgentActionEnvelope(BaseModel):
    model_config = ConfigDict(extra="forbid")

    type: Literal["action"] = "action"
    version: Literal["1.0"] = "1.0"
    requestId: str = Field(default_factory=lambda: str(uuid4()))
    timestamp: str = Field(default_factory=lambda: datetime.now(UTC).isoformat().replace("+00:00", "Z"))
    action: ActionPayload
