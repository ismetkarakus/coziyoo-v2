from __future__ import annotations

import logging

from fastapi import FastAPI, Header, HTTPException
from livekit import api
from pydantic import BaseModel, Field

from .config.settings import get_settings

logger = logging.getLogger("coziyoo-voice-agent-join")
settings = get_settings()
app = FastAPI(title="coziyoo-voice-agent-join")


class JoinRequest(BaseModel):
    roomName: str = Field(min_length=1, max_length=128)
    participantIdentity: str = Field(min_length=3, max_length=128)
    metadata: str = ""


def _http_url(ws_url: str) -> str:
    if ws_url.startswith("wss://"):
        return f"https://{ws_url[len('wss://'):]}"
    if ws_url.startswith("ws://"):
        return f"http://{ws_url[len('ws://'):]}"
    return ws_url


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/livekit/agent-session")
async def join_agent_session(
    body: JoinRequest,
    x_ai_server_secret: str | None = Header(default=None),
) -> dict:
    if not settings.ai_server_shared_secret:
        raise HTTPException(status_code=503, detail="AI_SERVER_SHARED_SECRET missing")
    if x_ai_server_secret != settings.ai_server_shared_secret:
        raise HTTPException(status_code=401, detail="invalid shared secret")

    async with api.LiveKitAPI(
        url=_http_url(settings.livekit_url),
        api_key=settings.livekit_api_key,
        api_secret=settings.livekit_api_secret,
    ) as lkapi:
        dispatch = await lkapi.agent_dispatch.create_dispatch(
            api.CreateAgentDispatchRequest(
                agent_name="coziyoo-voice-agent",
                room=body.roomName,
                metadata=body.metadata,
            )
        )

    logger.info("dispatched agent room=%s dispatch_id=%s", body.roomName, dispatch.id)
    return {"ok": True, "dispatchId": dispatch.id, "roomName": body.roomName}
