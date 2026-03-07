"""HTTP-based STT adapter for OpenAI Whisper-compatible remote speech servers.

Posts audio as multipart/form-data to {baseUrl}{transcribePath} and parses
the JSON transcription response.
"""

from __future__ import annotations

import io
import json
import logging
import uuid
import wave

import aiohttp
from livekit.agents.stt import (
    STT,
    STTCapabilities,
    SpeechData,
    SpeechEvent,
    SpeechEventType,
)
from livekit.agents.types import DEFAULT_API_CONNECT_OPTIONS, APIConnectOptions
from livekit.agents.utils import AudioBuffer
from livekit.agents.utils.audio import combine_frames

logger = logging.getLogger("coziyoo-voice-agent.http-stt")


class HttpSTT(STT):
    def __init__(
        self,
        *,
        base_url: str,
        transcribe_path: str = "/v1/audio/transcriptions",
        model: str = "whisper-1",
        language: str = "en",
        auth_header: str | None = None,
        query_params: dict | None = None,
    ) -> None:
        super().__init__(
            capabilities=STTCapabilities(
                streaming=False,
                interim_results=False,
            )
        )
        self._base_url = base_url.rstrip("/")
        self._transcribe_path = transcribe_path
        self._model_name = model
        self._language = language
        self._auth_header = auth_header
        self._query_params = query_params
        self._session: aiohttp.ClientSession | None = None

    @property
    def model(self) -> str:
        return self._model_name

    @property
    def provider(self) -> str:
        return "http-stt"

    def _get_session(self) -> aiohttp.ClientSession:
        if self._session is None or self._session.closed:
            self._session = aiohttp.ClientSession()
        return self._session

    async def _recognize_impl(
        self,
        buffer: AudioBuffer,
        *,
        language: str | object = None,
        conn_options: APIConnectOptions = DEFAULT_API_CONNECT_OPTIONS,
    ) -> SpeechEvent:
        frame = combine_frames(buffer) if isinstance(buffer, list) else buffer

        # Encode to WAV in memory
        wav_buf = io.BytesIO()
        with wave.open(wav_buf, "wb") as wf:
            wf.setnchannels(frame.num_channels)
            wf.setsampwidth(2)  # 16-bit PCM
            wf.setframerate(frame.sample_rate)
            wf.writeframes(bytes(frame.data))
        wav_buf.seek(0)

        url = f"{self._base_url}{self._transcribe_path}"
        if self._query_params:
            qs = "&".join(f"{k}={v}" for k, v in self._query_params.items())
            url = f"{url}?{qs}" if "?" not in url else f"{url}&{qs}"
        headers: dict[str, str] = {}
        if self._auth_header:
            headers["Authorization"] = self._auth_header

        form = aiohttp.FormData()
        form.add_field("file", wav_buf, filename="audio.wav", content_type="audio/wav")
        form.add_field("model", self._model_name)
        if self._language:
            form.add_field("language", self._language)
        form.add_field("response_format", "json")
        form.add_field("stream", "false")

        session = self._get_session()
        async with session.post(url, data=form, headers=headers, timeout=aiohttp.ClientTimeout(total=60)) as resp:
            if resp.status != 200:
                err_text = await resp.text()
                raise Exception(f"STT server error {resp.status}: {err_text[:200]}")

            payload = await resp.text()
            try:
                parsed = json.loads(payload)
            except json.JSONDecodeError:
                parsed = payload

            if isinstance(parsed, dict):
                text = str(parsed.get("text") or parsed.get("transcript") or "").strip()
            elif isinstance(parsed, str):
                text = parsed.strip()
            else:
                text = ""

            if not text:
                logger.warning(
                    "STT response returned empty transcript. payload_type=%s payload_preview=%s",
                    type(parsed).__name__,
                    payload[:200],
                )

        return SpeechEvent(
            type=SpeechEventType.FINAL_TRANSCRIPT,
            request_id=str(uuid.uuid4()),
            alternatives=[
                SpeechData(
                    language=self._language or "en",
                    text=text,
                )
            ],
        )

    async def aclose(self) -> None:
        if self._session and not self._session.closed:
            await self._session.close()
