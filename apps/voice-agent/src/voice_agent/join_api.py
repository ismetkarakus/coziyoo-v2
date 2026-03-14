from __future__ import annotations

import json
import logging
import os
from datetime import datetime, timezone
from pathlib import Path

from fastapi import FastAPI, Header, HTTPException, Query
from fastapi.responses import HTMLResponse
from livekit import api
from pydantic import BaseModel, Field

from .config.settings import get_settings

logger = logging.getLogger("coziyoo-voice-agent-join")
settings = get_settings()
# Fail fast at startup — do not serve requests with a missing or weak secret
if not settings.ai_server_shared_secret or len(settings.ai_server_shared_secret) < 16:
    raise RuntimeError(
        "AI_SERVER_SHARED_SECRET is required and must be at least 16 characters. "
        "Set it in .env or the environment before starting the join API."
    )
app = FastAPI(title="coziyoo-voice-agent-join")
request_log_file = Path(
    os.getenv("VOICE_AGENT_REQUEST_LOG_FILE", "/workspace/.runtime/voice-agent-requests.log")
)
worker_heartbeat_file = Path(
    os.getenv("VOICE_AGENT_WORKER_HEARTBEAT_FILE", "/workspace/.runtime/voice-agent-worker-heartbeat.json")
)
worker_heartbeat_stale_seconds = int(os.getenv("VOICE_AGENT_WORKER_HEARTBEAT_STALE_SECONDS", "20"))


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
async def health() -> dict:
    worker_status = {
        "running": False,
        "reason": "heartbeat_file_missing",
        "heartbeatAt": None,
        "heartbeatAgeSeconds": None,
        "staleAfterSeconds": worker_heartbeat_stale_seconds,
    }

    if worker_heartbeat_file.exists():
        try:
            raw = json.loads(worker_heartbeat_file.read_text(encoding="utf-8", errors="replace"))
            heartbeat_at = str(raw.get("heartbeatAt") or "")
            parsed = None
            if heartbeat_at:
                parsed = datetime.fromisoformat(heartbeat_at.replace("Z", "+00:00"))
            if parsed is not None and parsed.tzinfo is not None:
                age_seconds = max(0.0, (datetime.now(timezone.utc) - parsed.astimezone(timezone.utc)).total_seconds())
                is_fresh = age_seconds <= worker_heartbeat_stale_seconds
                worker_status = {
                    "running": bool(raw.get("status") == "running" and is_fresh),
                    "reason": "ok" if bool(raw.get("status") == "running" and is_fresh) else "heartbeat_stale",
                    "heartbeatAt": heartbeat_at,
                    "heartbeatAgeSeconds": round(age_seconds, 3),
                    "staleAfterSeconds": worker_heartbeat_stale_seconds,
                    "pid": raw.get("pid"),
                    "startedAt": raw.get("startedAt"),
                }
            else:
                worker_status = {
                    "running": False,
                    "reason": "heartbeat_parse_failed",
                    "heartbeatAt": heartbeat_at or None,
                    "heartbeatAgeSeconds": None,
                    "staleAfterSeconds": worker_heartbeat_stale_seconds,
                }
        except Exception:
            worker_status = {
                "running": False,
                "reason": "heartbeat_read_failed",
                "heartbeatAt": None,
                "heartbeatAgeSeconds": None,
                "staleAfterSeconds": worker_heartbeat_stale_seconds,
            }

    return {
        "status": "ok" if worker_status["running"] else "degraded",
        "joinApi": {"status": "ok"},
        "worker": worker_status,
    }


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
    kind: str = Query(default="all", pattern="^(all|stt|tts|llm|n8n|session)$"),
    q: str | None = Query(default=None, max_length=120),
) -> dict:
    if not request_log_file.exists():
        return {"data": [], "count": 0, "file": str(request_log_file), "fileStatus": "not_found"}
    items = _read_request_logs(limit=limit, kind=kind, query=q)
    file_status = "ok" if items else "empty"
    return {"data": items, "count": len(items), "file": str(request_log_file), "fileStatus": file_status}


