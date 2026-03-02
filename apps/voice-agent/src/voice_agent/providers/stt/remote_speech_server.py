from __future__ import annotations

import aiohttp


class RemoteSpeechServerSTT:
    def __init__(self, base_url: str, transcribe_path: str, model: str) -> None:
        self._url = f"{base_url.rstrip('/')}/{transcribe_path.lstrip('/')}"
        self._model = model

    async def transcribe(self, audio_bytes: bytes, language: str | None = None) -> str:
        data = aiohttp.FormData()
        data.add_field("model", self._model)
        if language:
            data.add_field("language", language)
        data.add_field("file", audio_bytes, filename="audio.wav", content_type="audio/wav")

        timeout = aiohttp.ClientTimeout(total=20)
        async with aiohttp.ClientSession(timeout=timeout) as session:
            async with session.post(self._url, data=data) as response:
                if response.status >= 400:
                    raise RuntimeError(f"stt_failed_{response.status}")
                payload = await response.json()
                return str(payload.get("text", "")).strip()
