from __future__ import annotations

import os
from dataclasses import dataclass

from dotenv import load_dotenv

load_dotenv()


@dataclass(frozen=True)
class Settings:
    livekit_url: str
    livekit_api_key: str
    livekit_api_secret: str
    ai_server_shared_secret: str
    api_base_url: str
    ai_server_host: str
    ai_server_port: int
    remote_stt_base_url: str
    remote_stt_transcribe_path: str
    remote_stt_model: str
    remote_tts_base_url: str
    remote_tts_synthesize_path: str
    ollama_base_url: str
    ollama_model: str
    openai_base_url: str | None
    openai_api_key: str | None


def get_settings() -> Settings:
    return Settings(
        livekit_url=os.getenv("LIVEKIT_URL", ""),
        livekit_api_key=os.getenv("LIVEKIT_API_KEY", ""),
        livekit_api_secret=os.getenv("LIVEKIT_API_SECRET", ""),
        ai_server_shared_secret=os.getenv("AI_SERVER_SHARED_SECRET", ""),
        api_base_url=os.getenv("API_BASE_URL", ""),
        ai_server_host=os.getenv("AI_SERVER_HOST", "0.0.0.0"),
        ai_server_port=int(os.getenv("AI_SERVER_PORT", "9000")),
        remote_stt_base_url=os.getenv("REMOTE_STT_BASE_URL", "http://127.0.0.1:7000"),
        remote_stt_transcribe_path=os.getenv("REMOTE_STT_TRANSCRIBE_PATH", "/v1/transcribe"),
        remote_stt_model=os.getenv("REMOTE_STT_MODEL", "whisper-large-v3"),
        remote_tts_base_url=os.getenv("REMOTE_TTS_BASE_URL", "http://127.0.0.1:7100"),
        remote_tts_synthesize_path=os.getenv("REMOTE_TTS_SYNTHESIZE_PATH", "/v1/synthesize"),
        ollama_base_url=os.getenv("OLLAMA_BASE_URL", "http://127.0.0.1:11434"),
        ollama_model=os.getenv("OLLAMA_MODEL", "llama3.1:8b"),
        openai_base_url=os.getenv("OPENAI_BASE_URL") or None,
        openai_api_key=os.getenv("OPENAI_API_KEY") or None,
    )
