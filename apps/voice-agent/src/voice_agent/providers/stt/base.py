from __future__ import annotations

from typing import Protocol


class STTProvider(Protocol):
    async def transcribe(self, audio_bytes: bytes, language: str | None = None) -> str:
        ...
