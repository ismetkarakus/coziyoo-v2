from __future__ import annotations

from livekit.plugins.openai import TTS as OpenAITTS

from .adapter import build_openai_client
from .config import TTSConfig
from .http_tts import HttpTTS


def _is_openai_compatible_tts(config: TTSConfig) -> bool:
    endpoint = (config.endpoint_path or "").strip()
    text_field = (config.text_field_name or "").strip()
    engine = (config.engine or "").strip().lower()

    endpoint_ok = endpoint in {"", "/v1/audio/speech"}
    text_field_ok = text_field in {"", "input"}
    engine_ok = engine not in {"f5-tts", "xtts", "chatterbox"}
    return endpoint_ok and text_field_ok and engine_ok


def build_tts(config: TTSConfig):
    if _is_openai_compatible_tts(config):
        client = build_openai_client(
            base_url=config.base_url,
            api_key=config.api_key or "no-key",
            extra_headers=config.custom_headers,
        )
        return OpenAITTS(
            model=config.model or "tts-1",
            voice=config.voice or "alloy",
            speed=float(config.speed or 1.0),
            client=client,
        )

    return HttpTTS(
        base_url=config.base_url,
        synth_path=config.endpoint_path or "/tts",
        auth_header=(
            config.custom_headers.get("Authorization")
            or config.custom_headers.get("authorization")
            or config.custom_headers.get("X-Custom-Auth")
        ),
        engine=config.engine,
        language=config.language,
        text_field_name=config.text_field_name or "text",
        body_params=config.custom_body_params or None,
    )
