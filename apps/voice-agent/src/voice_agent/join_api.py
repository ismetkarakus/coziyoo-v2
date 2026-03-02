from __future__ import annotations

import logging
from typing import Any

from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel, Field

from .config.settings import get_settings

logger = logging.getLogger("coziyoo-voice-agent-join")
settings = get_settings()
app = FastAPI(title="coziyoo-voice-agent-join")


class JoinRequest(BaseModel):
    roomName: str = Field(min_length=1, max_length=128)
    participantIdentity: str = Field(min_length=3, max_length=128)
    participantName: str = Field(min_length=1, max_length=128)
    wsUrl: str
    token: str
    metadata: str
    voiceMode: str | None = None
    payload: dict[str, Any] | None = None


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/livekit/agent-session")
async def join_agent_session(
    body: JoinRequest,
    x_ai_server_secret: str | None = Header(default=None),
) -> dict[str, Any]:
    if not settings.ai_server_shared_secret:
        raise HTTPException(status_code=503, detail="AI_SERVER_SHARED_SECRET missing")

    if x_ai_server_secret != settings.ai_server_shared_secret:
        raise HTTPException(status_code=401, detail="invalid shared secret")

    # This endpoint is the control-plane handshake for API dispatch.
    # In this scaffold stage it acknowledges and logs payload, while worker process joins rooms.
    logger.info(
        "dispatch accepted room=%s identity=%s mode=%s",
        body.roomName,
        body.participantIdentity,
        body.voiceMode,
    )

    return {
      "ok": True,
      "accepted": True,
      "roomName": body.roomName,
      "participantIdentity": body.participantIdentity,
      "message": "dispatch accepted"
    }
