from __future__ import annotations

import aiohttp


class OllamaLLM:
    def __init__(self, base_url: str, model: str) -> None:
        self._base_url = base_url.rstrip("/")
        self._model = model

    async def complete(self, user_text: str, system_prompt: str) -> str:
        payload = {
            "model": self._model,
            "stream": False,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_text},
            ],
        }

        timeout = aiohttp.ClientTimeout(total=30)
        async with aiohttp.ClientSession(timeout=timeout) as session:
            async with session.post(f"{self._base_url}/api/chat", json=payload) as response:
                if response.status >= 400:
                    raise RuntimeError(f"ollama_failed_{response.status}")
                data = await response.json()
                message = data.get("message") or {}
                return str(message.get("content", "")).strip()
