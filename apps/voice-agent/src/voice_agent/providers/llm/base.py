from __future__ import annotations

from typing import Protocol


class LLMProvider(Protocol):
    async def complete(self, user_text: str, system_prompt: str) -> str:
        ...
