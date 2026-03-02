from __future__ import annotations

from datetime import UTC, datetime
from typing import Any, Literal
from uuid import uuid4

from pydantic import BaseModel, ConfigDict, Field


class ActionPolicy(BaseModel):
    requiresConfirmation: bool = False


class NavigateParams(BaseModel):
    screen: Literal["Home", "Settings", "Profile", "Notes"]
    prefill: str | None = None


class AppendNoteParams(BaseModel):
    text: str = Field(min_length=1, max_length=2000)


class ActionPayload(BaseModel):
    name: Literal["navigate", "append_note", "open_profile", "set_settings_hint"]
    params: dict[str, Any] = Field(default_factory=dict)
    policy: ActionPolicy = Field(default_factory=ActionPolicy)


class AgentActionEnvelope(BaseModel):
    model_config = ConfigDict(extra="forbid")

    type: Literal["action"] = "action"
    version: Literal["1.0"] = "1.0"
    requestId: str = Field(default_factory=lambda: str(uuid4()))
    timestamp: str = Field(default_factory=lambda: datetime.now(UTC).isoformat().replace("+00:00", "Z"))
    action: ActionPayload
