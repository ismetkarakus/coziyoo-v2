from __future__ import annotations

import json
import logging
import os
from pathlib import Path

from fastapi import FastAPI, Header, HTTPException, Query
from fastapi.responses import HTMLResponse
from livekit import api
from pydantic import BaseModel, Field

from .config.settings import get_settings

logger = logging.getLogger("coziyoo-voice-agent-join")
settings = get_settings()
app = FastAPI(title="coziyoo-voice-agent-join")
request_log_file = Path(
    os.getenv("VOICE_AGENT_REQUEST_LOG_FILE", "/workspace/.runtime/voice-agent-requests.log")
)


class JoinRequest(BaseModel):
    roomName: str = Field(min_length=1, max_length=128)
    participantIdentity: str = Field(min_length=3, max_length=128)
    metadata: str = ""
    # Fields sent by the API but not consumed by the agent dispatch (informational)
    participantName: str | None = None
    wsUrl: str | None = None
    voiceMode: str | None = None
    payload: dict | None = None


def _http_url(ws_url: str) -> str:
    if ws_url.startswith("wss://"):
        return f"https://{ws_url[len('wss://'):]}"
    if ws_url.startswith("ws://"):
        return f"http://{ws_url[len('ws://'):]}"
    return ws_url


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


def _read_request_logs(*, limit: int, kind: str, query: str | None) -> list[dict]:
    if not request_log_file.exists():
        return []

    lines = request_log_file.read_text(encoding="utf-8", errors="replace").splitlines()
    tail = lines[-min(len(lines), max(limit * 8, 200)) :]
    query_lower = (query or "").strip().lower()
    out: list[dict] = []

    for line in reversed(tail):
        try:
            item = json.loads(line)
        except json.JSONDecodeError:
            continue
        logger_name = str(item.get("name") or "")
        message = str(item.get("message") or "")

        if kind != "all" and not logger_name.endswith(f".{kind}"):
            continue
        if query_lower and query_lower not in message.lower():
            continue

        out.append(
            {
                "timestamp": item.get("timestamp"),
                "level": item.get("level"),
                "name": logger_name,
                "message": message,
                "job_id": item.get("job_id"),
                "room_id": item.get("room_id"),
            }
        )
        if len(out) >= limit:
            break

    return out


@app.get("/logs/requests")
async def request_logs(
    limit: int = Query(default=120, ge=1, le=500),
    kind: str = Query(default="all", pattern="^(all|stt|tts|llm)$"),
    q: str | None = Query(default=None, max_length=120),
) -> dict:
    items = _read_request_logs(limit=limit, kind=kind, query=q)
    return {"data": items, "count": len(items), "file": str(request_log_file)}


@app.get("/logs/viewer", response_class=HTMLResponse)
async def logs_viewer() -> str:
    return """<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Voice Agent Request Logs</title>
  <style>
    body { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; margin: 16px; background: #0f1115; color: #e6e6e6; }
    h1 { font-size: 18px; margin: 0 0 10px; }
    .controls { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 12px; }
    select, input, button { background: #1a1d24; color: #e6e6e6; border: 1px solid #333; padding: 6px 8px; border-radius: 6px; }
    button { cursor: pointer; }
    .meta { font-size: 12px; color: #9aa4b2; margin-bottom: 8px; }
    table { width: 100%; border-collapse: collapse; font-size: 12px; }
    th, td { border-bottom: 1px solid #2a2f3a; padding: 6px 4px; text-align: left; vertical-align: top; }
    th { color: #aab4c3; font-weight: 600; }
    .msg { white-space: pre-wrap; word-break: break-word; }
  </style>
</head>
<body>
  <h1>Voice Agent Request Logs</h1>
  <div class="controls">
    <label>Type
      <select id="kind">
        <option value="all">all</option>
        <option value="stt">stt</option>
        <option value="tts">tts</option>
        <option value="llm">llm</option>
      </select>
    </label>
    <label>Limit <input id="limit" type="number" min="1" max="500" value="120" /></label>
    <label>Search <input id="q" type="text" placeholder="text in message" /></label>
    <button id="refresh">Refresh</button>
    <label><input id="auto" type="checkbox" checked /> auto refresh (2s)</label>
  </div>
  <div class="meta" id="meta">loading...</div>
  <table>
    <thead>
      <tr><th>timestamp</th><th>type</th><th>message</th></tr>
    </thead>
    <tbody id="rows"></tbody>
  </table>
  <script>
    const rows = document.getElementById("rows");
    const meta = document.getElementById("meta");
    const kind = document.getElementById("kind");
    const limit = document.getElementById("limit");
    const q = document.getElementById("q");
    const auto = document.getElementById("auto");
    const refresh = document.getElementById("refresh");

    async function load() {
      const params = new URLSearchParams({
        kind: kind.value,
        limit: String(Math.max(1, Math.min(500, Number(limit.value || 120)))),
      });
      if (q.value.trim()) params.set("q", q.value.trim());
      const res = await fetch(`/logs/requests?${params.toString()}`);
      const json = await res.json();
      rows.innerHTML = "";
      for (const item of (json.data || [])) {
        const tr = document.createElement("tr");
        const type = (item.name || "").split(".").pop() || "-";
        tr.innerHTML = `<td>${item.timestamp || ""}</td><td>${type}</td><td class="msg">${item.message || ""}</td>`;
        rows.appendChild(tr);
      }
      meta.textContent = `file: ${json.file} | rows: ${json.count}`;
    }

    refresh.addEventListener("click", load);
    kind.addEventListener("change", load);
    limit.addEventListener("change", load);
    q.addEventListener("keydown", (e) => { if (e.key === "Enter") load(); });

    setInterval(() => { if (auto.checked) load(); }, 2000);
    load();
  </script>
</body>
</html>"""


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
