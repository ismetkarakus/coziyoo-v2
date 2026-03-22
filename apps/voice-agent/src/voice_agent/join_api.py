from __future__ import annotations

import asyncio
import base64
import json
import logging
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import FastAPI, Header, HTTPException, Query, Request
from fastapi.responses import HTMLResponse, RedirectResponse, StreamingResponse
from fastapi.templating import Jinja2Templates
from livekit import api
from pydantic import BaseModel, Field

from .config.settings import get_settings
from .curl_parser import parse_curl_command
from .dashboard_api import api_binary_request, api_request
from .dashboard_auth import (
    clear_auth_cookies,
    ensure_access_token,
    extract_error_message,
    set_auth_cookies,
)
from .dashboard_forms import normalize_profile_payload

logger = logging.getLogger("coziyoo-voice-agent-join")
settings = get_settings()
# Fail fast at startup — do not serve requests with a missing or weak secret
if not settings.ai_server_shared_secret or len(settings.ai_server_shared_secret) < 16:
    raise RuntimeError(
        "AI_SERVER_SHARED_SECRET is required and must be at least 16 characters. "
        "Set it in .env or the environment before starting the join API."
    )
app = FastAPI(title="coziyoo-voice-agent-join")
templates = Jinja2Templates(directory=str(Path(__file__).parent / "templates"))
request_log_file = Path(
    os.getenv("VOICE_AGENT_REQUEST_LOG_FILE", "/workspace/.runtime/voice-agent-requests.log")
)
worker_heartbeat_file = Path(
    os.getenv("VOICE_AGENT_WORKER_HEARTBEAT_FILE", "/workspace/.runtime/voice-agent-worker-heartbeat.json")
)
worker_heartbeat_stale_seconds = int(os.getenv("VOICE_AGENT_WORKER_HEARTBEAT_STALE_SECONDS", "20"))


async def _fetch_profiles(access_token: str) -> tuple[list[dict[str, Any]], str | None]:
    status, payload = await api_request(
        api_base_url=settings.api_base_url,
        method="GET",
        path="/v1/admin/agent-profiles",
        access_token=access_token,
    )
    if status != 200 or not isinstance(payload, dict):
        return [], extract_error_message(payload, "Failed to load profiles")
    rows = payload.get("data")
    if not isinstance(rows, list):
        return [], "Invalid profile list response"
    return [row for row in rows if isinstance(row, dict)], None


async def _render_sidebar(request: Request, access_token: str, message: str | None = None) -> HTMLResponse:
    profiles, error_message = await _fetch_profiles(access_token)
    return templates.TemplateResponse(
        request=request,
        name="profiles/_sidebar.html",
        context={"profiles": profiles, "message": message or error_message},
    )


