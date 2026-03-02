from __future__ import annotations

from datetime import UTC, datetime
from enum import Enum
from typing import Any
from uuid import uuid4

from pydantic import BaseModel, Field


class DispatchStatus(str, Enum):
    queued = "queued"
    processing = "processing"
    completed = "completed"
    failed = "failed"


class JoinTaskPayload(BaseModel):
    roomName: str = Field(min_length=1, max_length=128)
    participantIdentity: str = Field(min_length=3, max_length=128)
    participantName: str = Field(min_length=1, max_length=128)
    wsUrl: str
    token: str
    metadata: str
    voiceMode: str | None = None
    payload: dict[str, Any] | None = None


class DispatchTask(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid4()))
    createdAt: str = Field(default_factory=lambda: datetime.now(UTC).isoformat().replace("+00:00", "Z"))
    updatedAt: str = Field(default_factory=lambda: datetime.now(UTC).isoformat().replace("+00:00", "Z"))
    status: DispatchStatus = DispatchStatus.queued
    payload: JoinTaskPayload
    attempts: int = 0
    error: str | None = None

    def touch(self) -> None:
        self.updatedAt = datetime.now(UTC).isoformat().replace("+00:00", "Z")