@app.post("/logs/clear")
async def clear_request_logs() -> dict[str, bool]:
    request_log_file.parent.mkdir(parents=True, exist_ok=True)
    request_log_file.write_text("", encoding="utf-8")
    return {"ok": True}


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
    tr.child td { background: #141925; }
    tr.child td.msg { padding-left: 22px; color: #d6e2ff; }
    .tag { display: inline-block; min-width: 58px; color: #8ea1be; }
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
        <option value="n8n">n8n</option>
        <option value="session">session</option>
      </select>
    </label>
    <label>Limit <input id="limit" type="number" min="1" max="500" value="120" /></label>
    <label>Search <input id="q" type="text" placeholder="text in message" /></label>
    <button id="btn-refresh">Refresh</button>
    <button id="btn-clear" style="color:#e88">Clear logs</button>
    <label><input id="auto" type="checkbox" checked /> auto refresh (2s)</label>
  </div>
  <div class="meta" id="meta">loading...</div>
  <div id="empty-state" style="display:none; padding: 20px; color:#9aa4b2; font-size:13px;"></div>
  <table>
    <thead>
      <tr><th>timestamp</th><th>type</th><th>message</th></tr>
    </thead>
    <tbody id="rows"></tbody>
  </table>
  <script>
    const rows = document.getElementById("rows");
    const meta = document.getElementById("meta");
    const emptyState = document.getElementById("empty-state");
    const kind = document.getElementById("kind");
    const limit = document.getElementById("limit");
    const q = document.getElementById("q");
    const auto = document.getElementById("auto");
    const btnRefresh = document.getElementById("btn-refresh");
    const btnClear = document.getElementById("btn-clear");

    function typeOf(item) {
      return (item.name || "").split(".").pop() || "-";
    }

    function isRequest(item) {
      return /\\brequest\\b/i.test(item.message || "");
    }

    function isResponse(item) {
      return /\\bresponse\\b/i.test(item.message || "");
    }

    function keyOf(item) {
      return `${typeOf(item)}|${item.job_id || ""}|${item.room_id || ""}`;
    }

    function formatTime(item) {
      const ts = item.timestamp ? new Date(item.timestamp) : null;
      return ts && !Number.isNaN(ts.getTime())
        ? ts.toLocaleTimeString("en-GB", { hour12: false })
        : (item.timestamp || "");
    }

    function td(text, cls) {
      const el = document.createElement("td");
      if (cls) el.className = cls;
      el.textContent = text;
      return el;
    }

    function appendRow(item, type, message, isChild) {
      const tr = document.createElement("tr");
      if (isChild) tr.className = "child";
      tr.appendChild(td(formatTime(item)));
      tr.appendChild(td(type));
      tr.appendChild(td(message, "msg"));
      rows.appendChild(tr);
    }

    async function load() {
      const params = new URLSearchParams({
        kind: kind.value,
        limit: String(Math.max(1, Math.min(500, Number(limit.value || 120)))),
      });
      if (q.value.trim()) params.set("q", q.value.trim());
      const res = await fetch(`/logs/requests?${params.toString()}`);
      const json = await res.json();
      rows.innerHTML = "";
      emptyState.style.display = "none";

      const itemsChron = [...(json.data || [])].reverse();
      const selectedKind = kind.value;

      if (selectedKind !== "all") {
        // Keep simple request/response rendering when a single type is selected.
        const pending = [];
        for (const item of itemsChron) {
          if (isResponse(item)) {
            pending.push(item);
            continue;
          }
          if (isRequest(item)) {
            appendRow(item, typeOf(item), `request -> ${item.message || ""}`, false);
            const idx = pending.findIndex((r) => keyOf(r) === keyOf(item));
            if (idx >= 0) {
              const resp = pending.splice(idx, 1)[0];
              appendRow(resp, typeOf(resp), `response -> ${resp.message || ""}`, true);
            }
            continue;
          }
          appendRow(item, typeOf(item), item.message || "", false);
        }
      } else {
        // Group by expected stage flow: session -> stt -> n8n (or llm fallback) -> tts
        const flows = [];
        let current = null;

        function newFlow(seed) {
          return {
            key: `${seed.job_id || ""}|${seed.room_id || ""}`,
            session: [],
            sttReq: null,
            sttRes: null,
            n8nReq: null,
            n8nRes: null,
            llmReq: null,
            llmRes: null,
            ttsPairs: [],
            others: [],
            firstTs: seed.timestamp,
          };
        }

        function flushCurrent() {
          if (!current) return;
          const hasData = current.session.length || current.sttReq || current.n8nReq || current.llmReq || current.ttsPairs.length || current.others.length;
          if (hasData) flows.push(current);
        }

        for (const item of itemsChron) {
          const t = typeOf(item);
          const req = isRequest(item);
          const resp = isResponse(item);

          if (t === "stt" && req) {
            flushCurrent();
            current = newFlow(item);
            current.sttReq = item;
            continue;
          }

          if (!current) current = newFlow(item);

          if (t === "session") {
            current.session.push(item);
            continue;
          }

          if (t === "stt" && resp) {
            if (!current.sttRes) current.sttRes = item;
            else current.others.push(item);
            continue;
          }

          if (t === "n8n" && req) {
            if (!current.n8nReq) current.n8nReq = item;
            else current.others.push(item);
            continue;
          }

          if (t === "n8n" && resp) {
            if (!current.n8nRes) current.n8nRes = item;
            else current.others.push(item);
            continue;
          }

          if (t === "llm" && req) {
            if (!current.llmReq) current.llmReq = item;
            else current.others.push(item);
            continue;
          }

          if (t === "llm" && resp) {
            if (!current.llmRes) current.llmRes = item;
            else current.others.push(item);
            continue;
          }

          if (t === "tts" && req) {
            current.ttsPairs.push({ req: item, res: null });
            continue;
          }

          if (t === "tts" && resp) {
            const open = [...current.ttsPairs].reverse().find((p) => p.req && !p.res);
            if (open) open.res = item;
            else current.ttsPairs.push({ req: null, res: item });
            continue;
          }

          current.others.push(item);
        }
        flushCurrent();

        for (const flow of flows.reverse()) {
          const rootItem =
            flow.sttReq ||
            flow.n8nReq ||
            flow.llmReq ||
            (flow.ttsPairs[0] && (flow.ttsPairs[0].req || flow.ttsPairs[0].res)) ||
            flow.session[0] ||
            flow.others[0];
          if (!rootItem) continue;
          appendRow(rootItem, "flow", "stt -> n8n -> tts", false);

          for (const sessionItem of flow.session) {
            appendRow(sessionItem, "session", sessionItem.message || "", true);
          }

          if (flow.sttReq) appendRow(flow.sttReq, "stt", `request -> ${flow.sttReq.message || ""}`, true);
          if (flow.sttRes) appendRow(flow.sttRes, "stt", `response -> ${flow.sttRes.message || ""}`, true);

          if (flow.n8nReq) appendRow(flow.n8nReq, "n8n", `request -> ${flow.n8nReq.message || ""}`, true);
          if (flow.n8nRes) appendRow(flow.n8nRes, "n8n", `response -> ${flow.n8nRes.message || ""}`, true);

          if (flow.llmReq) appendRow(flow.llmReq, "llm", `request -> ${flow.llmReq.message || ""}`, true);
          if (flow.llmRes) appendRow(flow.llmRes, "llm", `response -> ${flow.llmRes.message || ""}`, true);

          for (const pair of flow.ttsPairs) {
            if (pair.req) appendRow(pair.req, "tts", `request -> ${pair.req.message || ""}`, true);
            if (pair.res) appendRow(pair.res, "tts", `response -> ${pair.res.message || ""}`, true);
          }

          for (const extra of flow.others) {
            appendRow(extra, typeOf(extra), extra.message || "", true);
          }
        }
      }
      meta.textContent = `file: ${json.file} | rows: ${json.count}`;

      if (json.fileStatus === "not_found") {
        emptyState.style.display = "block";
        emptyState.textContent = "No sessions yet — log file does not exist. Start a voice session to see data here.";
      } else if (json.count === 0) {
        emptyState.style.display = "block";
        emptyState.textContent = rows.innerHTML === "" ? "No log entries match the current filter." : "";
      }
    }

    btnRefresh.addEventListener("click", load);
    btnClear.addEventListener("click", async () => {
      if (!confirm("Clear all log entries?")) return;
      await fetch("/logs/clear", { method: "POST" });
      await load();
    });
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
