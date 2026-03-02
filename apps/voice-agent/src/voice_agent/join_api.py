from __future__ import annotations

import logging
from typing import Any

from fastapi import FastAPI, Header, HTTPException

from .config.settings import get_settings
from .dispatch.manager import DispatchManager
from .dispatch.models import DispatchStatus, JoinTaskPayload

logger = logging.getLogger("coziyoo-voice-agent-join")
settings = get_settings()
app = FastAPI(title="coziyoo-voice-agent-join")
manager = DispatchManager(worker_count=2)


@app.on_event("startup")
async def on_startup() -> None:
    await manager.start()


@app.on_event("shutdown")
async def on_shutdown() -> None:
    await manager.stop()


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/livekit/agent-session")
async def join_agent_session(
    body: JoinTaskPayload,
    x_ai_server_secret: str | None = Header(default=None),
) -> dict[str, Any]:
    if not settings.ai_server_shared_secret:
        raise HTTPException(status_code=503, detail="AI_SERVER_SHARED_SECRET missing")

    if x_ai_server_secret != settings.ai_server_shared_secret:
        raise HTTPException(status_code=401, detail="invalid shared secret")

    task = await manager.enqueue(body)
    logger.info(
        "dispatch queued taskId=%s room=%s identity=%s",
        task.id,
        body.roomName,
        body.participantIdentity,
    )

    return {
        "ok": True,
        "accepted": True,
        "taskId": task.id,
        "status": task.status,
        "roomName": body.roomName,
        "participantIdentity": body.participantIdentity,
        "message": "dispatch queued",
    }


@app.get("/livekit/agent-session/{task_id}")
async def get_dispatch_status(task_id: str) -> dict[str, Any]:
    task = manager.get(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="task not found")

    status = task.status
    http_status = 200 if status in (DispatchStatus.queued, DispatchStatus.processing, DispatchStatus.completed) else 500
    return {
        "ok": status != DispatchStatus.failed,
        "statusCode": http_status,
        "task": task.model_dump(),
    }
