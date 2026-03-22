from __future__ import annotations

from livekit.plugins.openai import STT as OpenAISTT

from .adapter import build_openai_client
from .config import STTConfig
from .http_stt import HttpSTT


def build_stt(config: STTConfig):
    if config.base_url:
        return HttpSTT(
            base_url=config.base_url,
            transcribe_path=config.endpoint_path or "/v1/audio/transcriptions",
            model=config.model or "whisper-1",
            language=config.language or "en",
            response_format=config.response_format or "verbose_json",
            auth_header=(
                config.custom_headers.get("Authorization")
                or config.custom_headers.get("authorization")
                or config.custom_headers.get("X-Custom-Auth")
            ),
            query_params=None,
        )

    if config.api_key:
        client = build_openai_client(
            base_url=config.base_url or "https://api.openai.com/v1",
            api_key=config.api_key,
            extra_headers=config.custom_headers,
        )
        return OpenAISTT(
            model=config.model or "whisper-1",
            language=config.language or "en",
            client=client,
        )

    return HttpSTT(
        base_url="",
        transcribe_path=config.endpoint_path or "/v1/audio/transcriptions",
        model=config.model or "whisper-1",
        language=config.language or "en",
        response_format=config.response_format or "verbose_json",
        auth_header=(
            config.custom_headers.get("Authorization")
            or config.custom_headers.get("authorization")
            or config.custom_headers.get("X-Custom-Auth")
        ),
        query_params=None,
    )