def _dict(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _string_map(value: Any) -> dict[str, str]:
    if not isinstance(value, dict):
        return {}
    mapped: dict[str, str] = {}
    for key, item in value.items():
        if isinstance(key, str):
            mapped[key] = str(item)
    return mapped


def _status_response(
    request: Request,
    *,
    state: str,
    title: str,
    message: str,
    details: str | None = None,
    transcript: str | None = None,
    audio_data_uri: str | None = None,
) -> HTMLResponse:
    return templates.TemplateResponse(
        request=request,
        name="profiles/_status.html",
        context={
            "state": state,
            "title": title,
            "message": message,
            "details": details,
            "transcript": transcript,
            "audio_data_uri": audio_data_uri,
        },
    )


def _profile_update_payload(profile: dict[str, Any]) -> dict[str, Any]:
    return {
        "name": str(profile.get("name") or ""),
        "speaks_first": bool(profile.get("speaks_first")),
        "system_prompt": str(profile.get("system_prompt") or ""),
        "greeting_enabled": bool(profile.get("greeting_enabled", True)),
        "greeting_instruction": str(profile.get("greeting_instruction") or ""),
        "voice_language": str(profile.get("voice_language") or "tr"),
        "llm_config": _dict(profile.get("llm_config")),
        "tts_config": _dict(profile.get("tts_config")),
        "stt_config": _dict(profile.get("stt_config")),
        "n8n_config": _dict(profile.get("n8n_config")),
    }


@app.get("/dashboard/login", response_class=HTMLResponse)
async def dashboard_login_page(request: Request) -> HTMLResponse:
    return templates.TemplateResponse(request=request, name="login.html", context={"error": None})


@app.post("/dashboard/login")
async def dashboard_login(request: Request):
    form = await request.form()
    email = str(form.get("email") or "").strip().lower()
    password = str(form.get("password") or "")

    status, payload = await api_request(
        api_base_url=settings.api_base_url,
        method="POST",
        path="/v1/admin/auth/login",
        access_token=None,
        json_body={"email": email, "password": password},
    )

    if status != 200 or not isinstance(payload, dict):
        message = extract_error_message(payload, "Login failed")
        return templates.TemplateResponse(request=request, name="login.html", context={"error": message}, status_code=401)

    data = payload.get("data") if isinstance(payload, dict) else None
    tokens = data.get("tokens") if isinstance(data, dict) else None
    access = tokens.get("accessToken") if isinstance(tokens, dict) else None
    refresh = tokens.get("refreshToken") if isinstance(tokens, dict) else None
    if not isinstance(access, str) or not isinstance(refresh, str):
        return templates.TemplateResponse(
            request=request,
            name="login.html",
            context={"error": "Login response did not include tokens"},
            status_code=502,
        )

    response = RedirectResponse(url="/dashboard/profiles", status_code=303)
    set_auth_cookies(response, access, refresh)
    return response


@app.post("/dashboard/logout")
async def dashboard_logout(request: Request):
    access_token, refresh_response = await ensure_access_token(request=request, api_base_url=settings.api_base_url)
    if refresh_response is not None:
        return refresh_response
    await api_request(
        api_base_url=settings.api_base_url,
        method="POST",
        path="/v1/admin/auth/logout",
        access_token=access_token,
        json_body={},
    )
    response = RedirectResponse(url="/dashboard/login", status_code=303)
    clear_auth_cookies(response)
    return response


@app.get("/dashboard/profiles", response_class=HTMLResponse)
async def dashboard_profiles(request: Request):
    access_token, refresh_response = await ensure_access_token(request=request, api_base_url=settings.api_base_url)
    if refresh_response is not None:
        return refresh_response
    profiles, error_message = await _fetch_profiles(access_token)
    return templates.TemplateResponse(
        request=request,
        name="profiles/index.html",
        context={"profiles": profiles, "message": error_message},
    )


@app.post("/dashboard/profiles", response_class=HTMLResponse)
async def dashboard_create_profile(request: Request):
    access_token, refresh_response = await ensure_access_token(request=request, api_base_url=settings.api_base_url)
    if refresh_response is not None:
        return refresh_response
    form = await request.form()
    name = str(form.get("name") or "").strip()
    message = None
    if not name:
        message = "Profile name is required"
    else:
        status, payload = await api_request(
            api_base_url=settings.api_base_url,
            method="POST",
            path="/v1/admin/agent-profiles",
            access_token=access_token,
            json_body={"name": name},
        )
        if status not in {200, 201}:
            message = extract_error_message(payload, "Profile create failed")
    return await _render_sidebar(request, access_token, message)


@app.post("/dashboard/profiles/{profile_id}/activate", response_class=HTMLResponse)
async def dashboard_activate_profile(request: Request, profile_id: str):
    access_token, refresh_response = await ensure_access_token(request=request, api_base_url=settings.api_base_url)
    if refresh_response is not None:
        return refresh_response
    status, payload = await api_request(
        api_base_url=settings.api_base_url,
        method="POST",
        path=f"/v1/admin/agent-profiles/{profile_id}/activate",
        access_token=access_token,
        json_body={},
    )
    message = None if status == 200 else extract_error_message(payload, "Activation failed")
    return await _render_sidebar(request, access_token, message)


@app.post("/dashboard/profiles/{profile_id}/duplicate", response_class=HTMLResponse)
async def dashboard_duplicate_profile(request: Request, profile_id: str):
    access_token, refresh_response = await ensure_access_token(request=request, api_base_url=settings.api_base_url)
    if refresh_response is not None:
        return refresh_response
    status, payload = await api_request(
        api_base_url=settings.api_base_url,
        method="POST",
        path=f"/v1/admin/agent-profiles/{profile_id}/duplicate",
        access_token=access_token,
        json_body={},
    )
    message = None if status in {200, 201} else extract_error_message(payload, "Duplicate failed")
    return await _render_sidebar(request, access_token, message)


@app.post("/dashboard/profiles/{profile_id}/delete", response_class=HTMLResponse)
async def dashboard_delete_profile(request: Request, profile_id: str):
    access_token, refresh_response = await ensure_access_token(request=request, api_base_url=settings.api_base_url)
    if refresh_response is not None:
        return refresh_response
    status, payload = await api_request(
        api_base_url=settings.api_base_url,
        method="DELETE",
        path=f"/v1/admin/agent-profiles/{profile_id}",
        access_token=access_token,
    )
    message = None
    if status == 409:
        message = extract_error_message(payload, "CANNOT_DELETE_ACTIVE")
    elif status != 200:
        message = extract_error_message(payload, "Delete failed")
    return await _render_sidebar(request, access_token, message)


@app.get("/dashboard/profiles/{profile_id}", response_class=HTMLResponse)
async def dashboard_profile_editor(request: Request, profile_id: str):
    access_token, refresh_response = await ensure_access_token(request=request, api_base_url=settings.api_base_url)
    if refresh_response is not None:
        return refresh_response
    status, payload = await api_request(
        api_base_url=settings.api_base_url,
        method="GET",
        path=f"/v1/admin/agent-profiles/{profile_id}",
        access_token=access_token,
    )
    if status != 200 or not isinstance(payload, dict):
        message = extract_error_message(payload, "Failed to load profile")
        return templates.TemplateResponse(
            request=request,
            name="profiles/_editor_panel.html",
            context={"profile": None, "message": message},
            status_code=404 if status == 404 else 502,
        )
    profile = payload.get("data") if isinstance(payload.get("data"), dict) else None
    return templates.TemplateResponse(
        request=request,
        name="profiles/_editor_panel.html",
        context={"profile": profile, "message": None},
    )


@app.post("/dashboard/profiles/{profile_id}/save", response_class=HTMLResponse)
async def dashboard_profile_save(request: Request, profile_id: str):
    access_token, refresh_response = await ensure_access_token(request=request, api_base_url=settings.api_base_url)
    if refresh_response is not None:
        return refresh_response
    form = await request.form()
    payload = normalize_profile_payload({k: str(v) for k, v in form.items()})
    status, update_payload = await api_request(
        api_base_url=settings.api_base_url,
        method="PUT",
        path=f"/v1/admin/agent-profiles/{profile_id}",
        access_token=access_token,
        json_body=payload,
    )
    message = None if status == 200 else extract_error_message(update_payload, "Profile save failed")

    current_status, current_payload = await api_request(
        api_base_url=settings.api_base_url,
        method="GET",
        path=f"/v1/admin/agent-profiles/{profile_id}",
        access_token=access_token,
    )
    profile = current_payload.get("data") if current_status == 200 and isinstance(current_payload, dict) else None
    return templates.TemplateResponse(
        request=request,
        name="profiles/_editor_panel.html",
        context={"profile": profile, "message": message or "Saved"},
        status_code=200 if profile else 502,
    )


@app.post("/dashboard/test/llm", response_class=HTMLResponse)
async def dashboard_test_llm(request: Request):
    access_token, refresh_response = await ensure_access_token(request=request, api_base_url=settings.api_base_url)
    if refresh_response is not None:
        return refresh_response

    form = await request.form()
    normalized = normalize_profile_payload({k: str(v) for k, v in form.items()})
    llm_cfg = _dict(normalized.get("llm_config"))

    status, payload = await api_request(
        api_base_url=settings.api_base_url,
        method="POST",
        path="/v1/admin/livekit/test/llm",
        access_token=access_token,
        json_body={
            "baseUrl": str(llm_cfg.get("base_url") or ""),
            "endpointPath": str(llm_cfg.get("endpoint_path") or "/v1/chat/completions"),
            "apiKey": str(llm_cfg.get("api_key") or ""),
            "model": str(llm_cfg.get("model") or ""),
            "customHeaders": _string_map(llm_cfg.get("custom_headers")),
            "customBodyParams": _string_map(llm_cfg.get("custom_body_params")),
            "prompt": str(form.get("llm_test_prompt") or "Say hello in one short sentence."),
        },
    )
    data = payload.get("data") if isinstance(payload, dict) and isinstance(payload.get("data"), dict) else {}
    ok = status == 200 and bool(data.get("ok"))
    if ok:
        return _status_response(
            request,
            state="success",
            title="LLM test successful",
            message=f"Provider responded with status {data.get('status', 200)}.",
        )
    return _status_response(
        request,
        state="error",
        title="LLM test failed",
        message=extract_error_message(payload, "LLM request failed"),
        details=str(_dict(payload.get("error")).get("details") or ""),
    )


@app.post("/dashboard/test/tts", response_class=HTMLResponse)
async def dashboard_test_tts(request: Request):
    access_token, refresh_response = await ensure_access_token(request=request, api_base_url=settings.api_base_url)
    if refresh_response is not None:
        return refresh_response

    form = await request.form()
    normalized = normalize_profile_payload({k: str(v) for k, v in form.items()})
    tts_cfg = _dict(normalized.get("tts_config"))
    custom_headers = _string_map(tts_cfg.get("custom_headers"))
    auth_header = custom_headers.get("authorization", "").strip()
    if not auth_header and str(tts_cfg.get("api_key") or "").strip():
        auth_header = f"Bearer {str(tts_cfg.get('api_key')).strip()}"

    status, data, content_type = await api_binary_request(
        api_base_url=settings.api_base_url,
        method="POST",
        path="/v1/admin/livekit/test/tts",
        access_token=access_token,
        json_body={
            "text": str(form.get("tts_test_text") or "Merhaba, bu bir test mesajidir."),
            "baseUrl": str(tts_cfg.get("base_url") or ""),
            "synthPath": str(tts_cfg.get("endpoint_path") or "/v1/audio/speech"),
            "textFieldName": str(tts_cfg.get("text_field_name") or "input"),
            "bodyParams": _string_map(tts_cfg.get("custom_body_params")),
            "authHeader": auth_header,
        },
    )

    if status == 200 and data:
        ctype = content_type if content_type.startswith("audio/") else "audio/mpeg"
        encoded = base64.b64encode(data).decode("ascii")
        return _status_response(
            request,
            state="success",
            title="TTS test successful",
            message="Audio generated successfully.",
            audio_data_uri=f"data:{ctype};base64,{encoded}",
        )

    details = data.decode("utf-8", errors="replace")[:240] if data else ""
    return _status_response(
        request,
        state="error",
        title="TTS test failed",
        message=f"Upstream responded with status {status}.",
        details=details,
    )


@app.post("/dashboard/test/stt", response_class=HTMLResponse)
async def dashboard_test_stt(request: Request):
    access_token, refresh_response = await ensure_access_token(request=request, api_base_url=settings.api_base_url)
    if refresh_response is not None:
        return refresh_response

    form = await request.form()
    normalized = normalize_profile_payload({k: str(v) for k, v in form.items()})
    stt_cfg = _dict(normalized.get("stt_config"))
    status, payload = await api_request(
        api_base_url=settings.api_base_url,
        method="POST",
        path="/v1/admin/livekit/test/stt",
        access_token=access_token,
        json_body={
            "baseUrl": str(stt_cfg.get("base_url") or ""),
            "transcribePath": str(stt_cfg.get("endpoint_path") or "/v1/audio/transcriptions"),
        },
    )
    data = payload.get("data") if isinstance(payload, dict) and isinstance(payload.get("data"), dict) else {}
    if status == 200 and bool(data.get("ok")):
        return _status_response(
            request,
            state="success",
            title="STT connectivity successful",
            message=f"Provider reachable at status {data.get('status', 200)}.",
        )
    return _status_response(
        request,
        state="error",
        title="STT connectivity failed",
        message=extract_error_message(payload, "STT endpoint unreachable"),
        details=str(data.get("reason") or ""),
    )


@app.post("/dashboard/test/stt/transcribe", response_class=HTMLResponse)
async def dashboard_test_stt_transcribe(request: Request):
    access_token, refresh_response = await ensure_access_token(request=request, api_base_url=settings.api_base_url)
    if refresh_response is not None:
        return refresh_response

    form = await request.form()
    normalized = normalize_profile_payload({k: str(v) for k, v in form.items()})
    stt_cfg = _dict(normalized.get("stt_config"))
    custom_headers = _string_map(stt_cfg.get("custom_headers"))
    auth_header = custom_headers.get("authorization", "").strip()
    if not auth_header and str(stt_cfg.get("api_key") or "").strip():
        auth_header = str(stt_cfg.get("api_key")).strip()

    audio_base64 = str(form.get("stt_audio_base64") or "").strip()
    if not audio_base64:
        return _status_response(
            request,
            state="error",
            title="STT test failed",
            message="No recording captured. Start and stop recording first.",
        )

    status, payload = await api_request(
        api_base_url=settings.api_base_url,
        method="POST",
        path="/v1/admin/livekit/test/stt/transcribe",
        access_token=access_token,
        json_body={
            "baseUrl": str(stt_cfg.get("base_url") or ""),
            "transcribePath": str(stt_cfg.get("endpoint_path") or "/v1/audio/transcriptions"),
            "model": str(stt_cfg.get("model") or ""),
            "queryParams": _string_map(stt_cfg.get("custom_query_params")),
            "authHeader": auth_header,
            "audioBase64": audio_base64,
            "mimeType": str(form.get("stt_audio_mime") or "audio/webm"),
            "filename": str(form.get("stt_audio_filename") or "recording.webm"),
        },
    )
    data = payload.get("data") if isinstance(payload, dict) and isinstance(payload.get("data"), dict) else {}
    ok = status == 200 and bool(data.get("ok"))
    if ok:
        transcript = str(data.get("transcript") or "").strip() or "(no text returned)"
        return _status_response(
            request,
            state="success",
            title="STT transcription successful",
            message="Audio transcribed successfully.",
            transcript=transcript,
        )
    return _status_response(
        request,
        state="error",
        title="STT transcription failed",
        message=extract_error_message(payload, "STT transcription failed"),
        details=str(data.get("reason") or data.get("rawText") or ""),
    )


@app.post("/dashboard/test/n8n", response_class=HTMLResponse)
async def dashboard_test_n8n(request: Request):
    access_token, refresh_response = await ensure_access_token(request=request, api_base_url=settings.api_base_url)
    if refresh_response is not None:
        return refresh_response

    form = await request.form()
    normalized = normalize_profile_payload({k: str(v) for k, v in form.items()})
    n8n_cfg = _dict(normalized.get("n8n_config"))
    status, payload = await api_request(
        api_base_url=settings.api_base_url,
        method="POST",
        path="/v1/admin/livekit/test/n8n",
        access_token=access_token,
        json_body={"baseUrl": str(n8n_cfg.get("base_url") or "")},
    )
    data = payload.get("data") if isinstance(payload, dict) and isinstance(payload.get("data"), dict) else {}
    if status == 200 and bool(data.get("ok")):
        return _status_response(
            request,
            state="success",
            title="N8N test successful",
            message="Workflow health checks passed.",
        )
    return _status_response(
        request,
        state="error",
        title="N8N test failed",
        message=extract_error_message(payload, "N8N check failed"),
        details=str(data.get("reason") or ""),
    )


@app.post("/dashboard/profiles/{profile_id}/import-curl", response_class=HTMLResponse)
async def dashboard_import_curl(request: Request, profile_id: str):
    access_token, refresh_response = await ensure_access_token(request=request, api_base_url=settings.api_base_url)
    if refresh_response is not None:
        return refresh_response

    form = await request.form()
    raw_curl = str(form.get("import_curl_raw") or "").strip()
    parsed = parse_curl_command(raw_curl)
    if not parsed:
        status, payload = await api_request(
            api_base_url=settings.api_base_url,
            method="GET",
            path=f"/v1/admin/agent-profiles/{profile_id}",
            access_token=access_token,
        )
        profile = payload.get("data") if status == 200 and isinstance(payload, dict) else None
        return templates.TemplateResponse(
            request=request,
            name="profiles/_editor_panel.html",
            context={"profile": profile, "message": "Could not parse cURL command"},
            status_code=400,
        )

    get_status, get_payload = await api_request(
        api_base_url=settings.api_base_url,
        method="GET",
        path=f"/v1/admin/agent-profiles/{profile_id}",
        access_token=access_token,
    )
    if get_status != 200 or not isinstance(get_payload, dict):
        return templates.TemplateResponse(
            request=request,
            name="profiles/_editor_panel.html",
            context={"profile": None, "message": extract_error_message(get_payload, "Failed to load profile")},
            status_code=502,
        )
    profile = get_payload.get("data") if isinstance(get_payload.get("data"), dict) else None
    if not isinstance(profile, dict):
        return templates.TemplateResponse(
            request=request,
            name="profiles/_editor_panel.html",
            context={"profile": None, "message": "Profile response format invalid"},
            status_code=502,
        )

    update_payload = _profile_update_payload(profile)
    fingerprint = f"{str(parsed.get('base_url') or '')} {str(parsed.get('endpoint_path') or '')}".lower()
    section = "llm_config"
    if "webhook" in fingerprint or "n8n" in fingerprint:
        section = "n8n_config"
    elif "transcri" in fingerprint:
        section = "stt_config"
    elif "speech" in fingerprint or "audio" in fingerprint:
        section = "tts_config"

    custom_headers = _string_map(parsed.get("custom_headers"))
    custom_body_params = _string_map(parsed.get("custom_body_params"))

    if section == "n8n_config":
        cfg = _dict(update_payload.get("n8n_config"))
        cfg["base_url"] = str(parsed.get("base_url") or cfg.get("base_url") or "")
        cfg["webhook_path"] = str(parsed.get("endpoint_path") or cfg.get("webhook_path") or "")
        update_payload["n8n_config"] = cfg
    elif section == "stt_config":
        cfg = _dict(update_payload.get("stt_config"))
        cfg["base_url"] = str(parsed.get("base_url") or cfg.get("base_url") or "")
        cfg["api_key"] = str(parsed.get("api_key") or cfg.get("api_key") or "")
        cfg["model"] = str(parsed.get("model") or cfg.get("model") or "")
        cfg["endpoint_path"] = str(parsed.get("endpoint_path") or cfg.get("endpoint_path") or "/v1/audio/transcriptions")
        if custom_headers:
            cfg["custom_headers"] = custom_headers
        if custom_body_params:
            cfg["custom_body_params"] = custom_body_params
        if parsed.get("text_field_name"):
            cfg["text_field_name"] = str(parsed.get("text_field_name"))
        update_payload["stt_config"] = cfg
    elif section == "tts_config":
        cfg = _dict(update_payload.get("tts_config"))
        cfg["base_url"] = str(parsed.get("base_url") or cfg.get("base_url") or "")
        cfg["api_key"] = str(parsed.get("api_key") or cfg.get("api_key") or "")
        cfg["model"] = str(parsed.get("model") or cfg.get("model") or "")
        cfg["endpoint_path"] = str(parsed.get("endpoint_path") or cfg.get("endpoint_path") or "/v1/audio/speech")
        cfg["voice_id"] = str(parsed.get("voice_id") or cfg.get("voice_id") or "")
        cfg["text_field_name"] = str(parsed.get("text_field_name") or cfg.get("text_field_name") or "input")
        if custom_headers:
            cfg["custom_headers"] = custom_headers
        if custom_body_params:
            cfg["custom_body_params"] = custom_body_params
        update_payload["tts_config"] = cfg
    else:
        cfg = _dict(update_payload.get("llm_config"))
        cfg["base_url"] = str(parsed.get("base_url") or cfg.get("base_url") or "")
        cfg["api_key"] = str(parsed.get("api_key") or cfg.get("api_key") or "")
        cfg["model"] = str(parsed.get("model") or cfg.get("model") or "")
        cfg["endpoint_path"] = str(parsed.get("endpoint_path") or cfg.get("endpoint_path") or "/v1/chat/completions")
        if custom_headers:
            cfg["custom_headers"] = custom_headers
        if custom_body_params:
            cfg["custom_body_params"] = custom_body_params
        update_payload["llm_config"] = cfg

    put_status, put_payload = await api_request(
        api_base_url=settings.api_base_url,
        method="PUT",
        path=f"/v1/admin/agent-profiles/{profile_id}",
        access_token=access_token,
        json_body=update_payload,
    )
    message = (
        f"Imported cURL into {section.replace('_config', '').upper()} settings"
        if put_status == 200
        else extract_error_message(put_payload, "cURL import failed")
    )

    final_status, final_payload = await api_request(
        api_base_url=settings.api_base_url,
        method="GET",
        path=f"/v1/admin/agent-profiles/{profile_id}",
        access_token=access_token,
    )
    final_profile = final_payload.get("data") if final_status == 200 and isinstance(final_payload, dict) else profile
    return templates.TemplateResponse(
        request=request,
        name="profiles/_editor_panel.html",
        context={"profile": final_profile, "message": message},
        status_code=200 if isinstance(final_profile, dict) else 502,
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


@app.get("/logs/stream")
async def stream_logs(request: Request) -> StreamingResponse:
    async def generator():
        # Send a heartbeat comment first so the browser knows the connection is alive
        yield ": connected\n\n"

        # Send existing log entries
        if request_log_file.exists():
            content = request_log_file.read_text(encoding="utf-8", errors="replace")
            for line in content.splitlines():
                line = line.strip()
                if line:
                    yield f"data: {line}\n\n"

        pos = request_log_file.stat().st_size if request_log_file.exists() else 0

        while True:
            if await request.is_disconnected():
                break
            await asyncio.sleep(0.4)

            if not request_log_file.exists():
                pos = 0
                continue

            size = request_log_file.stat().st_size
            if size < pos:
                # File was truncated (cleared)
                pos = 0
                yield f"data: {json.dumps({'_ctrl': 'clear'})}\n\n"
                continue

            if size > pos:
                with open(request_log_file, "r", encoding="utf-8", errors="replace") as f:
                    f.seek(pos)
                    new_data = f.read()
                pos = size
                for line in new_data.splitlines():
                    line = line.strip()
                    if line:
                        yield f"data: {line}\n\n"

    return StreamingResponse(
        generator(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


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
  <title>Voice Sessions</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: #0a0a0a;
      color: #e2e8f0;
      min-height: 100vh;
    }
    header {
      position: sticky;
      top: 0;
      z-index: 10;
      background: #111111;
      border-bottom: 1px solid #1e1e1e;
      padding: 14px 20px;
      display: flex;
      align-items: center;
      gap: 12px;
    }
    header h1 {
      font-size: 15px;
      font-weight: 600;
      color: #f1f5f9;
      flex: 1;
    }
    .live-dot {
      width: 8px; height: 8px;
      border-radius: 50%;
      background: #334155;
      flex-shrink: 0;
      transition: background 0.3s;
    }
    .live-dot.connected { background: #22c55e; box-shadow: 0 0 6px #22c55e88; }
    .live-label {
      font-size: 11px;
      color: #64748b;
      font-weight: 500;
      letter-spacing: 0.05em;
    }
    .live-label.connected { color: #22c55e; }
    .btn-clear {
      background: none;
      border: 1px solid #2a2a2a;
      color: #64748b;
      padding: 5px 12px;
      border-radius: 6px;
      font-size: 12px;
      cursor: pointer;
      transition: all 0.15s;
    }
    .btn-clear:hover { border-color: #ef4444; color: #ef4444; }

    #sessions { padding: 16px 20px; display: flex; flex-direction: column; gap: 12px; }

    .session-card {
      background: #111827;
      border: 1px solid #1e293b;
      border-radius: 12px;
      overflow: hidden;
      animation: fadeIn 0.2s ease;
    }
    .session-card.active { border-color: #6C63FF44; }
    @keyframes fadeIn { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: translateY(0); } }

    .session-header {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 10px 14px;
      background: #0f172a;
      border-bottom: 1px solid #1e293b;
    }
    .session-header.active { background: #1a1040; border-bottom-color: #6C63FF33; }
    .room-name {
      font-size: 12px;
      font-family: ui-monospace, monospace;
      color: #94a3b8;
      flex: 1;
    }
    .session-time { font-size: 11px; color: #475569; }
    .badge {
      font-size: 10px;
      font-weight: 600;
      letter-spacing: 0.06em;
      padding: 2px 7px;
      border-radius: 10px;
      text-transform: uppercase;
    }
    .badge-active { background: #6C63FF22; color: #a78bfa; border: 1px solid #6C63FF44; }
    .badge-ended { background: #1e293b; color: #475569; }

    .turns { padding: 10px 14px; display: flex; flex-direction: column; gap: 8px; }

    .turn { display: flex; flex-direction: column; gap: 4px; }

    .bubble {
      max-width: 80%;
      padding: 8px 12px;
      border-radius: 10px;
      font-size: 13px;
      line-height: 1.5;
      word-break: break-word;
    }
    .bubble-user {
      align-self: flex-end;
      background: #1e3a5f;
      color: #bfdbfe;
      border-bottom-right-radius: 3px;
    }
    .bubble-agent {
      align-self: flex-start;
      background: #2d1b69;
      color: #ddd6fe;
      border-bottom-left-radius: 3px;
    }
    .bubble-error {
      align-self: flex-start;
      background: #3b0f0f;
      color: #fca5a5;
      border-bottom-left-radius: 3px;
      font-size: 12px;
    }
    .bubble-label {
      font-size: 10px;
      color: #475569;
      font-weight: 500;
      letter-spacing: 0.04em;
    }
    .bubble-label-user { text-align: right; }

    .event-row {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 11px;
      color: #475569;
      padding: 2px 0;
    }
    .event-dot {
      width: 6px; height: 6px;
      border-radius: 50%;
      flex-shrink: 0;
    }
    .dot-green { background: #22c55e; }
    .dot-red { background: #ef4444; }
    .dot-grey { background: #334155; }

    .session-footer {
      padding: 6px 14px 10px;
      font-size: 11px;
      color: #334155;
    }

    .empty-state {
      text-align: center;
      padding: 60px 20px;
      color: #334155;
      font-size: 14px;
    }
    .empty-state p { margin-top: 8px; font-size: 12px; color: #1e293b; }
  </style>
</head>
<body>
  <header>
    <div class="live-dot" id="liveDot"></div>
    <h1>Voice Sessions</h1>
    <span class="live-label" id="liveLabel">CONNECTING</span>
    <button class="btn-clear" id="btnClear">Clear</button>
  </header>
  <div id="sessions"></div>

  <script>
    const sessionsEl = document.getElementById("sessions");
    const liveDot = document.getElementById("liveDot");
    const liveLabel = document.getElementById("liveLabel");
    const btnClear = document.getElementById("btnClear");

    // sessions keyed by room name (stable unique ID per session)
    // jobToRoom maps job_id → room name so n8n events can find their session
    const sessions = new Map();
    const jobToRoom = new Map();

    function setLive(on) {
      liveDot.className = "live-dot" + (on ? " connected" : "");
      liveLabel.className = "live-label" + (on ? " connected" : "");
      liveLabel.textContent = on ? "LIVE" : "RECONNECTING";
    }

    function fmtTime(iso) {
      if (!iso) return "";
      const d = new Date(iso);
      if (isNaN(d)) return iso;
      return d.toLocaleTimeString("en-GB", { hour12: false });
    }

    function fmtDuration(startIso, endIso) {
      if (!startIso || !endIso) return "";
      const s = Math.round((new Date(endIso) - new Date(startIso)) / 1000);
      if (s < 60) return s + "s";
      return Math.floor(s / 60) + "m " + (s % 60) + "s";
    }

    const STALE_MS = 30 * 60 * 1000; // sessions active for 30+ min = stale

    function sessionStatus(s) {
      if (!s.active) return "ended";
      if (s.startTime && (Date.now() - new Date(s.startTime).getTime()) > STALE_MS) return "stale";
      return "active";
    }

    function renderSession(s) {
      const card = document.createElement("div");
      const status = sessionStatus(s);
      card.className = "session-card" + (status === "active" ? " active" : "");
      card.id = "session-" + s.id;

      const dur = s.endTime ? fmtDuration(s.startTime, s.endTime) : "";
      const statusBadge = status === "active"
        ? '<span class="badge badge-active">active</span>'
        : status === "stale"
          ? '<span class="badge badge-ended">stale</span>'
          : '<span class="badge badge-ended">ended' + (dur ? " · " + dur : "") + "</span>";

      let html = `
        <div class="session-header ${s.active ? "active" : ""}">
          <span class="room-name">${escHtml(s.roomName)}</span>
          <span class="session-time">${fmtTime(s.startTime)}</span>
          ${statusBadge}
        </div>
        <div class="turns">
          <div class="event-row">
            <div class="event-dot dot-green"></div>
            <span>Connected · ${fmtTime(s.startTime)}</span>
          </div>`;

      for (const turn of s.turns) {
        if (turn.type === "turn") {
          html += `<div class="turn">`;
          if (turn.userText) {
            html += `
              <div class="bubble-label bubble-label-user">You</div>
              <div class="bubble bubble-user">${escHtml(turn.userText)}</div>`;
          }
          if (turn.agentText) {
            html += `
              <div class="bubble-label">Agent</div>
              <div class="bubble bubble-agent">${escHtml(turn.agentText)}</div>`;
          }
          html += `</div>`;
        } else if (turn.type === "error") {
          html += `
            <div class="event-row" style="margin-top:4px">
              <div class="event-dot dot-grey"></div>
              <div class="bubble bubble-error" style="max-width:100%">${escHtml(turn.message)}</div>
            </div>`;
        }
      }

      if (s.pendingUserText) {
        html += `<div class="turn">
          <div class="bubble-label bubble-label-user">You</div>
          <div class="bubble bubble-user">${escHtml(s.pendingUserText)}</div>
          <div class="bubble-label" style="color:#475569;font-style:italic;font-size:11px">Agent is thinking…</div>
        </div>`;
      }

      if (!s.active) {
        html += `
          <div class="event-row">
            <div class="event-dot dot-red"></div>
            <span>Disconnected · ${fmtTime(s.endTime)}</span>
          </div>`;
      }

      html += `</div>`;
      card.innerHTML = html;
      return card;
    }

    function escHtml(str) {
      return String(str || "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
    }

    function upsertSessionCard(s) {
      const existing = document.getElementById("session-" + s.id);
      const card = renderSession(s);
      if (existing) {
        existing.replaceWith(card);
      } else {
        if (sessionsEl.firstChild) {
          sessionsEl.insertBefore(card, sessionsEl.firstChild);
        } else {
          sessionsEl.appendChild(card);
        }
      }
      updateEmptyState();
    }

    function updateEmptyState() {
      const empty = document.getElementById("emptyState");
      if (sessions.size === 0) {
        if (!empty) {
          const el = document.createElement("div");
          el.id = "emptyState";
          el.className = "empty-state";
          el.innerHTML = "No sessions yet<p>Start a voice session from the mobile app</p>";
          sessionsEl.appendChild(el);
        }
      } else {
        if (empty) empty.remove();
      }
    }

    // Extract room name from message e.g. "session connect room=coziyoo-room-abc"
    function extractRoom(msg) {
      const m = msg.match(/room=([^ ]+)/);
      return m ? m[1] : null;
    }

    // Extract value after key= (to end of string)
    function extractVal(msg, key) {
      const idx = msg.indexOf(key + "=");
      if (idx === -1) return null;
      return msg.slice(idx + key.length + 1).trim() || null;
    }

    function getOrCreateSession(roomName, ts) {
      if (!sessions.has(roomName)) {
        sessions.set(roomName, {
          id: roomName,
          roomName,
          startTime: ts,
          endTime: null,
          active: true,
          turns: [],
          pendingUserText: null,
        });
      }
      return sessions.get(roomName);
    }

    function sessionByJob(jobId) {
      if (!jobId) return null;
      const roomName = jobToRoom.get(jobId);
      return roomName ? sessions.get(roomName) : null;
    }

    function processLine(item) {
      const name = item.name || "";
      const msg = item.message || "";
      const ts = item.timestamp || new Date().toISOString();
      const jobId = item.job_id || null;
      const level = (item.level || "INFO").toUpperCase();
      const roomName = extractRoom(msg);

      // ── Session connect ──
      if (name.endsWith(".session") && msg.startsWith("session connect")) {
        if (!roomName) return;
        const s = getOrCreateSession(roomName, ts);
        if (jobId) jobToRoom.set(jobId, roomName);  // register alias
        s.active = true;
        upsertSessionCard(s);
        return;
      }

      // ── Session disconnect ──
      if (name.endsWith(".session") && msg.startsWith("session disconnect")) {
        if (!roomName) return;
        // Create ghost entry for historical disconnect-only records
        const s = getOrCreateSession(roomName, ts);
        if (jobId) jobToRoom.set(jobId, roomName);
        s.active = false;
        s.endTime = ts;
        s.pendingUserText = null;
        upsertSessionCard(s);
        return;
      }

      // N8N events — look up session via job_id → room name
      const s = sessionByJob(jobId);
      if (!s) return;

      // ── N8N request (user speech) ──
      if (name.endsWith(".n8n") && msg.startsWith("N8N request")) {
        const userText = extractVal(msg, "text");
        if (!userText) return;
        s.pendingUserText = userText;
        upsertSessionCard(s);
        return;
      }

      // ── N8N response (agent reply) — webhook or execution_api path ──
      if (name.endsWith(".n8n") && msg.includes("N8N response") && msg.includes("status=200")) {
        const agentText = extractVal(msg, "answer");
        const userText = s.pendingUserText;
        s.pendingUserText = null;
        s.turns.push({ type: "turn", userText, agentText, ts });
        upsertSessionCard(s);
        return;
      }

      // ── N8N error ──
      if (name.endsWith(".n8n") && level === "ERROR") {
        const userText = s.pendingUserText;
        s.pendingUserText = null;
        if (userText) s.turns.push({ type: "turn", userText, agentText: null, ts });
        s.turns.push({ type: "error", message: msg, ts });
        upsertSessionCard(s);
        return;
      }
    }

    function clearAll() {
      sessions.clear();
      jobToRoom.clear();
      sessionsEl.innerHTML = "";
      updateEmptyState();
    }

    let evtSource = null;

    function connect() {
      if (evtSource) evtSource.close();
      evtSource = new EventSource("/logs/stream");

      evtSource.addEventListener("open", () => setLive(true));

      evtSource.addEventListener("message", (e) => {
        const raw = e.data.trim();
        if (!raw) return;
        try {
          const item = JSON.parse(raw);
          if (item._ctrl === "clear") { clearAll(); return; }
          processLine(item);
        } catch (_) {}
      });

      evtSource.addEventListener("error", () => {
        setLive(false);
        evtSource.close();
        setTimeout(connect, 3000);
      });
    }

    btnClear.addEventListener("click", async () => {
      if (!confirm("Clear all logs?")) return;
      await fetch("/logs/clear", { method: "POST" });
      clearAll();
    });

    updateEmptyState();
    connect();
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
