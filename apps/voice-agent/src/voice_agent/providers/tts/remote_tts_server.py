from __future__ import annotations

import aiohttp


class RemoteTTS:
    def __init__(self, base_url: str, synthesize_path: str) -> None:
        self._url = f"{base_url.rstrip('/')}/{synthesize_path.lstrip('/')}"

    async def synthesize(self, text: str, language: str | None = None) -> bytes:
        payload = {"text": text}
        if language:
            payload["language"] = language

        timeout = aiohttp.ClientTimeout(total=20)
        async with aiohttp.ClientSession(timeout=timeout) as session:
            async with session.post(self._url, json=payload) as response:
                if response.status >= 400:
                    raise RuntimeError(f"tts_failed_{response.status}")
                return await response.read()
