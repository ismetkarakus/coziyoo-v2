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


def get_settings() -> Settings:
    return Settings(
        livekit_url=os.getenv("LIVEKIT_URL", ""),
        livekit_api_key=os.getenv("LIVEKIT_API_KEY", ""),
        livekit_api_secret=os.getenv("LIVEKIT_API_SECRET", ""),
        ai_server_shared_secret=os.getenv("AI_SERVER_SHARED_SECRET", ""),
        api_base_url=os.getenv("API_BASE_URL", "https://api.coziyoo.com"),
        ai_server_host=os.getenv("AI_SERVER_HOST", "0.0.0.0"),
        ai_server_port=int(os.getenv("AI_SERVER_PORT", "9000")),
    )
