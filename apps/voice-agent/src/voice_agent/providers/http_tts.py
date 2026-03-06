"""HTTP-based TTS adapter for remote TTS servers (f5-tts, xtts, chatterbox).

Sends POST {baseUrl}{synthPath} with JSON body {"text": "..."} and receives
audio bytes (WAV) in the response.
"""

from __future__ import annotations

import io
import logging
import struct
import uuid
import wave

import aiohttp
from livekit import rtc
from livekit.agents.tts import ChunkedStream, SynthesizedAudio, TTS, TTSCapabilities
from livekit.agents.types import DEFAULT_API_CONNECT_OPTIONS, APIConnectOptions

logger = logging.getLogger("coziyoo-voice-agent.http-tts")

DEFAULT_SAMPLE_RATE = 24000
DEFAULT_NUM_CHANNELS = 1


class HttpTTS(TTS):
    def __init__(
        self,
        *,
        base_url: str,
        synth_path: str = "/tts",
        auth_header: str | None = None,
        engine: str = "f5-tts",
        language: str = "en",
        text_field_name: str = "text",
        body_params: dict | None = None,
        query_params: dict | None = None,
        sample_rate: int = DEFAULT_SAMPLE_RATE,
        num_channels: int = DEFAULT_NUM_CHANNELS,
    ) -> None:
        super().__init__(
            capabilities=TTSCapabilities(streaming=False),
            sample_rate=sample_rate,
            num_channels=num_channels,
        )
        self._base_url = base_url.rstrip("/")
        self._synth_path = synth_path
        self._auth_header = auth_header
        self._engine = engine
        self._language = language
        self._text_field_name = text_field_name
        self._body_params = body_params
        self._query_params = query_params
        self._session: aiohttp.ClientSession | None = None

    @property
    def model(self) -> str:
        return self._engine

    @property
    def provider(self) -> str:
        return "http-tts"

    def _get_session(self) -> aiohttp.ClientSession:
        if self._session is None or self._session.closed:
            self._session = aiohttp.ClientSession()
        return self._session

    def synthesize(
        self, text: str, *, conn_options: APIConnectOptions = DEFAULT_API_CONNECT_OPTIONS
    ) -> ChunkedStream:
        return HttpTTSChunkedStream(tts=self, input_text=text, conn_options=conn_options)

    async def aclose(self) -> None:
        if self._session and not self._session.closed:
            await self._session.close()


class HttpTTSChunkedStream(ChunkedStream):
    def __init__(
        self,
        *,
        tts: HttpTTS,
        input_text: str,
        conn_options: APIConnectOptions,
    ) -> None:
        super().__init__(tts=tts, input_text=input_text, conn_options=conn_options)
        self._tts = tts

    async def _main_task(self) -> None:
        request_id = str(uuid.uuid4())
        url = f"{self._tts._base_url}{self._tts._synth_path}"
        if self._tts._query_params:
            qs = "&".join(f"{k}={v}" for k, v in self._tts._query_params.items())
            url = f"{url}?{qs}" if "?" not in url else f"{url}&{qs}"

        headers: dict[str, str] = {"Content-Type": "application/json"}
        if self._tts._auth_header:
            headers["Authorization"] = self._tts._auth_header

        body = {**(self._tts._body_params or {}), self._tts._text_field_name: self._input_text}
        if self._tts._language:
            body["language"] = self._tts._language

        session = self._tts._get_session()
        try:
            async with session.post(url, json=body, headers=headers, timeout=aiohttp.ClientTimeout(total=30)) as resp:
                if resp.status != 200:
                    err_text = await resp.text()
                    raise Exception(f"TTS server error {resp.status}: {err_text[:200]}")

                audio_bytes = await resp.read()
                frame = _decode_audio(audio_bytes, self._tts._sample_rate, self._tts._num_channels)

                self._event_ch.send_nowait(
                    SynthesizedAudio(
                        frame=frame,
                        request_id=request_id,
                        is_final=True,
                    )
                )
        except Exception:
            logger.exception("TTS synthesis failed for url=%s", url)
            raise


def _decode_audio(data: bytes, fallback_sample_rate: int, fallback_channels: int) -> rtc.AudioFrame:
    """Decode WAV bytes into an AudioFrame. Falls back to raw PCM if WAV parsing fails."""
    try:
        with wave.open(io.BytesIO(data), "rb") as wf:
            sample_rate = wf.getframerate()
            num_channels = wf.getnchannels()
            sample_width = wf.getsampwidth()
            raw = wf.readframes(wf.getnframes())
            # Convert to 16-bit PCM if needed
            if sample_width == 1:
                samples = struct.unpack(f"<{len(raw)}B", raw)
                raw = struct.pack(f"<{len(samples)}h", *((s - 128) << 8 for s in samples))
            elif sample_width == 4:
                samples = struct.unpack(f"<{len(raw) // 4}i", raw)
                raw = struct.pack(f"<{len(samples)}h", *(s >> 16 for s in samples))
            samples_per_channel = len(raw) // (2 * num_channels)
            return rtc.AudioFrame(
                data=raw,
                sample_rate=sample_rate,
                num_channels=num_channels,
                samples_per_channel=samples_per_channel,
            )
    except Exception:
        # Assume raw 16-bit PCM
        samples_per_channel = len(data) // (2 * fallback_channels)
        return rtc.AudioFrame(
            data=data,
            sample_rate=fallback_sample_rate,
            num_channels=fallback_channels,
            samples_per_channel=samples_per_channel,
        )
