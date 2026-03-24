from __future__ import annotations

import asyncio
import base64
import json
import logging
import os
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import urlencode, urlparse

import aiohttp
from fastapi import FastAPI, Header, HTTPException, Query, Request
from fastapi.responses import HTMLResponse, RedirectResponse, Response, StreamingResponse
from fastapi.templating import Jinja2Templates
from livekit import api
from pydantic import BaseModel, Field

from .config.settings import get_settings
from .curl_parser import parse_curl_command
from .dashboard_api import api_binary_request as _raw_api_binary_request
from .dashboard_api import api_request as _raw_api_request
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


class InvalidSessionError(Exception):
    pass


def _is_invalid_session_response(status: int, payload: Any) -> bool:
    if status not in {401, 403}:
        return False
    needle = "invalid or expired token"
    if isinstance(payload, dict):
        error = payload.get("error")
        if isinstance(error, dict):
            message = str(error.get("message") or "").strip().lower()
            code = str(error.get("code") or "").strip().lower()
            return needle in message or code in {"invalid_token", "expired_token", "token_invalid_or_expired"}
        return needle in str(payload).lower()
    if isinstance(payload, str):
        return needle in payload.lower()
    return False


async def api_request(
    *,
    api_base_url: str,
    method: str,
    path: str,
    access_token: str | None,
    json_body: dict[str, Any] | None = None,
) -> tuple[int, Any]:
    status, payload = await _raw_api_request(
        api_base_url=api_base_url,
        method=method,
        path=path,
        access_token=access_token,
        json_body=json_body,
    )
    if _is_invalid_session_response(status, payload):
        raise InvalidSessionError()
    return status, payload


async def api_binary_request(
    *,
    api_base_url: str,
    method: str,
    path: str,
    access_token: str | None,
    json_body: dict[str, Any] | None = None,
) -> tuple[int, bytes, str]:
    status, data, content_type = await _raw_api_binary_request(
        api_base_url=api_base_url,
        method=method,
        path=path,
        access_token=access_token,
        json_body=json_body,
    )
    if status in {401, 403}:
        text = data.decode("utf-8", errors="ignore")
        if _is_invalid_session_response(status, text):
            raise InvalidSessionError()
    return status, data, content_type


@app.exception_handler(InvalidSessionError)
async def invalid_session_exception_handler(_request: Request, _exc: InvalidSessionError) -> Response:
    response = RedirectResponse(url="/dashboard/login", status_code=303)
    clear_auth_cookies(response)
    return response


async def _fetch_profiles(access_token: str) -> tuple[list[dict[str, Any]], str | None]:
    status, payload = await api_request(
        api_base_url=settings.api_base_url,
        method="GET",
        path="/v1/admin/agent-profiles",
        access_token=access_token,
    )
    if status == 404:
        legacy_status, legacy_payload = await api_request(
            api_base_url=settings.api_base_url,
            method="GET",
            path="/v1/admin/livekit/agent-settings",
            access_token=access_token,
        )
        if legacy_status != 200 or not isinstance(legacy_payload, dict):
            return [], "Failed to load profiles"
        legacy_rows = legacy_payload.get("data")
        if not isinstance(legacy_rows, list):
            return [], "Invalid profile list response"
        mapped: list[dict[str, Any]] = []
        for row in legacy_rows:
            if not isinstance(row, dict):
                continue
            profile_id = str(row.get("device_id") or "").strip()
            if not profile_id:
                continue
            mapped.append(
                {
                    "id": profile_id,
                    "name": str(row.get("agent_name") or profile_id),
                    "is_active": bool(row.get("is_active")),
                }
            )
        mapped.sort(key=lambda item: str(item.get("name") or "").lower())
        return mapped, None

    if status != 200 or not isinstance(payload, dict):
        return [], extract_error_message(payload, "Failed to load profiles")
    rows = payload.get("data")
    if not isinstance(rows, list):
        return [], "Invalid profile list response"
    normalized = [row for row in rows if isinstance(row, dict)]
    normalized.sort(key=lambda item: str(item.get("name") or "").lower())
    return normalized, None


async def _render_sidebar(request: Request, access_token: str, message: str | None = None) -> HTMLResponse:
    profiles, error_message = await _fetch_profiles(access_token)
    return templates.TemplateResponse(
        request=request,
        name="profiles/_sidebar.html",
        context={"profiles": profiles, "message": message or error_message},
    )


def _format_duration(seconds: Any) -> str:
    try:
        total = max(0, int(seconds))
    except (TypeError, ValueError):
        return "-"
    mins, secs = divmod(total, 60)
    hours, mins = divmod(mins, 60)
    if hours:
        return f"{hours}h {mins}m {secs}s"
    if mins:
        return f"{mins}m {secs}s"
    return f"{secs}s"


def _format_started_at(value: Any) -> str:
    if not isinstance(value, str) or not value:
        return "-"
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return value
    return parsed.strftime("%Y-%m-%d %H:%M:%S UTC")


def _normalize_call_log_rows(rows: Any) -> list[dict[str, Any]]:
    if not isinstance(rows, list):
        return []
    normalized: list[dict[str, Any]] = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        normalized.append(
            {
                "id": str(row.get("id") or ""),
                "room_name": str(row.get("room_name") or "-"),
                "profile_id": str(row.get("profile_id") or ""),
                "profile_name": str(row.get("profile_name") or "Unknown profile"),
                "started_at": str(row.get("started_at") or ""),
                "started_at_display": _format_started_at(row.get("started_at")),
                "ended_at": str(row.get("ended_at") or ""),
                "duration_seconds": int(row.get("duration_seconds") or 0),
                "duration_display": _format_duration(row.get("duration_seconds")),
                "outcome": str(row.get("outcome") or "unknown"),
            }
        )
    return normalized


def _normalize_from_filter(value: str | None) -> str | None:
    if not value:
        return None
    raw = value.strip()
    if not raw:
        return None
    if "T" in raw:
        return raw
    return f"{raw}T00:00:00.000Z"


def _normalize_to_filter(value: str | None) -> str | None:
    if not value:
        return None
    raw = value.strip()
    if not raw:
        return None
    if "T" in raw:
        return raw
    return f"{raw}T23:59:59.999Z"


async def _fetch_call_logs(
    access_token: str,
    *,
    profile_id: str | None = None,
    from_value: str | None = None,
    to_value: str | None = None,
) -> tuple[list[dict[str, Any]], str | None]:
    params: dict[str, str] = {"limit": "200"}
    if profile_id:
        params["profileId"] = profile_id
    normalized_from = _normalize_from_filter(from_value)
    normalized_to = _normalize_to_filter(to_value)
    if normalized_from:
        params["from"] = normalized_from
    if normalized_to:
        params["to"] = normalized_to
    query = urlencode(params)
    path = f"/v1/admin/agent-call-logs?{query}" if query else "/v1/admin/agent-call-logs"
    status, payload = await api_request(
        api_base_url=settings.api_base_url,
        method="GET",
        path=path,
        access_token=access_token,
    )
    if status != 200 or not isinstance(payload, dict):
        return [], extract_error_message(payload, "Failed to load call logs")
    return _normalize_call_log_rows(payload.get("data")), None


_UUID_RE = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", re.I)


def _is_uuid(s: str) -> bool:
    return bool(_UUID_RE.match(s))


def _dict(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _extract_auth_header(config: dict[str, Any], api_key: str | None = None) -> str:
    headers = _dict(config.get("custom_headers"))
    for key in ("authorization", "Authorization", "AUTHORIZATION"):
        value = str(headers.get(key) or "").strip()
        if value:
            return value
    clean_api_key = str(api_key or config.get("api_key") or "").strip()
    return f"Bearer {clean_api_key}" if clean_api_key else ""


def _legacy_settings_to_profile(profile_id: str, settings_data: dict[str, Any]) -> dict[str, Any]:
    tts_config = _dict(settings_data.get("ttsConfig"))
    stt_legacy = _dict(tts_config.get("stt"))
    llm_legacy = _dict(tts_config.get("llm"))
    n8n_legacy = _dict(tts_config.get("n8n"))

    llm_base_url = str(
        llm_legacy.get("baseUrl")
        or llm_legacy.get("ollamaBaseUrl")
        or settings_data.get("ollamaBaseUrl")
        or ""
    )
    stt_base_url = str(stt_legacy.get("baseUrl") or settings_data.get("sttBaseUrl") or "")
    tts_base_url = str(tts_config.get("baseUrl") or settings_data.get("ttsBaseUrl") or "")

    return {
        "id": profile_id,
        "name": str(settings_data.get("agentName") or settings_data.get("agent_name") or profile_id),
        "is_active": bool(settings_data.get("isActive") or settings_data.get("is_active")),
        "speaks_first": bool(settings_data.get("speaksFirst") or settings_data.get("speaks_first")),
        "system_prompt": str(settings_data.get("systemPrompt") or ""),
        "greeting_enabled": bool(settings_data.get("greetingEnabled", True)),
        "greeting_instruction": str(settings_data.get("greetingInstruction") or ""),
        "voice_language": str(settings_data.get("voiceLanguage") or "tr"),
        "llm_config": {
            "provider": str(llm_legacy.get("provider") or "custom"),
            "base_url": llm_base_url,
            "api_key": str(llm_legacy.get("apiKey") or ""),
            "api_key_id": str(llm_legacy.get("apiKeyId") or ""),
            # Prefer nested llm.model over legacy top-level ollamaModel to avoid stale values.
            "model": str(llm_legacy.get("model") or settings_data.get("ollamaModel") or ""),
            "endpoint_path": str(llm_legacy.get("endpointPath") or "/v1/chat/completions"),
            "custom_headers": _dict(llm_legacy.get("customHeaders")),
            "custom_body_params": _dict(llm_legacy.get("customBodyParams")),
        },
        "stt_config": {
            "provider": str(stt_legacy.get("provider") or settings_data.get("sttProvider") or "custom"),
            "base_url": stt_base_url,
            "api_key": str(stt_legacy.get("apiKey") or ""),
            "api_key_id": str(stt_legacy.get("apiKeyId") or ""),
            "model": str(stt_legacy.get("model") or settings_data.get("sttModel") or ""),
            "models_path": str(stt_legacy.get("modelsPath") or "/v1/models"),
            "endpoint_path": str(stt_legacy.get("transcribePath") or settings_data.get("sttTranscribePath") or "/v1/audio/transcriptions"),
            "language": str(stt_legacy.get("language") or ""),
            "custom_headers": _dict(stt_legacy.get("customHeaders")),
            "custom_body_params": _dict(stt_legacy.get("customBodyParams")),
            "custom_query_params": _dict(stt_legacy.get("queryParams")),
        },
        "tts_config": {
            "provider": str(tts_config.get("provider") or "custom"),
            "language": str(tts_config.get("language") or "multilingual"),
            "base_url": tts_base_url,
            "api_key": str(tts_config.get("apiKey") or ""),
            "api_key_id": str(tts_config.get("apiKeyId") or ""),
            "model": str(tts_config.get("model") or ""),
            "models_path": str(tts_config.get("modelsPath") or "/v1/models"),
            "endpoint_path": str(tts_config.get("path") or "/v1/audio/speech"),
            "voice_id": str(tts_config.get("voiceId") or ""),
            "text_field_name": str(tts_config.get("textFieldName") or "input"),
            "custom_headers": _dict(tts_config.get("customHeaders")),
            "custom_body_params": _dict(tts_config.get("customBodyParams")),
            "custom_query_params": _dict(tts_config.get("queryParams")),
        },
        "n8n_config": {
            "base_url": str(n8n_legacy.get("baseUrl") or settings_data.get("n8nBaseUrl") or ""),
            "webhook_path": str(n8n_legacy.get("webhookPath") or ""),
            "mcp_webhook_path": str(n8n_legacy.get("mcpWebhookPath") or ""),
        },
    }


def _to_legacy_profile_payload(payload: dict[str, Any]) -> dict[str, Any]:
    llm_config = _dict(payload.get("llm_config"))
    stt_config = _dict(payload.get("stt_config"))
    tts_config = _dict(payload.get("tts_config"))
    n8n_config = _dict(payload.get("n8n_config"))

    stt_auth = _extract_auth_header(stt_config)
    tts_auth = _extract_auth_header(tts_config)

    return {
        "agentName": str(payload.get("name") or "profile"),
        "voiceLanguage": str(payload.get("voice_language") or "tr"),
        "systemPrompt": str(payload.get("system_prompt") or ""),
        "greetingEnabled": bool(payload.get("greeting_enabled", True)),
        "greetingInstruction": str(payload.get("greeting_instruction") or ""),
        "ttsEnabled": True,
        "sttEnabled": True,
        "sttProvider": str(stt_config.get("provider") or "custom"),
        "sttBaseUrl": str(stt_config.get("base_url") or ""),
        "sttTranscribePath": str(stt_config.get("endpoint_path") or "/v1/audio/transcriptions"),
        "sttModel": str(stt_config.get("model") or ""),
        "sttQueryParams": _string_map(stt_config.get("custom_query_params")),
        "sttAuthHeader": stt_auth,
        "ttsBaseUrl": str(tts_config.get("base_url") or ""),
        "ttsSynthPath": str(tts_config.get("endpoint_path") or "/v1/audio/speech"),
        "ttsQueryParams": _string_map(tts_config.get("custom_query_params")),
        "ttsAuthHeader": tts_auth,
        "n8nBaseUrl": str(n8n_config.get("base_url") or ""),
        "ollamaBaseUrl": str(llm_config.get("base_url") or ""),
        "ollamaModel": str(llm_config.get("model") or ""),
        "ttsConfig": {
            "provider": str(tts_config.get("provider") or "custom"),
            "language": str(tts_config.get("language") or "multilingual"),
            "baseUrl": str(tts_config.get("base_url") or ""),
            "model": str(tts_config.get("model") or ""),
            "modelsPath": str(tts_config.get("models_path") or "/v1/models"),
            "path": str(tts_config.get("endpoint_path") or "/v1/audio/speech"),
            "stt": {
                "provider": str(stt_config.get("provider") or "custom"),
                "baseUrl": str(stt_config.get("base_url") or ""),
                "apiKeyId": str(stt_config.get("api_key_id") or ""),
                "transcribePath": str(stt_config.get("endpoint_path") or "/v1/audio/transcriptions"),
                "model": str(stt_config.get("model") or ""),
                "modelsPath": str(stt_config.get("models_path") or "/v1/models"),
                "language": str(stt_config.get("language") or ""),
                "queryParams": _dict(stt_config.get("custom_query_params")),
                "customHeaders": _dict(stt_config.get("custom_headers")),
                "customBodyParams": _dict(stt_config.get("custom_body_params")),
            },
            "llm": {
                "provider": str(llm_config.get("provider") or "custom"),
                "baseUrl": str(llm_config.get("base_url") or ""),
                "apiKey": str(llm_config.get("api_key") or ""),
                "apiKeyId": str(llm_config.get("api_key_id") or ""),
                "model": str(llm_config.get("model") or ""),
                "endpointPath": str(llm_config.get("endpoint_path") or "/v1/chat/completions"),
                "customHeaders": _dict(llm_config.get("custom_headers")),
                "customBodyParams": _dict(llm_config.get("custom_body_params")),
            },
            "n8n": {
                "baseUrl": str(n8n_config.get("base_url") or ""),
                "webhookPath": str(n8n_config.get("webhook_path") or ""),
                "mcpWebhookPath": str(n8n_config.get("mcp_webhook_path") or ""),
            },
            "apiKeyId": str(tts_config.get("api_key_id") or ""),
        },
    }


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


PROVIDER_API_KEY_FIELDS: list[tuple[str, str, str]] = [
    ("llm.openai", "LLM", "OpenAI"),
    ("llm.gemini", "LLM", "Google Gemini"),
    ("llm.anthropic", "LLM", "Anthropic"),
    ("llm.kimi", "LLM", "Kimi (Moonshot)"),
    ("llm.custom", "LLM", "Custom Provider"),
    ("tts.elevenlabs", "TTS", "ElevenLabs"),
    ("tts.openai", "TTS", "OpenAI"),
    ("tts.cartesia", "TTS", "Cartesia"),
    ("tts.azure", "TTS", "Azure"),
    ("tts.google", "TTS", "Google"),
    ("tts.playht", "TTS", "PlayHT"),
    ("tts.custom", "TTS", "Custom Provider"),
    ("stt.deepgram", "STT", "Deepgram"),
    ("stt.google", "STT", "Google"),
    ("stt.assemblyai", "STT", "AssemblyAI"),
    ("stt.azure", "STT", "Azure"),
    ("stt.openai", "STT", "OpenAI"),
    ("stt.speechmatics", "STT", "Speechmatics"),
    ("stt.custom", "STT", "Custom Provider"),
]


def _default_provider_api_keys() -> dict[str, str]:
    return {key: "" for key, _, _ in PROVIDER_API_KEY_FIELDS}


def _normalize_provider_api_keys(value: Any) -> dict[str, str]:
    defaults = _default_provider_api_keys()
    if not isinstance(value, dict):
        return defaults
    merged = dict(defaults)
    # Preserve known keys and any previously saved custom/unknown provider ids.
    for key, raw in value.items():
        if isinstance(key, str):
            merged[key] = str(raw or "").strip()
    return merged


def _provider_api_key_groups(keys: dict[str, str]) -> dict[str, list[dict[str, str]]]:
    grouped: dict[str, list[dict[str, str]]] = {"LLM": [], "TTS": [], "STT": []}
    for key, section, label in PROVIDER_API_KEY_FIELDS:
        grouped.setdefault(section, []).append({"id": key, "label": label, "value": str(keys.get(key) or "")})
    return grouped


def _provider_api_key_options() -> list[dict[str, str]]:
    provider_labels: dict[str, str] = {}
    for key, _section, label in PROVIDER_API_KEY_FIELDS:
        _scope, provider = _provider_key_scope_and_provider(key)
        if provider and provider not in provider_labels:
            provider_labels[provider] = label
    ordered_providers = [
        "openai",
        "gemini",
        "anthropic",
        "kimi",
        "elevenlabs",
        "cartesia",
        "azure",
        "google",
        "playht",
        "deepgram",
        "assemblyai",
        "speechmatics",
        "custom",
    ]
    options: list[dict[str, str]] = []
    for provider in ordered_providers:
        if provider in provider_labels:
            options.append({"id": provider, "label": provider_labels[provider]})
    return options


def _canonical_provider_id(provider_id: str) -> str:
    clean = str(provider_id or "").strip().lower()
    if not clean:
        return ""
    known_base_ids = set(_default_provider_api_keys().keys())
    if clean in known_base_ids:
        return clean
    aliases = {
        "openai": "llm.openai",
        "gemini": "llm.gemini",
        "anthropic": "llm.anthropic",
        "kimi": "llm.kimi",
        "elevenlabs": "tts.elevenlabs",
        "cartesia": "tts.cartesia",
        "azure": "tts.azure",
        "google": "tts.google",
        "playht": "tts.playht",
        "deepgram": "stt.deepgram",
        "assemblyai": "stt.assemblyai",
        "speechmatics": "stt.speechmatics",
        "custom": "llm.custom",
    }
    return aliases.get(clean, clean)


def _provider_api_key_entries(keys: dict[str, str]) -> list[dict[str, str]]:
    index = {key: (section, label) for key, section, label in PROVIDER_API_KEY_FIELDS}
    entries: list[dict[str, str]] = []
    for key, value in keys.items():
        clean = str(value or "").strip()
        if not clean:
            continue
        if key in index:
            section, label = index[key]
        else:
            # Named key id pattern: <base_provider_id>.<name-slug>
            matched_base = None
            for base_key in index.keys():
                if key.startswith(f"{base_key}."):
                    matched_base = base_key
                    break
            if matched_base:
                section, base_label = index[matched_base]
                custom_name = key[len(matched_base) + 1 :].replace("-", " ").strip()
                if matched_base.endswith(".custom"):
                    label = custom_name.title() if custom_name else "Custom Provider"
                else:
                    label = f"{base_label} ({custom_name.title()})" if custom_name else base_label
            else:
                # Heuristic mapping for unknown ids.
                if key.startswith("llm."):
                    section = "LLM"
                elif key.startswith("tts."):
                    section = "TTS"
                elif key.startswith("stt."):
                    section = "STT"
                else:
                    section = "Custom"
                label = key
        entries.append(
            {
                "id": key,
                "section": section,
                "label": label,
                "value": clean,
                "masked": f"{clean[:4]}...{clean[-4:]}" if len(clean) > 8 else "********",
            }
        )
    entries.sort(key=lambda item: f"{item['section']}::{item['label']}")
    return entries


def _extract_provider_api_keys_from_tts_config(tts_cfg: dict[str, Any]) -> dict[str, str]:
    # Primary field
    keys = _normalize_provider_api_keys(tts_cfg.get("providerApiKeys"))
    if any(v for v in keys.values()):
        return keys
    # Backward/legacy aliases
    aliases = ("provider_keys", "providerKeys", "apiKeys")
    for alias in aliases:
        alias_value = tts_cfg.get(alias)
        alias_keys = _normalize_provider_api_keys(alias_value)
        if any(v for v in alias_keys.values()):
            return alias_keys
    return keys


def _slugify(value: str) -> str:
    return re.sub(r"[^a-zA-Z0-9_-]+", "-", str(value or "").strip()).strip("-").lower()


def _extract_custom_providers(tts_cfg: dict[str, Any]) -> list[dict[str, str]]:
    raw = tts_cfg.get("customProviders")
    if not isinstance(raw, list):
        return []
    result: list[dict[str, str]] = []
    for row in raw:
        if not isinstance(row, dict):
            continue
        provider_type = str(row.get("type") or "").strip().lower()
        if provider_type not in {"llm", "tts", "stt"}:
            continue
        item = {
            "id": str(row.get("id") or "").strip(),
            "type": provider_type,
            "name": str(row.get("name") or "").strip(),
            "base_url": str(row.get("baseUrl") or "").strip(),
            "endpoint_path": str(row.get("endpointPath") or "").strip(),
            "models_path": str(row.get("modelsPath") or "").strip(),
            "api_key_id": str(row.get("apiKeyId") or "").strip(),
            "model": str(row.get("model") or "").strip(),
            "language": str(row.get("language") or "").strip(),
            "voice_id": str(row.get("voiceId") or "").strip(),
            "text_field_name": str(row.get("textFieldName") or "").strip(),
            "custom_headers": _dict(row.get("customHeaders")),
            "custom_body_params": _dict(row.get("customBodyParams")),
            "custom_query_params": _dict(row.get("customQueryParams")),
        }
        if not item["id"]:
            candidate = _slugify(f"{provider_type}-{item['name']}")
            item["id"] = candidate or f"{provider_type}-provider"
        if not item["name"]:
            item["name"] = item["id"]
        result.append(item)
    result.sort(key=lambda x: f"{x['type']}::{x['name']}".lower())
    return result


KNOWN_PROVIDER_CATALOG: list[dict[str, Any]] = [
    {
        "type": "llm",
        "id": "openai",
        "name": "OpenAI",
        "api_key_slot": "llm.openai",
        "base_url": "https://api.openai.com",
        "endpoint_path": "/v1/chat/completions",
        "models_path": "/v1/models",
        "model": "gpt-4o",
        "custom_headers": {},
    },
    {
        "type": "llm",
        "id": "gemini",
        "name": "Google Gemini",
        "api_key_slot": "llm.gemini",
        "base_url": "https://generativelanguage.googleapis.com/v1beta/openai",
        "endpoint_path": "/v1/chat/completions",
        "models_path": "/models",
        "model": "gemini-2.0-flash",
        "custom_headers": {},
    },
    {
        "type": "llm",
        "id": "ollama",
        "name": "Ollama",
        "api_key_slot": "",
        "base_url": "https://ollama.drascom.uk",
        "endpoint_path": "/v1/chat/completions",
        "models_path": "/api/tags",
        "model": "llama3.1:8b",
        "custom_headers": {},
    },
    {
        "type": "llm",
        "id": "kimi",
        "name": "Kimi (Moonshot)",
        "api_key_slot": "llm.kimi",
        "base_url": "https://api.moonshot.cn",
        "endpoint_path": "/v1/chat/completions",
        "models_path": "/v1/models",
        "model": "kimi-k2",
        "custom_headers": {},
    },
    {
        "type": "llm",
        "id": "claude",
        "name": "Anthropic Claude",
        "api_key_slot": "llm.anthropic",
        "base_url": "https://api.anthropic.com",
        "endpoint_path": "/v1/messages",
        "models_path": "/v1/models",
        "model": "claude-sonnet-4-6",
        "custom_headers": {"anthropic-version": "2023-06-01", "x-api-key": ""},
    },
    {
        "type": "tts",
        "id": "elevenlabs",
        "name": "ElevenLabs",
        "api_key_slot": "tts.elevenlabs",
        "base_url": "https://api.elevenlabs.io",
        "endpoint_path": "/v1/text-to-speech",
        "models_path": "/v1/models",
        "model": "eleven_multilingual_v2",
        "language": "multilingual",
        "text_field_name": "text",
    },
    {
        "type": "tts",
        "id": "openai",
        "name": "OpenAI",
        "api_key_slot": "tts.openai",
        "base_url": "https://api.openai.com",
        "endpoint_path": "/v1/audio/speech",
        "models_path": "/v1/models",
        "model": "gpt-4o-mini-tts",
        "language": "multilingual",
        "text_field_name": "input",
    },
    {
        "type": "tts",
        "id": "cartesia",
        "name": "Cartesia",
        "api_key_slot": "tts.cartesia",
        "base_url": "https://api.cartesia.ai",
        "endpoint_path": "/tts/bytes",
        "models_path": "/models",
        "model": "sonic-2",
        "language": "multilingual",
        "text_field_name": "transcript",
    },
    {
        "type": "tts",
        "id": "azure",
        "name": "Azure",
        "api_key_slot": "tts.azure",
        "base_url": "https://YOUR_RESOURCE_NAME.openai.azure.com",
        "endpoint_path": "/openai/deployments/YOUR_DEPLOYMENT/audio/speech?api-version=2024-02-15-preview",
        "models_path": "/openai/models?api-version=2024-02-15-preview",
        "model": "gpt-4o-mini-tts",
        "language": "multilingual",
        "text_field_name": "input",
    },
    {
        "type": "tts",
        "id": "google",
        "name": "Google",
        "api_key_slot": "tts.google",
        "base_url": "https://texttospeech.googleapis.com",
        "endpoint_path": "/v1/text:synthesize",
        "models_path": "/v1/models",
        "model": "gemini-2.5-flash-preview-tts",
        "language": "multilingual",
        "text_field_name": "input",
    },
    {
        "type": "tts",
        "id": "playht",
        "name": "PlayHT",
        "api_key_slot": "tts.playht",
        "base_url": "https://api.play.ht",
        "endpoint_path": "/api/v2/tts/stream",
        "models_path": "/api/v2/models",
        "model": "Play3.0-mini",
        "language": "multilingual",
        "text_field_name": "text",
    },
    {
        "type": "stt",
        "id": "deepgram",
        "name": "Deepgram",
        "api_key_slot": "stt.deepgram",
        "base_url": "https://api.deepgram.com",
        "endpoint_path": "/v1/listen",
        "models_path": "/v1/models",
        "model": "nova-2",
        "language": "multilingual",
    },
    {
        "type": "stt",
        "id": "google",
        "name": "Google",
        "api_key_slot": "stt.google",
        "base_url": "https://speech.googleapis.com",
        "endpoint_path": "/v1/speech:recognize",
        "models_path": "/v1/models",
        "model": "latest_long",
        "language": "multilingual",
    },
    {
        "type": "stt",
        "id": "assemblyai",
        "name": "AssemblyAI",
        "api_key_slot": "stt.assemblyai",
        "base_url": "https://api.assemblyai.com",
        "endpoint_path": "/v2/transcript",
        "models_path": "/v2/models",
        "model": "best",
        "language": "multilingual",
    },
    {
        "type": "stt",
        "id": "azure",
        "name": "Azure",
        "api_key_slot": "stt.azure",
        "base_url": "https://YOUR_RESOURCE_NAME.cognitiveservices.azure.com",
        "endpoint_path": "/speechtotext/transcriptions:transcribe?api-version=2024-11-15",
        "models_path": "/speechtotext/models?api-version=2024-11-15",
        "model": "latest",
        "language": "multilingual",
    },
    {
        "type": "stt",
        "id": "openai",
        "name": "OpenAI",
        "api_key_slot": "stt.openai",
        "base_url": "https://api.openai.com",
        "endpoint_path": "/v1/audio/transcriptions",
        "models_path": "/v1/models",
        "model": "gpt-4o-transcribe",
        "language": "multilingual",
    },
    {
        "type": "stt",
        "id": "speechmatics",
        "name": "Speechmatics",
        "api_key_slot": "stt.speechmatics",
        "base_url": "https://asr.api.speechmatics.com",
        "endpoint_path": "/v2/jobs",
        "models_path": "/v1/models",
        "model": "latest",
        "language": "multilingual",
    },
]


def _provider_catalog_from_tts_config(tts_cfg: dict[str, Any], keys: dict[str, str]) -> dict[str, list[dict[str, Any]]]:
    grouped: dict[str, list[dict[str, Any]]] = {"llm": [], "tts": [], "stt": []}
    for known in KNOWN_PROVIDER_CATALOG:
        provider_type = str(known.get("type") or "").strip().lower()
        if provider_type not in grouped:
            continue
        item = {
            "id": str(known.get("id") or "").strip(),
            "type": provider_type,
            "name": str(known.get("name") or "").strip(),
            "source": "known",
            "api_key_slot": str(known.get("api_key_slot") or "").strip(),
            "api_key_id": str(known.get("api_key_slot") or "").strip(),
            "api_key_masked": "",
            "base_url": str(known.get("base_url") or "").strip(),
            "endpoint_path": str(known.get("endpoint_path") or "").strip(),
            "models_path": str(known.get("models_path") or "").strip(),
            "model": str(known.get("model") or "").strip(),
            "language": str(known.get("language") or "").strip(),
            "voice_id": str(known.get("voice_id") or "").strip(),
            "text_field_name": str(known.get("text_field_name") or "").strip(),
            "custom_headers": _dict(known.get("custom_headers")),
            "custom_body_params": _dict(known.get("custom_body_params")),
            "custom_query_params": _dict(known.get("custom_query_params")),
        }
        slot = item["api_key_slot"]
        value = str(keys.get(slot) or "").strip()
        if value:
            item["api_key_masked"] = f"{value[:4]}...{value[-4:]}" if len(value) > 8 else "********"
        grouped[provider_type].append(item)

    for item in _extract_custom_providers(tts_cfg):
        provider_type = str(item.get("type") or "").strip().lower()
        if provider_type not in grouped:
            continue
        grouped[provider_type].append(
            {
                "id": str(item.get("id") or "").strip(),
                "type": provider_type,
                "name": str(item.get("name") or "").strip() or str(item.get("id") or "").strip(),
                "source": "custom",
                "api_key_slot": "",
                "api_key_id": str(item.get("api_key_id") or "").strip(),
                "api_key_masked": "",
                "base_url": str(item.get("base_url") or "").strip(),
                "endpoint_path": str(item.get("endpoint_path") or "").strip(),
                "models_path": str(item.get("models_path") or "").strip(),
                "model": str(item.get("model") or "").strip(),
                "language": str(item.get("language") or "").strip(),
                "voice_id": str(item.get("voice_id") or "").strip(),
                "text_field_name": str(item.get("text_field_name") or "").strip(),
                "custom_headers": _dict(item.get("custom_headers")),
                "custom_body_params": _dict(item.get("custom_body_params")),
                "custom_query_params": _dict(item.get("custom_query_params")),
            }
        )

    for provider_type in grouped:
        grouped[provider_type].sort(
            key=lambda x: (0 if str(x.get("source")) == "known" else 1, str(x.get("name") or "").lower())
        )
    return grouped


def _catalog_entry_from_known(known: dict[str, Any]) -> dict[str, Any]:
    """Convert KNOWN_PROVIDER_CATALOG entry to internal catalog format (flat, legacy)."""
    return {
        "id": str(known.get("id") or "").strip(),
        "type": str(known.get("type") or "").strip().lower(),
        "name": str(known.get("name") or "").strip(),
        "source": "known",
        "base_url": str(known.get("base_url") or "").strip(),
        "endpoint_path": str(known.get("endpoint_path") or "").strip(),
        "models_path": str(known.get("models_path") or "").strip(),
        "model": str(known.get("model") or "").strip(),
        "language": str(known.get("language") or "").strip(),
        "voice_id": str(known.get("voice_id") or "").strip(),
        "text_field_name": str(known.get("text_field_name") or "").strip(),
        "custom_headers": _dict(known.get("custom_headers")),
        "custom_body_params": _dict(known.get("custom_body_params")),
        "custom_query_params": _dict(known.get("custom_query_params")),
    }


def _build_known_catalog_entries() -> list[dict[str, Any]]:
    """Group KNOWN_PROVIDER_CATALOG entries by provider id into multi-type catalog entries."""
    grouped: dict[str, dict[str, Any]] = {}
    order: list[str] = []
    for item in KNOWN_PROVIDER_CATALOG:
        pid = str(item.get("id") or "").strip()
        ptype = str(item.get("type") or "").strip().lower()
        if not pid or ptype not in {"llm", "tts", "stt"}:
            continue
        if pid not in grouped:
            grouped[pid] = {
                "id": pid,
                "name": str(item.get("name") or "").strip(),
                "source": "known",
                "base_url": str(item.get("base_url") or "").strip(),
                "models_path": str(item.get("models_path") or "").strip(),
                "types": [],
            }
            order.append(pid)
        entry = grouped[pid]
        if ptype not in entry["types"]:
            entry["types"].append(ptype)
        type_cfg: dict[str, Any] = {
            "endpoint_path": str(item.get("endpoint_path") or "").strip(),
            "model": str(item.get("model") or "").strip(),
            "api_key_slot": str(item.get("api_key_slot") or "").strip(),
            "custom_headers": _dict(item.get("custom_headers")),
            "custom_body_params": _dict(item.get("custom_body_params")),
            "custom_query_params": _dict(item.get("custom_query_params")),
        }
        if ptype in {"tts", "stt"}:
            type_cfg["language"] = str(item.get("language") or "").strip()
        if ptype == "tts":
            type_cfg["voice_id"] = str(item.get("voice_id") or "").strip()
            type_cfg["text_field_name"] = str(item.get("text_field_name") or "").strip()
        entry[f"{ptype}_config"] = type_cfg
    result = [grouped[pid] for pid in order]
    result.sort(key=lambda x: str(x.get("name") or "").lower())
    return result


def _extract_catalog_providers(tts_cfg: dict[str, Any]) -> list[dict[str, Any]]:
    """Read multi-type catalogProviders from ttsConfig, seeding from KNOWN_PROVIDER_CATALOG if absent.

    Handles both the new multi-type format (types[], llmConfig, ttsConfig, sttConfig) and the
    old flat format (type: "llm", endpointPath, model at top level). Multiple flat rows with the
    same id are merged into a single multi-type entry instead of being dropped.
    """
    raw = tts_cfg.get("catalogProviders")
    if isinstance(raw, list) and raw:
        merged: dict[str, dict[str, Any]] = {}
        order: list[str] = []

        def _parse_type_cfg(src: dict[str, Any], ptype: str) -> dict[str, Any]:
            tc: dict[str, Any] = {
                "endpoint_path": str(src.get("endpointPath") or src.get("endpoint_path") or "").strip(),
                "model": str(src.get("model") or "").strip(),
                "api_key_slot": str(src.get("apiKeySlot") or src.get("api_key_slot") or "").strip(),
                "custom_headers": _dict(src.get("customHeaders") or src.get("custom_headers")),
                "custom_body_params": _dict(src.get("customBodyParams") or src.get("custom_body_params")),
                "custom_query_params": _dict(src.get("customQueryParams") or src.get("custom_query_params")),
            }
            if ptype in {"tts", "stt"}:
                tc["language"] = str(src.get("language") or "").strip()
            if ptype == "tts":
                tc["voice_id"] = str(src.get("voiceId") or src.get("voice_id") or "").strip()
                tc["text_field_name"] = str(src.get("textFieldName") or src.get("text_field_name") or "").strip()
            return tc

        for row in raw:
            if not isinstance(row, dict):
                continue
            pid = str(row.get("id") or "").strip()
            if not pid:
                continue

            if pid not in merged:
                merged[pid] = {
                    "id": pid,
                    "name": str(row.get("name") or "").strip(),
                    "source": str(row.get("source") or "custom").strip(),
                    "base_url": str(row.get("baseUrl") or row.get("base_url") or "").strip(),
                    "models_path": str(row.get("modelsPath") or row.get("models_path") or "").strip(),
                    "types": [],
                }
                order.append(pid)

            entry = merged[pid]

            # New multi-type format: types[] + {type}Config blocks
            raw_types = row.get("types")
            if isinstance(raw_types, list):
                for t in raw_types:
                    if t in {"llm", "tts", "stt"} and t not in entry["types"]:
                        entry["types"].append(t)

            for ptype in ("llm", "tts", "stt"):
                nested = row.get(f"{ptype}Config") or row.get(f"{ptype}_config")
                if isinstance(nested, dict):
                    entry[f"{ptype}_config"] = _parse_type_cfg(nested, ptype)
                    if ptype not in entry["types"]:
                        entry["types"].append(ptype)

            # Old flat format: single type stored at row level
            flat_type = str(row.get("type") or "").strip().lower()
            if flat_type in {"llm", "tts", "stt"} and f"{flat_type}_config" not in entry:
                entry[f"{flat_type}_config"] = _parse_type_cfg(row, flat_type)
                if flat_type not in entry["types"]:
                    entry["types"].append(flat_type)

        result = [merged[pid] for pid in order if merged[pid].get("types")]
        result.sort(key=lambda x: str(x.get("name") or "").lower())
        return result
    # Seed from hardcoded catalog
    return _build_known_catalog_entries()


def _extract_provider_instances(tts_cfg: dict[str, Any]) -> list[dict[str, Any]]:
    """Read providerInstances from ttsConfig."""
    raw = tts_cfg.get("providerInstances")
    if not isinstance(raw, list):
        return []
    result: list[dict[str, Any]] = []
    for row in raw:
        if not isinstance(row, dict):
            continue
        raw_types = row.get("types")
        types: list[str] = []
        if isinstance(raw_types, list):
            for item in raw_types:
                t = str(item or "").strip().lower()
                if t in {"llm", "tts", "stt"} and t not in types:
                    types.append(t)
        entry = {
            "id": str(row.get("id") or "").strip(),
            "name": str(row.get("name") or "").strip(),
            "catalog_id": str(row.get("catalogId") or row.get("catalog_id") or "").strip(),
            "type": str(row.get("type") or "").strip().lower(),
            "types": types,
            "api_key_id": str(row.get("apiKeyId") or row.get("api_key_id") or "").strip(),
            "model": str(row.get("model") or "").strip(),
            "language": str(row.get("language") or "").strip(),
            "voice_id": str(row.get("voiceId") or row.get("voice_id") or "").strip(),
            "text_field_name": str(row.get("textFieldName") or row.get("text_field_name") or "").strip(),
            "custom_headers": _dict(row.get("customHeaders") or row.get("custom_headers")),
            "custom_body_params": _dict(row.get("customBodyParams") or row.get("custom_body_params")),
            "custom_query_params": _dict(row.get("customQueryParams") or row.get("custom_query_params")),
        }
        if not entry["types"] and entry["type"] in {"llm", "tts", "stt"}:
            entry["types"] = [entry["type"]]
        if entry["id"] and entry["types"]:
            if entry["type"] not in {"llm", "tts", "stt"}:
                entry["type"] = entry["types"][0]
            result.append(entry)
    return result


def _catalog_to_camel(catalog: list[dict[str, Any]]) -> list[dict[str, Any]]:
    result = []
    for c in catalog:
        entry: dict[str, Any] = {
            "id": c["id"],
            "name": c["name"],
            "source": c.get("source", "custom"),
            "baseUrl": c.get("base_url", ""),
            "modelsPath": c.get("models_path", ""),
            "types": c.get("types", []),
        }
        for ptype in ("llm", "tts", "stt"):
            tc = c.get(f"{ptype}_config")
            if not isinstance(tc, dict):
                continue
            tc_camel: dict[str, Any] = {
                "endpointPath": tc.get("endpoint_path", ""),
                "model": tc.get("model", ""),
                "apiKeySlot": tc.get("api_key_slot", ""),
                "customHeaders": _dict(tc.get("custom_headers")),
                "customBodyParams": _dict(tc.get("custom_body_params")),
                "customQueryParams": _dict(tc.get("custom_query_params")),
            }
            if ptype in {"tts", "stt"}:
                tc_camel["language"] = tc.get("language", "")
            if ptype == "tts":
                tc_camel["voiceId"] = tc.get("voice_id", "")
                tc_camel["textFieldName"] = tc.get("text_field_name", "")
            entry[f"{ptype}Config"] = tc_camel
        result.append(entry)
    return result


def _instances_to_camel(instances: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [
        {
            "id": i["id"],
            "name": i["name"],
            "catalogId": i.get("catalog_id", ""),
            "type": i["type"],
            "types": i.get("types", [i.get("type", "")]),
            "apiKeyId": i.get("api_key_id", ""),
            "model": i.get("model", ""),
            "language": i.get("language", ""),
            "voiceId": i.get("voice_id", ""),
            "textFieldName": i.get("text_field_name", ""),
            "customHeaders": _dict(i.get("custom_headers")),
            "customBodyParams": _dict(i.get("custom_body_params")),
            "customQueryParams": _dict(i.get("custom_query_params")),
        }
        for i in instances
    ]


def _instance_supports_type(instance: dict[str, Any], provider_type: str) -> bool:
    target = str(provider_type or "").strip().lower()
    if target not in {"llm", "tts", "stt"}:
        return False
    types_raw = instance.get("types")
    if isinstance(types_raw, list):
        for item in types_raw:
            if str(item or "").strip().lower() == target:
                return True
    return str(instance.get("type") or "").strip().lower() == target


def _auto_migrate_to_instances(tts_cfg: dict[str, Any]) -> dict[str, Any]:
    """
    Transparent migration: build/repair providerInstances from:
    - Known providers that have a key bound in providerApiKeys → one instance each
    - customProviders → catalog entries + instances
    Returns a (possibly modified) copy of tts_cfg.
    """
    tts_cfg = dict(tts_cfg)
    keys = _extract_provider_api_keys_from_tts_config(tts_cfg)

    # Build catalog: existing (if present) + custom providers + known providers.
    catalog: list[dict[str, Any]] = _extract_catalog_providers(tts_cfg)
    existing_catalog_ids = {str(c.get("id") or "") for c in catalog if isinstance(c, dict)}
    for cp in _extract_custom_providers(tts_cfg):
        if cp["id"] not in existing_catalog_ids:
            ptype = str(cp.get("type") or "llm")
            catalog.append({
                "id": cp["id"],
                "name": cp["name"],
                "source": "custom",
                "base_url": cp.get("base_url", ""),
                "models_path": cp.get("models_path", ""),
                "types": [ptype],
                f"{ptype}_config": {
                    "endpoint_path": cp.get("endpoint_path", ""),
                    "model": cp.get("model", ""),
                    "api_key_slot": "",
                    "language": cp.get("language", ""),
                    "voice_id": cp.get("voice_id", ""),
                    "text_field_name": cp.get("text_field_name", ""),
                    "custom_headers": _dict(cp.get("custom_headers")),
                    "custom_body_params": _dict(cp.get("custom_body_params")),
                    "custom_query_params": _dict(cp.get("custom_query_params")),
                },
            })
            existing_catalog_ids.add(cp["id"])

    # Ensure known catalog ids are always present.
    known_catalog = _build_known_catalog_entries()
    known_catalog_ids = {str(c.get("id") or "") for c in known_catalog}
    missing_known = [c for c in known_catalog if str(c.get("id") or "") not in existing_catalog_ids]
    if missing_known:
        catalog.extend(missing_known)
        existing_catalog_ids.update(known_catalog_ids)

    # Start with existing instances, then backfill missing known/custom defaults.
    instances: list[dict[str, Any]] = _extract_provider_instances(tts_cfg)
    used_instance_ids = {str(i.get("id") or "") for i in instances if isinstance(i, dict)}

    def _next_instance_id(base: str) -> str:
        candidate = base
        idx = 2
        while candidate in used_instance_ids:
            candidate = f"{base}-{idx}"
            idx += 1
        used_instance_ids.add(candidate)
        return candidate

    def _has_instance(catalog_id: str) -> bool:
        for item in instances:
            if not isinstance(item, dict):
                continue
            if str(item.get("catalog_id") or "") == catalog_id:
                return True
        return False

    # Collapse old per-type default known instances into a single shared instance per provider.
    known_catalog = {str(c.get("id") or ""): c for c in catalog if str(c.get("source") or "") == "known"}
    rebuilt_instances: list[dict[str, Any]] = []
    processed_known_ids: set[str] = set()
    for item in instances:
        if not isinstance(item, dict):
            continue
        catalog_id = str(item.get("catalog_id") or "")
        if catalog_id in known_catalog:
            if catalog_id in processed_known_ids:
                continue
            same = [x for x in instances if str((x or {}).get("catalog_id") or "") == catalog_id]
            cat_types = [str(t) for t in (known_catalog[catalog_id].get("types") or []) if str(t) in {"llm", "tts", "stt"}]
            primary = same[0]
            merged = dict(primary)
            merged["id"] = f"{catalog_id}-default" if str(primary.get("id") or "").endswith("-default") else str(primary.get("id") or "")
            merged["type"] = (cat_types[0] if cat_types else str(primary.get("type") or "llm"))
            merged["types"] = cat_types or ([str(primary.get("type") or "")] if str(primary.get("type") or "") else [])
            if not merged["types"]:
                merged["types"] = [merged["type"]]
            for extra in same[1:]:
                for f in ("api_key_id", "model", "language", "voice_id", "text_field_name"):
                    if not str(merged.get(f) or "").strip():
                        merged[f] = str(extra.get(f) or "").strip()
                for f in ("custom_headers", "custom_body_params", "custom_query_params"):
                    if not _dict(merged.get(f)):
                        merged[f] = _dict(extra.get(f))
            rebuilt_instances.append(merged)
            processed_known_ids.add(catalog_id)
            continue
        rebuilt_instances.append(item)
    instances = rebuilt_instances
    used_instance_ids = {str(i.get("id") or "") for i in instances if isinstance(i, dict)}

    # Do not auto-create known instances. Keep Active Providers empty unless user explicitly adds one.

    # Build instances from custom providers if missing.
    for cp in _extract_custom_providers(tts_cfg):
        cp_id = str(cp.get("id") or "").strip()
        cp_type = str(cp.get("type") or "").strip().lower()
        if not cp_id or cp_type not in {"llm", "tts", "stt"}:
            continue
        if _has_instance(cp_id):
            continue
        instance_id = _next_instance_id(cp_id)
        instances.append({
            "id": instance_id, "name": cp["name"], "catalog_id": cp_id,
            "type": cp_type, "types": [cp_type], "api_key_id": cp.get("api_key_id", ""),
            "model": cp.get("model", ""), "language": cp.get("language", ""),
            "voice_id": cp.get("voice_id", ""), "text_field_name": cp.get("text_field_name", ""),
            "custom_headers": _dict(cp.get("custom_headers")),
            "custom_body_params": _dict(cp.get("custom_body_params")),
            "custom_query_params": _dict(cp.get("custom_query_params")),
        })

    tts_cfg["catalogProviders"] = _catalog_to_camel(catalog)
    tts_cfg["providerInstances"] = _instances_to_camel(instances)
    return tts_cfg


def _resolve_provider_instance(
    *,
    instance_id: str,
    requested_type: str,
    instances: list[dict[str, Any]],
    catalog: list[dict[str, Any]],
    keys: dict[str, str],
) -> dict[str, Any] | None:
    """Resolve an instance_id to a full config dict ready for profile storage."""
    instance = next((i for i in instances if i.get("id") == instance_id), None)
    if not instance:
        return None
    catalog_id = str(instance.get("catalog_id") or "")
    instance_type = str(instance.get("type") or "").strip().lower()
    wanted_type = str(requested_type or "").strip().lower()
    effective_type = wanted_type if _instance_supports_type(instance, wanted_type) else instance_type
    if effective_type not in {"llm", "tts", "stt"}:
        effective_type = "llm"
    catalog_entry = next((c for c in catalog if c.get("id") == catalog_id), None)

    # Get type-specific config from catalog
    type_cfg: dict[str, Any] = {}
    if catalog_entry:
        tc = catalog_entry.get(f"{effective_type}_config")
        if isinstance(tc, dict):
            type_cfg = tc
        elif catalog_entry.get("endpoint_path"):
            # Backward compat: old flat catalog format
            type_cfg = {
                "endpoint_path": catalog_entry.get("endpoint_path", ""),
                "model": catalog_entry.get("model", ""),
                "api_key_slot": catalog_entry.get("api_key_slot", ""),
                "language": catalog_entry.get("language", ""),
                "voice_id": catalog_entry.get("voice_id", ""),
                "text_field_name": catalog_entry.get("text_field_name", ""),
                "custom_headers": _dict(catalog_entry.get("custom_headers")),
                "custom_body_params": _dict(catalog_entry.get("custom_body_params")),
                "custom_query_params": _dict(catalog_entry.get("custom_query_params")),
            }

    config: dict[str, Any] = {
        "provider": catalog_id,
        "provider_instance_id": instance_id,
        "base_url": str((catalog_entry or {}).get("base_url") or ""),
        "endpoint_path": str(type_cfg.get("endpoint_path") or ""),
        "models_path": str((catalog_entry or {}).get("models_path") or ""),
        "model": str(type_cfg.get("model") or ""),
        "language": str(type_cfg.get("language") or ""),
        "voice_id": str(type_cfg.get("voice_id") or ""),
        "text_field_name": str(type_cfg.get("text_field_name") or ""),
        "custom_headers": _dict(type_cfg.get("custom_headers")),
        "custom_body_params": _dict(type_cfg.get("custom_body_params")),
        "custom_query_params": _dict(type_cfg.get("custom_query_params")),
    }
    # Instance overrides
    for f in ("model", "language", "voice_id", "text_field_name"):
        v = str(instance.get(f) or "").strip()
        if v:
            config[f] = v
    for f in ("custom_headers", "custom_body_params", "custom_query_params"):
        v = _dict(instance.get(f))
        if v:
            config[f] = v
    # Resolve API key: prefer instance api_key_id, fallback to catalog type slot
    api_key_id = str(instance.get("api_key_id") or "").strip()
    if not api_key_id:
        api_key_id = str(type_cfg.get("api_key_slot") or "").strip()
    config["api_key_id"] = api_key_id
    config["api_key"] = str(keys.get(api_key_id) or "").strip() if api_key_id else ""
    return config


def _known_provider_slot_map() -> dict[str, list[str]]:
    slot_map: dict[str, list[str]] = {}
    for item in KNOWN_PROVIDER_CATALOG:
        provider_id = str(item.get("id") or "").strip()
        slot = str(item.get("api_key_slot") or "").strip()
        if provider_id:
            bucket = slot_map.setdefault(provider_id, [])
            if slot and slot not in bucket:
                bucket.append(slot)
    return slot_map


def _group_known_providers(
    *,
    provider_catalog: dict[str, list[dict[str, Any]]],
    keys: dict[str, str],
) -> list[dict[str, Any]]:
    grouped: dict[str, dict[str, Any]] = {}
    for scope in ("llm", "tts", "stt"):
        for item in provider_catalog.get(scope, []):
            if str(item.get("source")) != "known":
                continue
            provider_id = str(item.get("id") or "").strip().lower()
            if not provider_id:
                continue
            current = grouped.get(provider_id)
            slot = str(item.get("api_key_slot") or "").strip()
            masked = ""
            value = str(keys.get(slot) or "").strip()
            if value:
                masked = f"{value[:4]}...{value[-4:]}" if len(value) > 8 else "********"
            if current is None:
                current = {
                    "id": provider_id,
                    "name": str(item.get("name") or provider_id),
                    "types": [],
                    "api_key_slots": [],
                    "bound_key_slot": "",
                    "bound_key_masked": "",
                    "base_url": str(item.get("base_url") or ""),
                    "endpoint_path": str(item.get("endpoint_path") or ""),
                    "models_path": str(item.get("models_path") or ""),
                    "model": str(item.get("model") or ""),
                }
                grouped[provider_id] = current
            if scope not in current["types"]:
                current["types"].append(scope)
            if slot and slot not in current["api_key_slots"]:
                current["api_key_slots"].append(slot)
            if masked and not current["bound_key_masked"]:
                current["bound_key_masked"] = masked
                current["bound_key_slot"] = slot

    rows = list(grouped.values())
    for row in rows:
        row["types"].sort()
        row["api_key_slots"].sort()
    rows.sort(key=lambda r: str(r.get("name") or "").lower())
    return rows


def _provider_form_config(provider_type: str, form: Any, current: dict[str, Any] | None = None) -> dict[str, Any]:
    def _json_map(value: Any) -> dict[str, Any]:
        raw = str(value or "").strip()
        if not raw:
            return {}
        try:
            parsed = json.loads(raw)
        except Exception:
            return {}
        return _dict(parsed)

    base: dict[str, Any] = {
        "base_url": str((form.get("base_url") if form else None) or (current or {}).get("base_url") or "").strip(),
        "endpoint_path": str((form.get("endpoint_path") if form else None) or (current or {}).get("endpoint_path") or "").strip(),
        "models_path": str((form.get("models_path") if form else None) or (current or {}).get("models_path") or "").strip(),
        "api_key_id": str((form.get("api_key_id") if form else None) or (current or {}).get("api_key_id") or "").strip(),
    }
    if provider_type == "llm":
        base.update(
            {
                "model": str((form.get("model") if form else None) or (current or {}).get("model") or "").strip(),
                "custom_headers": _dict((current or {}).get("custom_headers")),
                "custom_body_params": _dict((current or {}).get("custom_body_params")),
            }
        )
        base["custom_headers"] = _json_map(form.get("custom_headers")) if form else base["custom_headers"]
        base["custom_body_params"] = _json_map(form.get("custom_body_params")) if form else base["custom_body_params"]
    elif provider_type == "tts":
        base.update(
            {
                "model": str((form.get("model") if form else None) or (current or {}).get("model") or "").strip(),
                "language": str((form.get("language") if form else None) or (current or {}).get("language") or "").strip(),
                "voice_id": str((form.get("voice_id") if form else None) or (current or {}).get("voice_id") or "").strip(),
                "text_field_name": str((form.get("text_field_name") if form else None) or (current or {}).get("text_field_name") or "").strip(),
                "custom_headers": _dict((current or {}).get("custom_headers")),
                "custom_body_params": _dict((current or {}).get("custom_body_params")),
            }
        )
        base["custom_headers"] = _json_map(form.get("custom_headers")) if form else base["custom_headers"]
        base["custom_body_params"] = _json_map(form.get("custom_body_params")) if form else base["custom_body_params"]
    elif provider_type == "stt":
        base.update(
            {
                "model": str((form.get("model") if form else None) or (current or {}).get("model") or "").strip(),
                "language": str((form.get("language") if form else None) or (current or {}).get("language") or "").strip(),
                "custom_headers": _dict((current or {}).get("custom_headers")),
                "custom_body_params": _dict((current or {}).get("custom_body_params")),
                "custom_query_params": _dict((current or {}).get("custom_query_params")),
            }
        )
        base["custom_headers"] = _json_map(form.get("custom_headers")) if form else base["custom_headers"]
        base["custom_body_params"] = _json_map(form.get("custom_body_params")) if form else base["custom_body_params"]
        base["custom_query_params"] = _json_map(form.get("custom_query_params")) if form else base["custom_query_params"]
    return base


def _default_custom_provider_form() -> dict[str, str]:
    return {
        "provider_type": "llm",
        "provider_types_csv": "llm",
        "provider_name": "",
        "base_url": "",
        "endpoint_path": "",
        "models_path": "",
        "model": "",
        "language": "",
        "voice_id": "",
        "text_field_name": "",
        "api_key_id": "",
        "custom_headers_json": "{}",
        "custom_body_params_json": "{}",
        "custom_query_params_json": "{}",
        "import_curl_raw": "",
    }


def _provider_type_from_curl(parsed: dict[str, Any]) -> str:
    endpoint_path = str(parsed.get("endpoint_path") or "").strip().lower()
    fingerprint = f"{str(parsed.get('base_url') or '')} {endpoint_path}".lower()
    if "transcri" in fingerprint or "listen" in endpoint_path or "speech:recognize" in endpoint_path:
        return "stt"
    if "speech" in fingerprint or "/audio/" in endpoint_path or "text-to-speech" in endpoint_path:
        return "tts"
    return "llm"


def _provider_name_from_curl(parsed: dict[str, Any], provider_type: str) -> str:
    host = str(urlparse(str(parsed.get("base_url") or "")).netloc or "").strip().lower()
    host = host.split(":", 1)[0]
    if host.startswith("api."):
        host = host[4:]
    stem = host.split(".", 1)[0] if host else ""
    name_seed = stem.replace("-", " ").replace("_", " ").strip()
    if name_seed:
        return " ".join(part.capitalize() for part in name_seed.split())
    return f"Imported {provider_type.upper()} Provider"


def _build_custom_provider_form_from_curl(raw_curl: str, existing: dict[str, str] | None = None) -> tuple[dict[str, str], str]:
    form_values = _default_custom_provider_form()
    if existing:
        form_values.update({k: str(v) for k, v in existing.items() if isinstance(k, str)})
    raw = str(raw_curl or "").strip()
    form_values["import_curl_raw"] = raw
    parsed = parse_curl_command(raw)
    if not parsed:
        return form_values, "Could not parse cURL command"

    provider_type = _provider_type_from_curl(parsed)
    custom_headers = _string_map(parsed.get("custom_headers"))
    custom_body_params = _string_map(parsed.get("custom_body_params"))
    custom_query_params: dict[str, str] = {}
    model = str(parsed.get("model") or "").strip()
    language = ""
    voice_id = str(parsed.get("voice_id") or "").strip()
    text_field_name = str(parsed.get("text_field_name") or "").strip()

    if provider_type == "tts":
        if not voice_id:
            voice_id = str(custom_body_params.get("voice") or "").strip()
        if voice_id:
            custom_body_params.pop("voice", None)
        language = str(custom_body_params.get("language") or "").strip()
        if language:
            custom_body_params.pop("language", None)
        if not text_field_name:
            text_field_name = "input"
    elif provider_type == "stt":
        language = str(custom_body_params.get("language") or "").strip()

    endpoint_path = str(parsed.get("endpoint_path") or "").strip()
    if not endpoint_path:
        endpoint_path = {
            "llm": "/v1/chat/completions",
            "tts": "/v1/audio/speech",
            "stt": "/v1/audio/transcriptions",
        }.get(provider_type, "/v1/chat/completions")

    form_values.update(
        {
            "provider_type": provider_type,
            "provider_types_csv": provider_type,
            "provider_name": _provider_name_from_curl(parsed, provider_type),
            "base_url": str(parsed.get("base_url") or "").strip(),
            "endpoint_path": endpoint_path,
            "models_path": "/v1/models",
            "model": model,
            "language": language,
            "voice_id": voice_id,
            "text_field_name": text_field_name if provider_type == "tts" else "",
            "api_key_id": "",
            "custom_headers_json": json.dumps(custom_headers, ensure_ascii=True),
            "custom_body_params_json": json.dumps(custom_body_params, ensure_ascii=True),
            "custom_query_params_json": json.dumps(custom_query_params, ensure_ascii=True),
        }
    )
    return form_values, "cURL parsed. Review fields, choose API key binding, then save."


def _normalize_provider_types(values: list[str]) -> list[str]:
    ordered: list[str] = []
    for candidate in values:
        t = str(candidate or "").strip().lower()
        if t in {"llm", "tts", "stt"} and t not in ordered:
            ordered.append(t)
    return ordered


def _default_type_config_for_catalog_entry(catalog_id: str, provider_type: str) -> dict[str, Any]:
    for row in KNOWN_PROVIDER_CATALOG:
        if str(row.get("id") or "").strip() == catalog_id and str(row.get("type") or "").strip().lower() == provider_type:
            return {
                "endpoint_path": str(row.get("endpoint_path") or ""),
                "model": str(row.get("model") or ""),
                "api_key_slot": str(row.get("api_key_slot") or ""),
                "language": str(row.get("language") or ""),
                "voice_id": str(row.get("voice_id") or ""),
                "text_field_name": str(row.get("text_field_name") or ""),
                "custom_headers": _dict(row.get("custom_headers")),
                "custom_body_params": _dict(row.get("custom_body_params")),
                "custom_query_params": _dict(row.get("custom_query_params")),
            }
    return {
        "endpoint_path": "",
        "model": "",
        "api_key_slot": "",
        "language": "",
        "voice_id": "",
        "text_field_name": "",
        "custom_headers": {},
        "custom_body_params": {},
        "custom_query_params": {},
    }


async def _strip_custom_provider_snapshot_fields(
    *,
    access_token: str,
    payload: dict[str, Any],
) -> dict[str, Any]:
    status, settings_payload = await api_request(
        api_base_url=settings.api_base_url,
        method="GET",
        path="/v1/admin/livekit/agent-settings/default",
        access_token=access_token,
    )
    if status != 200 or not isinstance(settings_payload, dict) or not isinstance(settings_payload.get("data"), dict):
        return payload

    settings_data = _dict(settings_payload.get("data"))
    tts_cfg = _dict(settings_data.get("ttsConfig"))
    custom = _extract_custom_providers(tts_cfg)
    custom_ids_by_type: dict[str, set[str]] = {"llm": set(), "tts": set(), "stt": set()}
    for item in custom:
        provider_type = str(item.get("type") or "").strip().lower()
        provider_id = str(item.get("id") or "").strip()
        if provider_type in custom_ids_by_type and provider_id:
            custom_ids_by_type[provider_type].add(provider_id)

    llm_cfg = _dict(payload.get("llm_config"))
    llm_provider = str(llm_cfg.get("provider") or "").strip()
    if llm_provider and llm_provider in custom_ids_by_type["llm"]:
        llm_cfg["base_url"] = ""
        llm_cfg["endpoint_path"] = "/v1/chat/completions"
        llm_cfg["model"] = ""
        llm_cfg["custom_headers"] = {}
        llm_cfg["custom_body_params"] = {}
        payload["llm_config"] = llm_cfg

    tts_cfg_payload = _dict(payload.get("tts_config"))
    tts_provider = str(tts_cfg_payload.get("provider") or "").strip()
    if tts_provider and tts_provider in custom_ids_by_type["tts"]:
        tts_cfg_payload["base_url"] = ""
        tts_cfg_payload["endpoint_path"] = "/v1/audio/speech"
        tts_cfg_payload["models_path"] = "/v1/models"
        tts_cfg_payload["model"] = ""
        tts_cfg_payload["voice_id"] = ""
        tts_cfg_payload["text_field_name"] = "input"
        tts_cfg_payload["custom_headers"] = {}
        tts_cfg_payload["custom_body_params"] = {}
        payload["tts_config"] = tts_cfg_payload

    stt_cfg_payload = _dict(payload.get("stt_config"))
    stt_provider = str(stt_cfg_payload.get("provider") or "").strip()
    if stt_provider and stt_provider in custom_ids_by_type["stt"]:
        stt_cfg_payload["base_url"] = ""
        stt_cfg_payload["endpoint_path"] = "/v1/audio/transcriptions"
        stt_cfg_payload["models_path"] = "/v1/models"
        stt_cfg_payload["model"] = ""
        stt_cfg_payload["custom_headers"] = {}
        stt_cfg_payload["custom_body_params"] = {}
        stt_cfg_payload["custom_query_params"] = {}
        payload["stt_config"] = stt_cfg_payload

    return payload


def _provider_key_scope_and_provider(key_id: str) -> tuple[str, str]:
    parts = str(key_id or "").split(".")
    if len(parts) >= 2:
        return parts[0].lower(), parts[1].lower()
    return "", "custom"


def _provider_api_key_select_options(keys: dict[str, str]) -> list[dict[str, str]]:
    options: list[dict[str, str]] = []
    for entry in _provider_api_key_entries(keys):
        scope, provider = _provider_key_scope_and_provider(entry.get("id", ""))
        if scope not in {"llm", "tts", "stt"}:
            continue
        options.append(
            {
                "id": str(entry.get("id") or ""),
                "section": scope,
                "provider": provider,
                "label": f"{entry.get('label', '')} ({entry.get('masked', '********')})",
                "value": str(entry.get("value") or ""),
            }
        )
    return options


async def _load_provider_api_keys(access_token: str) -> dict[str, str]:
    status, payload = await api_request(
        api_base_url=settings.api_base_url,
        method="GET",
        path="/v1/admin/livekit/agent-settings/default",
        access_token=access_token,
    )
    keys = _default_provider_api_keys()
    if status == 200 and isinstance(payload, dict) and isinstance(payload.get("data"), dict):
        settings_data = _dict(payload.get("data"))
        tts_cfg = _dict(settings_data.get("ttsConfig"))
        return _extract_provider_api_keys_from_tts_config(tts_cfg)
    return keys


async def _resolve_api_key_from_id(
    *,
    access_token: str,
    explicit_api_key: str,
    api_key_id: str,
) -> str:
    key_id = str(api_key_id or "").strip()
    if key_id:
        provider_keys = await _load_provider_api_keys(access_token)
        resolved = str(provider_keys.get(key_id) or "").strip()
        if resolved:
            return resolved
    return str(explicit_api_key or "").strip()


async def _apply_selected_api_keys(
    *,
    access_token: str,
    payload: dict[str, Any],
) -> dict[str, Any]:
    status, settings_payload = await api_request(
        api_base_url=settings.api_base_url,
        method="GET",
        path="/v1/admin/livekit/agent-settings/default",
        access_token=access_token,
    )
    instances: list[dict[str, Any]] = []
    catalog: list[dict[str, Any]] = []
    provider_keys = _default_provider_api_keys()
    if status == 200 and isinstance(settings_payload, dict) and isinstance(settings_payload.get("data"), dict):
        settings_data = _dict(settings_payload["data"])
        tts_cfg = _auto_migrate_to_instances(_dict(settings_data.get("ttsConfig")))
        instances = _extract_provider_instances(tts_cfg)
        catalog = _extract_catalog_providers(tts_cfg)
        provider_keys = _extract_provider_api_keys_from_tts_config(tts_cfg)

    for section in ("llm_config", "tts_config", "stt_config"):
        cfg = _dict(payload.get(section))
        instance_id = str(cfg.get("provider_instance_id") or "").strip()
        requested_type = section.split("_", 1)[0]
        if instance_id:
            resolved = _resolve_provider_instance(
                instance_id=instance_id,
                requested_type=requested_type,
                instances=instances,
                catalog=catalog,
                keys=provider_keys,
            )
            if resolved:
                merged = dict(cfg)
                merged.update(resolved)
                payload[section] = merged
        else:
            # Backward compat: resolve by api_key_id
            key_id = str(cfg.get("api_key_id") or "").strip()
            if key_id:
                resolved_key = str(provider_keys.get(key_id) or "").strip()
                if resolved_key:
                    cfg["api_key"] = resolved_key
            payload[section] = cfg
    return payload


async def _editor_panel_context(
    *,
    access_token: str,
    profile: dict[str, Any] | None,
    message: str | None,
) -> dict[str, Any]:
    provider_keys = _default_provider_api_keys()
    provider_catalog: dict[str, list[dict[str, Any]]] = {"llm": [], "tts": [], "stt": []}
    provider_instances: list[dict[str, Any]] = []
    status, payload = await api_request(
        api_base_url=settings.api_base_url,
        method="GET",
        path="/v1/admin/livekit/agent-settings/default",
        access_token=access_token,
    )
    if status == 200 and isinstance(payload, dict) and isinstance(payload.get("data"), dict):
        settings_data = _dict(payload.get("data"))
        tts_cfg = _auto_migrate_to_instances(_dict(settings_data.get("ttsConfig")))
        provider_keys = _extract_provider_api_keys_from_tts_config(tts_cfg)
        provider_catalog = _provider_catalog_from_tts_config(tts_cfg, provider_keys)
        provider_instances = _extract_provider_instances(tts_cfg)
    llm_provider_instances = [i for i in provider_instances if _instance_supports_type(i, "llm")]
    tts_provider_instances = [i for i in provider_instances if _instance_supports_type(i, "tts")]
    stt_provider_instances = [i for i in provider_instances if _instance_supports_type(i, "stt")]
    return {
        "profile": profile,
        "message": message,
        "provider_api_key_options": _provider_api_key_select_options(provider_keys),
        "provider_catalog": provider_catalog,
        "provider_instances": provider_instances,
        "llm_provider_instances": llm_provider_instances,
        "tts_provider_instances": tts_provider_instances,
        "stt_provider_instances": stt_provider_instances,
    }


async def _direct_llm_test(
    *,
    llm_cfg: dict[str, Any],
    prompt: str,
) -> tuple[bool, str, str | None]:
    base_url = str(llm_cfg.get("base_url") or "").strip()
    endpoint_path = str(llm_cfg.get("endpoint_path") or "/v1/chat/completions").strip() or "/v1/chat/completions"
    if not base_url:
        return False, "LLM Base URL is required", None

    url = f"{base_url.rstrip('/')}{endpoint_path}"
    api_key = str(llm_cfg.get("api_key") or "").strip()
    custom_headers = _string_map(llm_cfg.get("custom_headers"))
    custom_body_params = _dict(llm_cfg.get("custom_body_params"))
    model = str(llm_cfg.get("model") or "").strip()

    headers: dict[str, str] = dict(custom_headers)
    if api_key and "Authorization" not in headers and "authorization" not in headers and "x-api-key" not in headers:
        headers["Authorization"] = f"Bearer {api_key}"

    body: dict[str, Any] = dict(custom_body_params)
    if model and "model" not in body:
        body["model"] = model

    # Anthropic-style endpoint compatibility.
    if endpoint_path.rstrip("/").endswith("/messages"):
        if "messages" not in body:
            body["messages"] = [{"role": "user", "content": prompt}]
        body.setdefault("max_tokens", 128)
    else:
        if "messages" not in body:
            body["messages"] = [{"role": "user", "content": prompt}]

    try:
        timeout = aiohttp.ClientTimeout(total=30)
        async with aiohttp.ClientSession(timeout=timeout) as session:
            async with session.post(url, json=body, headers=headers) as upstream:
                text = await upstream.text()
                if upstream.status >= 400:
                    compact = re.sub(r"\s+", " ", text).strip()[:240]
                    return False, f"Provider returned {upstream.status}", compact or None
                return True, f"Provider responded with status {upstream.status}.", None
    except Exception as err:
        return False, "LLM request failed", str(err)


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


@app.get("/", include_in_schema=False)
async def root_redirect() -> RedirectResponse:
    return RedirectResponse(url="/dashboard/login", status_code=307)


@app.get("/login", include_in_schema=False)
async def login_redirect() -> RedirectResponse:
    return RedirectResponse(url="/dashboard/login", status_code=307)


@app.get("/favicon.ico", include_in_schema=False)
async def favicon_no_content() -> Response:
    return Response(status_code=204)


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

    response = RedirectResponse(url="/dashboard/assistants", status_code=303)
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


@app.get("/dashboard/assistants", response_class=HTMLResponse)
async def dashboard_assistants(request: Request):
    access_token, refresh_response = await ensure_access_token(request=request, api_base_url=settings.api_base_url)
    if refresh_response is not None:
        return refresh_response
    profiles, error_message = await _fetch_profiles(access_token)
    selected_profile_id = str(request.query_params.get("profileId") or "").strip() or ""
    if not selected_profile_id and profiles:
        active_profile = next((p for p in profiles if bool(p.get("is_active"))), None)
        selected_profile_id = str((active_profile or profiles[0]).get("id") or "")

    initial_profile: dict[str, Any] | None = None
    initial_message: str | None = None
    if selected_profile_id:
        if _is_uuid(selected_profile_id):
            status, payload = await api_request(
                api_base_url=settings.api_base_url,
                method="GET",
                path=f"/v1/admin/agent-profiles/{selected_profile_id}",
                access_token=access_token,
            )
            if status == 200 and isinstance(payload, dict):
                initial_profile = payload.get("data") if isinstance(payload.get("data"), dict) else None
            elif status != 404:
                initial_message = extract_error_message(payload, "Failed to load profile")
        if initial_profile is None:
            legacy_status, legacy_payload = await api_request(
                api_base_url=settings.api_base_url,
                method="GET",
                path=f"/v1/admin/livekit/agent-settings/{selected_profile_id}",
                access_token=access_token,
            )
            if legacy_status == 200 and isinstance(legacy_payload, dict) and isinstance(legacy_payload.get("data"), dict):
                initial_profile = _legacy_settings_to_profile(selected_profile_id, legacy_payload["data"])
            elif legacy_status != 404 and initial_message is None:
                initial_message = extract_error_message(legacy_payload, "Failed to load profile")

    panel_context = await _editor_panel_context(
        access_token=access_token,
        profile=initial_profile,
        message=initial_message or error_message,
    )
    return templates.TemplateResponse(
        request=request,
        name="profiles/index.html",
        context={
            "profiles": profiles,
            "message": panel_context.get("message"),
            "selected_profile_id": selected_profile_id,
            "profile": panel_context.get("profile"),
            "provider_api_key_options": panel_context.get("provider_api_key_options"),
            "provider_catalog": panel_context.get("provider_catalog"),
            "provider_instances": panel_context.get("provider_instances"),
            "llm_provider_instances": panel_context.get("llm_provider_instances"),
            "tts_provider_instances": panel_context.get("tts_provider_instances"),
            "stt_provider_instances": panel_context.get("stt_provider_instances"),
        },
    )


@app.get("/dashboard/profiles", include_in_schema=False)
async def dashboard_profiles_redirect() -> RedirectResponse:
    return RedirectResponse(url="/dashboard/assistants", status_code=303)


async def _render_placeholder_page(
    request: Request,
    *,
    page_title: str,
    page_description: str,
) -> HTMLResponse:
    access_token, refresh_response = await ensure_access_token(request=request, api_base_url=settings.api_base_url)
    if refresh_response is not None:
        return refresh_response
    return templates.TemplateResponse(
        request=request,
        name="_placeholder.html",
        context={
            "page_title": page_title,
            "page_description": page_description,
            "access_token": access_token,
        },
    )


@app.get("/dashboard/tools", response_class=HTMLResponse)
async def dashboard_tools_page(request: Request):
    return await _render_placeholder_page(
        request,
        page_title="Tools",
        page_description="Manage reusable tools, webhooks, and integrations for assistants.",
    )


@app.get("/dashboard/phone-numbers", response_class=HTMLResponse)
async def dashboard_phone_numbers_page(request: Request):
    return await _render_placeholder_page(
        request,
        page_title="Phone Numbers",
        page_description="Manage call entry numbers and routing targets for your assistants.",
    )


@app.get("/dashboard/org/api-keys", response_class=HTMLResponse)
async def dashboard_api_keys_page(request: Request):
    access_token, refresh_response = await ensure_access_token(request=request, api_base_url=settings.api_base_url)
    if refresh_response is not None:
        return refresh_response

    status, payload = await api_request(
        api_base_url=settings.api_base_url,
        method="GET",
        path="/v1/admin/livekit/agent-settings/default",
        access_token=access_token,
    )
    keys = _default_provider_api_keys()
    message: str | None = None
    if status == 200 and isinstance(payload, dict) and isinstance(payload.get("data"), dict):
        settings_data = payload.get("data") or {}
        tts_cfg = _dict(_dict(settings_data).get("ttsConfig"))
        keys = _extract_provider_api_keys_from_tts_config(tts_cfg)
    elif status != 404:
        message = extract_error_message(payload, "Failed to load API keys")

    return templates.TemplateResponse(
        request=request,
        name="api_keys/index.html",
        context={
            "entries": _provider_api_key_entries(keys),
            "provider_options": _provider_api_key_options(),
            "message": message,
            "show_add_form": False,
        },
    )


@app.post("/dashboard/org/api-keys", response_class=HTMLResponse)
async def dashboard_api_keys_save(request: Request):
    access_token, refresh_response = await ensure_access_token(request=request, api_base_url=settings.api_base_url)
    if refresh_response is not None:
        return refresh_response

    form = await request.form()

    # Load current default settings and merge providerApiKeys without clobbering unrelated config.
    status, payload = await api_request(
        api_base_url=settings.api_base_url,
        method="GET",
        path="/v1/admin/livekit/agent-settings/default",
        access_token=access_token,
    )

    existing_data: dict[str, Any] = {}
    if status == 200 and isinstance(payload, dict) and isinstance(payload.get("data"), dict):
        existing_data = _dict(payload.get("data"))

    tts_cfg = _dict(existing_data.get("ttsConfig"))
    keys = _extract_provider_api_keys_from_tts_config(tts_cfg)
    action = str(form.get("action") or "").strip().lower()
    provider_id = str(form.get("provider_id") or "").strip()
    provider_key = str(form.get("provider_key") or "").strip()
    api_key_name = str(form.get("api_key_name") or "").strip()
    provider_scope = str(form.get("provider_scope") or "").strip().lower()
    provider_name = str(form.get("provider_name") or "").strip()
    show_add_form = False

    # Backward compatibility: full-map save via provider_keys.* form fields.
    posted_bulk = False
    for key in keys.keys():
        field = f"provider_keys.{key}"
        if field in form:
            keys[key] = str(form.get(field) or "").strip()
            posted_bulk = True

    message: str
    if posted_bulk and not action:
        message = "API keys saved"
    else:
        if action not in {"add", "update", "delete"}:
            action = "add"
        known_base_ids = set(_default_provider_api_keys().keys())
        canonical_provider_id = _canonical_provider_id(provider_id)
        if action == "add":
            if provider_id == "__new_custom_provider__":
                if provider_scope not in {"llm", "tts", "stt"}:
                    message = "Please select provider type"
                    show_add_form = True
                    canonical_provider_id = ""
                elif not provider_name:
                    message = "Provider name is required"
                    show_add_form = True
                    canonical_provider_id = ""
                else:
                    canonical_provider_id = f"{provider_scope}.custom"
                    if not api_key_name:
                        api_key_name = provider_name
            if show_add_form:
                pass
            elif canonical_provider_id not in known_base_ids:
                message = "Please select a valid provider"
                show_add_form = True
            elif not provider_key:
                message = "API key cannot be empty"
                show_add_form = True
            else:
                storage_id = canonical_provider_id
                if api_key_name:
                    slug = re.sub(r"[^a-zA-Z0-9_-]+", "-", api_key_name).strip("-").lower()
                    if slug:
                        storage_id = f"{canonical_provider_id}.{slug}"
                keys[storage_id] = provider_key
                message = "API key saved"
        elif action == "update":
            if provider_id not in keys:
                message = "Provider key entry not found"
                show_add_form = True
            elif not provider_key:
                message = "API key cannot be empty"
                show_add_form = True
            else:
                keys[provider_id] = provider_key
                message = "API key saved"
        elif action == "delete":
            if provider_id in keys:
                keys[provider_id] = ""
            message = "API key removed"
        else:
            message = "Unsupported action"
            show_add_form = True

    tts_cfg = _dict(existing_data.get("ttsConfig"))
    tts_cfg["providerApiKeys"] = keys

    put_status, put_payload = await api_request(
        api_base_url=settings.api_base_url,
        method="PUT",
        path="/v1/admin/livekit/agent-settings/default",
        access_token=access_token,
        json_body={"agentName": str(existing_data.get("agentName") or "coziyoo-agent"), "ttsConfig": tts_cfg},
    )

    if put_status not in {200, 201}:
        message = extract_error_message(put_payload, "Failed to save API keys")
        show_add_form = True
    return templates.TemplateResponse(
        request=request,
        name="api_keys/index.html",
        context={
            "entries": _provider_api_key_entries(keys),
            "provider_options": _provider_api_key_options(),
            "message": message,
            "show_add_form": show_add_form,
        },
        status_code=200,
    )


def _default_instance_form() -> dict[str, str]:
    return {
        "instance_name": "",
        "catalog_id": "",
        "instance_types": "",
        "api_key_id": "",
        "model": "",
        "language": "",
        "voice_id": "",
        "text_field_name": "",
        "custom_headers_json": "{}",
        "custom_body_params_json": "{}",
        "custom_query_params_json": "{}",
    }


@app.get("/dashboard/providers", response_class=HTMLResponse)
async def dashboard_custom_providers_page(request: Request):
    access_token, refresh_response = await ensure_access_token(request=request, api_base_url=settings.api_base_url)
    if refresh_response is not None:
        return refresh_response

    status, payload = await api_request(
        api_base_url=settings.api_base_url,
        method="GET",
        path="/v1/admin/livekit/agent-settings/default",
        access_token=access_token,
    )
    catalog_providers: list[dict[str, Any]] = []
    provider_instances: list[dict[str, Any]] = []
    provider_api_key_options: list[dict[str, str]] = []
    message: str | None = None
    if status == 200 and isinstance(payload, dict) and isinstance(payload.get("data"), dict):
        settings_data = _dict(payload.get("data"))
        tts_cfg = _auto_migrate_to_instances(_dict(settings_data.get("ttsConfig")))
        keys = _extract_provider_api_keys_from_tts_config(tts_cfg)
        catalog_providers = _extract_catalog_providers(tts_cfg)
        provider_instances = _extract_provider_instances(tts_cfg)
        provider_api_key_options = _provider_api_key_select_options(keys)
    elif status != 404:
        message = extract_error_message(payload, "Failed to load providers")

    active_tab = str(request.query_params.get("tab") or "instances").strip()
    return templates.TemplateResponse(
        request=request,
        name="providers/index.html",
        context={
            "catalog_providers": catalog_providers,
            "provider_instances": provider_instances,
            "provider_api_key_options": provider_api_key_options,
            "message": message,
            "active_tab": active_tab,
            "add_instance_form": _default_instance_form(),
            "add_catalog_form": _default_custom_provider_form(),
            "show_add_instance_form": False,
            "show_add_catalog_form": False,
        },
    )


@app.post("/dashboard/providers/instances", response_class=HTMLResponse)
async def dashboard_provider_instances_save(request: Request):
    access_token, refresh_response = await ensure_access_token(request=request, api_base_url=settings.api_base_url)
    if refresh_response is not None:
        return refresh_response

    form = await request.form()
    status, payload = await api_request(
        api_base_url=settings.api_base_url,
        method="GET",
        path="/v1/admin/livekit/agent-settings/default",
        access_token=access_token,
    )
    existing_data: dict[str, Any] = {}
    if status == 200 and isinstance(payload, dict) and isinstance(payload.get("data"), dict):
        existing_data = _dict(payload.get("data"))

    tts_cfg = _auto_migrate_to_instances(_dict(existing_data.get("ttsConfig")))
    instances = _extract_provider_instances(tts_cfg)
    catalog = _extract_catalog_providers(tts_cfg)
    keys = _extract_provider_api_keys_from_tts_config(tts_cfg)
    by_id = {i["id"]: i for i in instances}

    action = str(form.get("action") or "add").strip().lower()
    message = "Saved"
    show_add_instance_form = False
    add_instance_form = _default_instance_form()

    def _parse_instance_form(form: Any, current: dict[str, Any] | None = None) -> dict[str, Any]:
        def _json_map(value: Any) -> dict[str, Any]:
            raw = str(value or "").strip()
            if not raw:
                return {}
            try:
                return _dict(json.loads(raw))
            except Exception:
                return {}
        cur = current or {}
        return {
            "model": str(form.get("model") or cur.get("model") or "").strip(),
            "language": str(form.get("language") or cur.get("language") or "").strip(),
            "voice_id": str(form.get("voice_id") or cur.get("voice_id") or "").strip(),
            "text_field_name": str(form.get("text_field_name") or cur.get("text_field_name") or "").strip(),
            "api_key_id": str(form.get("api_key_id") or cur.get("api_key_id") or "").strip(),
            "custom_headers": _json_map(form.get("custom_headers")) or _dict(cur.get("custom_headers")),
            "custom_body_params": _json_map(form.get("custom_body_params")) or _dict(cur.get("custom_body_params")),
            "custom_query_params": _json_map(form.get("custom_query_params")) or _dict(cur.get("custom_query_params")),
        }

    if action == "delete":
        instance_id = str(form.get("instance_id") or "").strip()
        instances = [i for i in instances if i.get("id") != instance_id]
        message = "Provider instance removed"
    elif action == "update":
        instance_id = str(form.get("instance_id") or "").strip()
        current = by_id.get(instance_id)
        if not current:
            message = "Instance not found"
        else:
            instance_name = str(form.get("instance_name") or current.get("name") or "").strip()
            if not instance_name:
                message = "Instance name is required"
            else:
                cfg = _parse_instance_form(form, current)
                catalog_id = str(current.get("catalog_id") or "")
                catalog_entry = next((c for c in catalog if c.get("id") == catalog_id), None)
                catalog_types = [str(t) for t in ((catalog_entry or {}).get("types") or current.get("types") or []) if str(t) in {"llm", "tts", "stt"}]
                if not catalog_types:
                    fallback_type = str(current.get("type") or "llm")
                    catalog_types = [fallback_type]
                current.update({"name": instance_name, "type": catalog_types[0], "types": catalog_types, **cfg})
                message = "Provider instance updated"
    else:
        # add
        catalog_id = str(form.get("catalog_id") or "").strip()
        instance_name = str(form.get("instance_name") or "").strip()
        catalog_entry = next((c for c in catalog if c.get("id") == catalog_id), None)
        if not catalog_entry:
            message = "Please select a provider from the catalog"
            show_add_instance_form = True
        elif not instance_name:
            message = "Instance name is required"
            show_add_instance_form = True
        else:
            catalog_types = catalog_entry.get("types") or []
            if not catalog_types and catalog_entry.get("type"):
                catalog_types = [str(catalog_entry["type"]).strip().lower()]
            catalog_types = [str(t) for t in catalog_types if str(t) in {"llm", "tts", "stt"}]
            if not catalog_types:
                catalog_types = ["llm"]
            base_id = _slugify(instance_name) or f"{catalog_id}-instance"
            instance_id = base_id
            counter = 2
            existing_ids = {i["id"] for i in instances}
            while instance_id in existing_ids:
                instance_id = f"{base_id}-{counter}"
                counter += 1
            cfg = _parse_instance_form(form)
            # Inherit defaults from first available catalog type-specific config if not overridden.
            type_defaults: dict[str, Any] = {}
            for t in catalog_types:
                tc = catalog_entry.get(f"{t}_config")
                if isinstance(tc, dict):
                    type_defaults = tc
                    break
            if not type_defaults and catalog_entry.get("endpoint_path"):
                type_defaults = catalog_entry
            if not cfg["model"]:
                cfg["model"] = str(type_defaults.get("model") or "")
            if not cfg["language"]:
                cfg["language"] = str(type_defaults.get("language") or "")
            if not cfg["voice_id"]:
                cfg["voice_id"] = str(type_defaults.get("voice_id") or "")
            if not cfg["text_field_name"]:
                cfg["text_field_name"] = str(type_defaults.get("text_field_name") or "")
            instances.append({
                "id": instance_id,
                "name": instance_name,
                "catalog_id": catalog_id,
                "type": catalog_types[0],
                "types": catalog_types,
                **cfg,
            })
            message = "Provider instance added"

    tts_cfg["providerInstances"] = _instances_to_camel(instances)
    put_status, put_payload = await api_request(
        api_base_url=settings.api_base_url,
        method="PUT",
        path="/v1/admin/livekit/agent-settings/default",
        access_token=access_token,
        json_body={"agentName": str(existing_data.get("agentName") or "coziyoo-agent"), "ttsConfig": tts_cfg},
    )
    if put_status not in {200, 201}:
        message = extract_error_message(put_payload, "Failed to save instance")
        show_add_instance_form = True

    provider_api_key_options = _provider_api_key_select_options(keys)
    return templates.TemplateResponse(
        request=request,
        name="providers/index.html",
        context={
            "catalog_providers": catalog,
            "provider_instances": instances,
            "provider_api_key_options": provider_api_key_options,
            "message": message,
            "active_tab": "instances",
            "add_instance_form": add_instance_form,
            "add_catalog_form": _default_custom_provider_form(),
            "show_add_instance_form": show_add_instance_form,
            "show_add_catalog_form": False,
        },
        status_code=200,
    )


@app.post("/dashboard/providers/instances/test", response_class=HTMLResponse)
async def dashboard_provider_instance_test(request: Request):
    access_token, refresh_response = await ensure_access_token(request=request, api_base_url=settings.api_base_url)
    if refresh_response is not None:
        return refresh_response

    form = await request.form()
    instance_id = str(form.get("instance_id") or "").strip()
    provider_type = str(form.get("provider_type") or "").strip().lower()
    if not instance_id or provider_type not in {"llm", "tts", "stt"}:
        return _status_response(
            request,
            state="error",
            title="Provider test failed",
            message="Invalid provider test request.",
        )

    status, payload = await api_request(
        api_base_url=settings.api_base_url,
        method="GET",
        path="/v1/admin/livekit/agent-settings/default",
        access_token=access_token,
    )
    if status != 200 or not isinstance(payload, dict) or not isinstance(payload.get("data"), dict):
        return _status_response(
            request,
            state="error",
            title="Provider test failed",
            message=extract_error_message(payload, "Failed to load provider settings"),
        )

    settings_data = _dict(payload.get("data"))
    tts_cfg = _auto_migrate_to_instances(_dict(settings_data.get("ttsConfig")))
    instances = _extract_provider_instances(tts_cfg)
    catalog = _extract_catalog_providers(tts_cfg)
    keys = _extract_provider_api_keys_from_tts_config(tts_cfg)

    instance = next((i for i in instances if str(i.get("id") or "") == instance_id), None)
    if not instance or not _instance_supports_type(instance, provider_type):
        return _status_response(
            request,
            state="error",
            title="Provider test failed",
            message="Selected provider instance does not support this capability.",
        )

    cfg = _resolve_provider_instance(
        instance_id=instance_id,
        requested_type=provider_type,
        instances=instances,
        catalog=catalog,
        keys=keys,
    )
    if not cfg:
        return _status_response(
            request,
            state="error",
            title="Provider test failed",
            message="Could not resolve provider configuration.",
        )

    if provider_type == "llm":
        ok, message, details = await _direct_llm_test(
            llm_cfg=cfg,
            prompt=str(form.get("llm_test_prompt") or "Say hello in one short sentence."),
        )
        if ok:
            return _status_response(
                request,
                state="success",
                title="LLM test successful",
                message=message,
            )
        return _status_response(
            request,
            state="error",
            title="LLM test failed",
            message=message,
            details=details,
        )

    if provider_type == "tts":
        resolved_api_key = str(cfg.get("api_key") or "").strip()
        custom_headers = _string_map(cfg.get("custom_headers"))
        auth_header = custom_headers.get("authorization", "").strip()
        if not auth_header and resolved_api_key:
            auth_header = f"Bearer {resolved_api_key}"

        status, data, content_type = await api_binary_request(
            api_base_url=settings.api_base_url,
            method="POST",
            path="/v1/admin/livekit/test/tts",
            access_token=access_token,
            json_body={
                "text": str(form.get("tts_test_text") or "Merhaba, bu bir test mesajidir."),
                "baseUrl": str(cfg.get("base_url") or ""),
                "synthPath": str(cfg.get("endpoint_path") or "/v1/audio/speech"),
                "textFieldName": str(cfg.get("text_field_name") or "input"),
                "bodyParams": _string_map(cfg.get("custom_body_params")),
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

    resolved_api_key = str(cfg.get("api_key") or "").strip()
    custom_headers = _string_map(cfg.get("custom_headers"))
    auth_header = custom_headers.get("authorization", "").strip()
    if not auth_header and resolved_api_key:
        auth_header = resolved_api_key
    status, payload = await api_request(
        api_base_url=settings.api_base_url,
        method="POST",
        path="/v1/admin/livekit/test/stt",
        access_token=access_token,
        json_body={
            "baseUrl": str(cfg.get("base_url") or ""),
            "transcribePath": str(cfg.get("endpoint_path") or "/v1/audio/transcriptions"),
            "authHeader": auth_header,
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


@app.post("/dashboard/providers/catalog", response_class=HTMLResponse)
async def dashboard_catalog_providers_save(request: Request):
    access_token, refresh_response = await ensure_access_token(request=request, api_base_url=settings.api_base_url)
    if refresh_response is not None:
        return refresh_response

    form = await request.form()
    status, payload = await api_request(
        api_base_url=settings.api_base_url,
        method="GET",
        path="/v1/admin/livekit/agent-settings/default",
        access_token=access_token,
    )
    existing_data: dict[str, Any] = {}
    if status == 200 and isinstance(payload, dict) and isinstance(payload.get("data"), dict):
        existing_data = _dict(payload.get("data"))

    tts_cfg = _auto_migrate_to_instances(_dict(existing_data.get("ttsConfig")))
    catalog = _extract_catalog_providers(tts_cfg)
    instances = _extract_provider_instances(tts_cfg)
    keys = _extract_provider_api_keys_from_tts_config(tts_cfg)
    by_id = {c["id"]: c for c in catalog}
    action = str(form.get("action") or "add").strip().lower()
    message = "Saved"
    show_add_catalog_form = False
    add_catalog_form = _default_custom_provider_form()

    if action == "import_curl":
        imported_form, import_message = _build_custom_provider_form_from_curl(str(form.get("import_curl_raw") or ""))
        add_catalog_form.update(imported_form)
        message = import_message
        show_add_catalog_form = True
    elif action == "delete":
        catalog_id = str(form.get("catalog_id") or "").strip()
        entry = by_id.get(catalog_id)
        if entry and entry.get("source") == "known":
            message = "Cannot delete built-in providers"
        else:
            catalog = [c for c in catalog if c.get("id") != catalog_id]
            message = "Provider removed from catalog"
    elif action == "update":
        catalog_id = str(form.get("catalog_id") or "").strip()
        current = by_id.get(catalog_id)
        if not current:
            message = "Provider not found"
        else:
            posted_types = _normalize_provider_types(form.getlist("provider_types")) if hasattr(form, "getlist") else []
            existing_types = _normalize_provider_types([str(t) for t in (current.get("types") or [])])
            selected_types = posted_types or existing_types
            # Determine which type's config is being edited
            # For multi-type entries, provider_type comes from the form's hidden field
            if not selected_types and current.get("type"):
                selected_types = _normalize_provider_types([str(current["type"])])
            provider_type = str(form.get("provider_type") or (selected_types[0] if selected_types else "")).strip().lower()
            if provider_type not in {"llm", "tts", "stt"}:
                provider_type = selected_types[0] if selected_types else "llm"
            provider_name = str(form.get("provider_name") or current.get("name") or "").strip()
            if not provider_name or not selected_types:
                message = "Provider name and at least one capability are required"
            else:
                cfg = _provider_form_config(provider_type, form, current=current)
                # Update top-level fields (shared across types)
                current["name"] = provider_name
                if cfg.get("base_url"):
                    current["base_url"] = cfg["base_url"]
                if cfg.get("models_path"):
                    current["models_path"] = cfg.get("models_path", "")
                current["types"] = selected_types
                # Update per-type config block
                if provider_type in {"llm", "tts", "stt"}:
                    existing_type_cfg = current.get(f"{provider_type}_config") or {}
                    updated_type_cfg: dict[str, Any] = {
                        "endpoint_path": cfg.get("endpoint_path", existing_type_cfg.get("endpoint_path", "")),
                        "model": cfg.get("model", existing_type_cfg.get("model", "")),
                        "api_key_slot": existing_type_cfg.get("api_key_slot", ""),
                        "custom_headers": _dict(cfg.get("custom_headers")) or _dict(existing_type_cfg.get("custom_headers")),
                        "custom_body_params": _dict(cfg.get("custom_body_params")) or _dict(existing_type_cfg.get("custom_body_params")),
                        "custom_query_params": _dict(cfg.get("custom_query_params")) or _dict(existing_type_cfg.get("custom_query_params")),
                    }
                    if provider_type in {"tts", "stt"}:
                        updated_type_cfg["language"] = cfg.get("language", existing_type_cfg.get("language", ""))
                    if provider_type == "tts":
                        updated_type_cfg["voice_id"] = cfg.get("voice_id", existing_type_cfg.get("voice_id", ""))
                        updated_type_cfg["text_field_name"] = cfg.get("text_field_name", existing_type_cfg.get("text_field_name", ""))
                    current[f"{provider_type}_config"] = updated_type_cfg
                # Ensure selected types have config objects
                for t in selected_types:
                    key = f"{t}_config"
                    if not isinstance(current.get(key), dict):
                        current[key] = _default_type_config_for_catalog_entry(catalog_id, t)
                # Remove deselected type configs
                for t in ("llm", "tts", "stt"):
                    if t not in selected_types:
                        current.pop(f"{t}_config", None)
                message = "Provider updated"
    else:
        # add custom provider
        provider_type = str(form.get("provider_type") or "").strip().lower()
        selected_types = _normalize_provider_types(form.getlist("provider_types")) if hasattr(form, "getlist") else []
        if provider_type in {"llm", "tts", "stt"} and provider_type not in selected_types:
            selected_types = [provider_type] + selected_types
        selected_types = _normalize_provider_types(selected_types)
        provider_name = str(form.get("provider_name") or "").strip()
        if provider_type not in {"llm", "tts", "stt"}:
            provider_type = selected_types[0] if selected_types else ""
        if not provider_name or not selected_types:
            message = "Provider name and at least one capability are required"
            show_add_catalog_form = True
        else:
            base_id = _slugify(f"{provider_type}-{provider_name}") or f"{provider_type}-provider"
            catalog_id = base_id
            counter = 2
            existing_ids = {c["id"] for c in catalog}
            while catalog_id in existing_ids:
                catalog_id = f"{base_id}-{counter}"
                counter += 1
            cfg = _provider_form_config(provider_type, form)
            entry: dict[str, Any] = {
                "id": catalog_id,
                "name": provider_name,
                "source": "custom",
                "base_url": cfg.get("base_url", ""),
                "models_path": cfg.get("models_path", ""),
                "types": selected_types,
            }
            for t in selected_types:
                if t == provider_type:
                    entry[f"{t}_config"] = {
                        "endpoint_path": cfg.get("endpoint_path", ""),
                        "model": cfg.get("model", ""),
                        "api_key_slot": "",
                        "language": cfg.get("language", ""),
                        "voice_id": cfg.get("voice_id", ""),
                        "text_field_name": cfg.get("text_field_name", ""),
                        "custom_headers": _dict(cfg.get("custom_headers")),
                        "custom_body_params": _dict(cfg.get("custom_body_params")),
                        "custom_query_params": _dict(cfg.get("custom_query_params")),
                    }
                else:
                    entry[f"{t}_config"] = _default_type_config_for_catalog_entry(catalog_id, t)
            catalog.append({
                **entry,
            })
            message = "Provider added to catalog"

    if action != "import_curl":
        tts_cfg["catalogProviders"] = _catalog_to_camel(catalog)
        put_status, put_payload = await api_request(
            api_base_url=settings.api_base_url,
            method="PUT",
            path="/v1/admin/livekit/agent-settings/default",
            access_token=access_token,
            json_body={"agentName": str(existing_data.get("agentName") or "coziyoo-agent"), "ttsConfig": tts_cfg},
        )
        if put_status not in {200, 201}:
            message = extract_error_message(put_payload, "Failed to save catalog")
            show_add_catalog_form = True

    provider_api_key_options = _provider_api_key_select_options(keys)
    return templates.TemplateResponse(
        request=request,
        name="providers/index.html",
        context={
            "catalog_providers": catalog,
            "provider_instances": instances,
            "provider_api_key_options": provider_api_key_options,
            "message": message,
            "active_tab": "catalog",
            "add_instance_form": _default_instance_form(),
            "add_catalog_form": add_catalog_form,
            "show_add_instance_form": False,
            "show_add_catalog_form": show_add_catalog_form,
        },
        status_code=200,
    )


@app.post("/dashboard/providers", response_class=HTMLResponse)
async def dashboard_custom_providers_save(request: Request):
    """Backward compat: route old POST /dashboard/providers to instances handler."""
    return await dashboard_provider_instances_save(request)


@app.get("/dashboard/org", response_class=HTMLResponse)
async def dashboard_org_page(request: Request):
    return await _render_placeholder_page(
        request,
        page_title="Organization",
        page_description="Organization profile, billing, members, and workspace-wide settings.",
    )


@app.get("/dashboard/squads", response_class=HTMLResponse)
async def dashboard_squads_page(request: Request):
    return await _render_placeholder_page(
        request,
        page_title="Squads",
        page_description="Create multi-assistant squads and define handoff strategies.",
    )


@app.get("/dashboard/test-suites", response_class=HTMLResponse)
async def dashboard_test_suites_page(request: Request):
    return await _render_placeholder_page(
        request,
        page_title="Test Suites",
        page_description="Run scripted tests to validate assistant behavior before production rollout.",
    )


@app.get("/dashboard/evals", response_class=HTMLResponse)
async def dashboard_evals_page(request: Request):
    return await _render_placeholder_page(
        request,
        page_title="Evals",
        page_description="Define call success criteria and evaluate assistant quality over time.",
    )


@app.get("/dashboard/library/voice", response_class=HTMLResponse)
async def dashboard_voice_library_page(request: Request):
    return await _render_placeholder_page(
        request,
        page_title="Voice Library",
        page_description="Browse and configure available TTS voices for assistant profiles.",
    )


@app.get("/dashboard/call-logs", response_class=HTMLResponse)
async def dashboard_call_logs(request: Request):
    access_token, refresh_response = await ensure_access_token(request=request, api_base_url=settings.api_base_url)
    if refresh_response is not None:
        return refresh_response
    profile_id = str(request.query_params.get("profileId") or "").strip() or None
    from_value = str(request.query_params.get("from") or "").strip() or None
    to_value = str(request.query_params.get("to") or "").strip() or None
    call_logs, error_message = await _fetch_call_logs(
        access_token,
        profile_id=profile_id,
        from_value=from_value,
        to_value=to_value,
    )
    profiles, _ = await _fetch_profiles(access_token)
    return templates.TemplateResponse(
        request=request,
        name="call_logs/index.html",
        context={
            "call_logs": call_logs,
            "message": error_message,
            "profiles": profiles,
            "filters": {"profileId": profile_id or "", "from": from_value or "", "to": to_value or ""},
        },
    )


@app.get("/dashboard/call-logs/table", response_class=HTMLResponse)
async def dashboard_call_logs_table(request: Request):
    access_token, refresh_response = await ensure_access_token(request=request, api_base_url=settings.api_base_url)
    if refresh_response is not None:
        return refresh_response
    profile_id = str(request.query_params.get("profileId") or "").strip() or None
    from_value = str(request.query_params.get("from") or "").strip() or None
    to_value = str(request.query_params.get("to") or "").strip() or None
    call_logs, error_message = await _fetch_call_logs(
        access_token,
        profile_id=profile_id,
        from_value=from_value,
        to_value=to_value,
    )
    return templates.TemplateResponse(
        request=request,
        name="call_logs/_table.html",
        context={"call_logs": call_logs, "message": error_message},
    )


@app.post("/dashboard/profiles", response_class=HTMLResponse)
@app.post("/dashboard/assistants", response_class=HTMLResponse)
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
        if status in {200, 201}:
            message = None
        elif status == 404:
            slug = re.sub(r"[^a-zA-Z0-9_-]+", "-", name.strip()).strip("-").lower()
            device_id = slug[:64] or "profile"
            # Ensure unique device_id for legacy endpoint.
            for i in range(1, 50):
                check_status, check_payload = await api_request(
                    api_base_url=settings.api_base_url,
                    method="GET",
                    path=f"/v1/admin/livekit/agent-settings/{device_id}",
                    access_token=access_token,
                )
                if check_status == 404:
                    break
                device_id = f"{slug[:54]}-{i}" if slug else f"profile-{i}"
            legacy_status, legacy_payload = await api_request(
                api_base_url=settings.api_base_url,
                method="PUT",
                path=f"/v1/admin/livekit/agent-settings/{device_id}",
                access_token=access_token,
                json_body={"agentName": name},
            )
            if legacy_status not in {200, 201}:
                message = extract_error_message(legacy_payload, "Profile create failed")
        else:
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
    if status == 404:
        legacy_status, legacy_payload = await api_request(
            api_base_url=settings.api_base_url,
            method="POST",
            path=f"/v1/admin/livekit/agent-settings/{profile_id}/activate",
            access_token=access_token,
            json_body={},
        )
        message = None if legacy_status == 200 else extract_error_message(legacy_payload, "Activation failed")
    else:
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
    message = None
    if status in {200, 201}:
        message = None
    elif status == 404:
        # Legacy fallback: duplicate via livekit agent-settings endpoints.
        get_status, get_payload = await api_request(
            api_base_url=settings.api_base_url,
            method="GET",
            path=f"/v1/admin/livekit/agent-settings/{profile_id}",
            access_token=access_token,
        )
        src = get_payload.get("data") if get_status == 200 and isinstance(get_payload, dict) else None
        if not isinstance(src, dict):
            message = "Duplicate failed"
        else:
            base_name = str(src.get("agentName") or profile_id).strip() or "profile"
            target_name = f"{base_name} (copy)"
            slug_base = re.sub(r"[^a-zA-Z0-9_-]+", "-", target_name).strip("-").lower() or "profile-copy"
            new_id = slug_base[:64]
            for i in range(1, 50):
                check_status, _ = await api_request(
                    api_base_url=settings.api_base_url,
                    method="GET",
                    path=f"/v1/admin/livekit/agent-settings/{new_id}",
                    access_token=access_token,
                )
                if check_status == 404:
                    break
                new_id = f"{slug_base[:54]}-{i}"
            create_status, create_payload = await api_request(
                api_base_url=settings.api_base_url,
                method="PUT",
                path=f"/v1/admin/livekit/agent-settings/{new_id}",
                access_token=access_token,
                json_body={
                    "agentName": target_name,
                    "voiceLanguage": src.get("voiceLanguage"),
                    "ttsEnabled": src.get("ttsEnabled"),
                    "sttEnabled": src.get("sttEnabled"),
                    "systemPrompt": src.get("systemPrompt"),
                    "greetingEnabled": src.get("greetingEnabled"),
                    "greetingInstruction": src.get("greetingInstruction"),
                },
            )
            message = None if create_status in {200, 201} else extract_error_message(create_payload, "Duplicate failed")
    else:
        message = extract_error_message(payload, "Duplicate failed")
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
    if status == 404:
        # Legacy fallback when new agent-profiles routes are not deployed yet.
        list_status, list_payload = await api_request(
            api_base_url=settings.api_base_url,
            method="GET",
            path="/v1/admin/livekit/agent-settings",
            access_token=access_token,
        )
        if list_status == 200 and isinstance(list_payload, dict) and isinstance(list_payload.get("data"), list):
            for row in list_payload["data"]:
                if isinstance(row, dict) and str(row.get("device_id") or "") == profile_id and bool(row.get("is_active")):
                    message = "Cannot delete the active profile. Activate a different profile first."
                    return await _render_sidebar(request, access_token, message)
        legacy_status, legacy_payload = await api_request(
            api_base_url=settings.api_base_url,
            method="DELETE",
            path=f"/v1/admin/livekit/agent-settings/{profile_id}",
            access_token=access_token,
        )
        if legacy_status != 200:
            message = extract_error_message(legacy_payload, "Delete failed")
    elif status == 409:
        message = extract_error_message(payload, "CANNOT_DELETE_ACTIVE")
    elif status != 200:
        message = extract_error_message(payload, "Delete failed")
    return await _render_sidebar(request, access_token, message)


@app.get("/dashboard/profiles/{profile_id}", response_class=HTMLResponse)
async def dashboard_profile_editor(request: Request, profile_id: str):
    access_token, refresh_response = await ensure_access_token(request=request, api_base_url=settings.api_base_url)
    if refresh_response is not None:
        return refresh_response

    # Non-UUID IDs are legacy device_id values — skip the modern API entirely.
    if _is_uuid(profile_id):
        status, payload = await api_request(
            api_base_url=settings.api_base_url,
            method="GET",
            path=f"/v1/admin/agent-profiles/{profile_id}",
            access_token=access_token,
        )
        if status == 200 and isinstance(payload, dict):
            profile = payload.get("data") if isinstance(payload.get("data"), dict) else None
            context = await _editor_panel_context(access_token=access_token, profile=profile, message=None)
            return templates.TemplateResponse(
                request=request,
                name="profiles/_editor_panel.html",
                context=context,
            )
        if status != 404:
            message = extract_error_message(payload, "Failed to load profile")
            context = await _editor_panel_context(access_token=access_token, profile=None, message=message)
            return templates.TemplateResponse(
                request=request,
                name="profiles/_editor_panel.html",
                context=context,
                status_code=200,
            )
        # 404 — fall through to legacy

    legacy_status, legacy_payload = await api_request(
        api_base_url=settings.api_base_url,
        method="GET",
        path=f"/v1/admin/livekit/agent-settings/{profile_id}",
        access_token=access_token,
    )
    if legacy_status == 200 and isinstance(legacy_payload, dict) and isinstance(legacy_payload.get("data"), dict):
        profile = _legacy_settings_to_profile(profile_id, legacy_payload["data"])
        context = await _editor_panel_context(access_token=access_token, profile=profile, message=None)
        return templates.TemplateResponse(
            request=request,
            name="profiles/_editor_panel.html",
            context=context,
        )
    message = extract_error_message(legacy_payload, "Failed to load profile")
    context = await _editor_panel_context(access_token=access_token, profile=None, message=message)
    return templates.TemplateResponse(
        request=request,
        name="profiles/_editor_panel.html",
        context=context,
        status_code=200,
    )


@app.post("/dashboard/profiles/{profile_id}/save", response_class=HTMLResponse)
async def dashboard_profile_save(request: Request, profile_id: str):
    access_token, refresh_response = await ensure_access_token(request=request, api_base_url=settings.api_base_url)
    if refresh_response is not None:
        return refresh_response
    is_htmx = request.headers.get("HX-Request", "").lower() == "true"
    form = await request.form()
    payload = normalize_profile_payload({k: str(v) for k, v in form.items()})
    payload = await _apply_selected_api_keys(access_token=access_token, payload=payload)
    payload = await _strip_custom_provider_snapshot_fields(access_token=access_token, payload=payload)

    use_legacy = not _is_uuid(profile_id)

    if not use_legacy:
        status, update_payload = await api_request(
            api_base_url=settings.api_base_url,
            method="PUT",
            path=f"/v1/admin/agent-profiles/{profile_id}",
            access_token=access_token,
            json_body=payload,
        )
        if status == 404:
            use_legacy = True
        elif status == 200:
            current_status, current_payload = await api_request(
                api_base_url=settings.api_base_url,
                method="GET",
                path=f"/v1/admin/agent-profiles/{profile_id}",
                access_token=access_token,
            )
            profile = current_payload.get("data") if current_status == 200 and isinstance(current_payload, dict) else None
            if not is_htmx:
                return RedirectResponse(url="/dashboard/assistants", status_code=303)
            context = await _editor_panel_context(access_token=access_token, profile=profile, message="Saved")
            return templates.TemplateResponse(
                request=request,
                name="profiles/_editor_panel.html",
                context=context,
                status_code=200,
            )
        else:
            message = extract_error_message(update_payload, "Profile save failed")
            if not is_htmx:
                return RedirectResponse(url="/dashboard/assistants", status_code=303)
            context = await _editor_panel_context(access_token=access_token, profile=None, message=message)
            return templates.TemplateResponse(
                request=request,
                name="profiles/_editor_panel.html",
                context=context,
                status_code=200,
            )

    # Legacy path (non-UUID device_id or modern 404)
    legacy_body = _to_legacy_profile_payload(payload)
    legacy_status, legacy_payload = await api_request(
        api_base_url=settings.api_base_url,
        method="PUT",
        path=f"/v1/admin/livekit/agent-settings/{profile_id}",
        access_token=access_token,
        json_body=legacy_body,
    )
    message = None if legacy_status in {200, 201} else extract_error_message(legacy_payload, "Profile save failed")
    current_status, current_payload = await api_request(
        api_base_url=settings.api_base_url,
        method="GET",
        path=f"/v1/admin/livekit/agent-settings/{profile_id}",
        access_token=access_token,
    )
    if current_status == 200 and isinstance(current_payload, dict) and isinstance(current_payload.get("data"), dict):
        profile = _legacy_settings_to_profile(profile_id, current_payload["data"])
        if not is_htmx:
            return RedirectResponse(url="/dashboard/assistants", status_code=303)
        context = await _editor_panel_context(access_token=access_token, profile=profile, message=message or "Saved")
        return templates.TemplateResponse(
            request=request,
            name="profiles/_editor_panel.html",
            context=context,
            status_code=200,
        )
    if not is_htmx:
        return RedirectResponse(url="/dashboard/assistants", status_code=303)
    context = await _editor_panel_context(access_token=access_token, profile=None, message=message or "Profile save failed")
    return templates.TemplateResponse(
        request=request,
        name="profiles/_editor_panel.html",
        context=context,
        status_code=200,
    )


@app.post("/dashboard/test/llm", response_class=HTMLResponse)
async def dashboard_test_llm(request: Request):
    access_token, refresh_response = await ensure_access_token(request=request, api_base_url=settings.api_base_url)
    if refresh_response is not None:
        return refresh_response

    form = await request.form()
    normalized = normalize_profile_payload({k: str(v) for k, v in form.items()})
    # Keep test behavior aligned with profile save flow: resolve selected provider instance/key slots.
    normalized = await _apply_selected_api_keys(access_token=access_token, payload=normalized)
    llm_cfg = _dict(normalized.get("llm_config"))
    resolved_api_key = await _resolve_api_key_from_id(
        access_token=access_token,
        explicit_api_key=str(llm_cfg.get("api_key") or ""),
        api_key_id=str(llm_cfg.get("api_key_id") or ""),
    )
    llm_cfg["api_key"] = resolved_api_key

    status, payload = await api_request(
        api_base_url=settings.api_base_url,
        method="POST",
        path="/v1/admin/livekit/test/llm",
        access_token=access_token,
        json_body={
            "baseUrl": str(llm_cfg.get("base_url") or ""),
            "endpointPath": str(llm_cfg.get("endpoint_path") or "/v1/chat/completions"),
            "apiKey": resolved_api_key,
            "model": str(llm_cfg.get("model") or ""),
            "customHeaders": _string_map(llm_cfg.get("custom_headers")),
            "customBodyParams": _string_map(llm_cfg.get("custom_body_params")),
            "prompt": str(form.get("llm_test_prompt") or "Say hello in one short sentence."),
        },
    )
    fallback_candidate = (
        status in {404, 405}
        or (isinstance(payload, str) and "Cannot POST /v1/admin/livekit/test/llm" in payload)
    )
    if fallback_candidate:
        ok, message, details = await _direct_llm_test(
            llm_cfg=llm_cfg,
            prompt=str(form.get("llm_test_prompt") or "Say hello in one short sentence."),
        )
        if ok:
            return _status_response(
                request,
                state="success",
                title="LLM test successful",
                message=message,
            )
        return _status_response(
            request,
            state="error",
            title="LLM test failed",
            message=message,
            details=details,
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
    details = ""
    if isinstance(payload, dict):
        error_obj = payload.get("error")
        if isinstance(error_obj, dict):
            details = str(error_obj.get("details") or "")
        elif isinstance(error_obj, str):
            details = error_obj
    elif isinstance(payload, str):
        details = re.sub(r"\s+", " ", payload).strip()[:240]
    return _status_response(
        request,
        state="error",
        title="LLM test failed",
        message=extract_error_message(payload, "LLM request failed"),
        details=details,
    )


@app.post("/dashboard/models")
async def dashboard_llm_models(request: Request):
    access_token, refresh_response = await ensure_access_token(request=request, api_base_url=settings.api_base_url)
    if refresh_response is not None:
        return refresh_response

    body = await request.json()
    base_url = str(body.get("baseUrl") or "").strip()
    models_path = str(body.get("modelsPath") or "/v1/models").strip() or "/v1/models"
    api_key = str(body.get("apiKey") or "").strip()
    api_key_id = str(body.get("apiKeyId") or "").strip()
    if api_key_id:
        api_key = await _resolve_api_key_from_id(
            access_token=access_token,
            explicit_api_key=api_key,
            api_key_id=api_key_id,
        )
    custom_headers = body.get("customHeaders") or {}

    status, payload = await api_request(
        api_base_url=settings.api_base_url,
        method="POST",
        path="/v1/admin/livekit/llm/models",
        access_token=access_token,
        json_body={
            "baseUrl": base_url,
            "modelsPath": models_path,
            "apiKey": api_key,
            "customHeaders": custom_headers,
        },
    )
    if status == 200 and isinstance(payload, dict) and isinstance(payload.get("data"), dict):
        return {"models": payload["data"].get("models", [])}

    # Backward-compat fallback:
    # If real API has not deployed /v1/admin/livekit/llm/models yet, fetch provider directly.
    fallback_candidate = (
        status in {404, 405}
        or (isinstance(payload, str) and "Cannot POST /v1/admin/livekit/llm/models" in payload)
    )
    if fallback_candidate and base_url:
        url = f"{base_url.rstrip('/')}{models_path}"
        headers: dict[str, str] = {}
        if isinstance(custom_headers, dict):
            headers = {str(k): str(v) for k, v in custom_headers.items()}
        if api_key and "Authorization" not in headers and "x-api-key" not in headers:
            headers["Authorization"] = f"Bearer {api_key}"
        try:
            timeout = aiohttp.ClientTimeout(total=15)
            async with aiohttp.ClientSession(timeout=timeout) as session:
                async with session.get(url, headers=headers) as upstream:
                    raw = await upstream.text()
                    if upstream.status >= 400:
                        return {"models": [], "error": f"Provider returned {upstream.status}"}
                    parsed = json.loads(raw)
                    models: list[str] = []
                    if isinstance(parsed, dict):
                        data_items = parsed.get("data")
                        if isinstance(data_items, list):
                            models.extend(
                                str(item.get("id"))
                                for item in data_items
                                if isinstance(item, dict) and item.get("id")
                            )
                        ollama_items = parsed.get("models")
                        if isinstance(ollama_items, list):
                            for item in ollama_items:
                                if isinstance(item, str) and item.strip():
                                    models.append(item.strip())
                                elif isinstance(item, dict):
                                    name = item.get("name") or item.get("model") or item.get("id")
                                    if isinstance(name, str) and name.strip():
                                        models.append(name.strip())
                    models = sorted(set(models))
                    return {"models": models}
        except Exception as err:
            return {"models": [], "error": f"Fallback fetch failed: {err}"}

    if isinstance(payload, dict):
        error = payload.get("error")
        if isinstance(error, dict):
            message = error.get("message")
            code = error.get("code")
            if isinstance(message, str) and message.strip():
                return {"models": [], "error": message}
            if isinstance(code, str) and code.strip():
                return {"models": [], "error": f"{code} (status {status})"}
    if isinstance(payload, str) and payload.strip():
        compact = re.sub(r"\s+", " ", payload).strip()
        return {"models": [], "error": compact[:160]}
    return {"models": [], "error": f"Failed to fetch models (status {status})"}


@app.post("/dashboard/test/tts", response_class=HTMLResponse)
async def dashboard_test_tts(request: Request):
    access_token, refresh_response = await ensure_access_token(request=request, api_base_url=settings.api_base_url)
    if refresh_response is not None:
        return refresh_response

    form = await request.form()
    normalized = normalize_profile_payload({k: str(v) for k, v in form.items()})
    tts_cfg = _dict(normalized.get("tts_config"))
    resolved_api_key = await _resolve_api_key_from_id(
        access_token=access_token,
        explicit_api_key=str(tts_cfg.get("api_key") or ""),
        api_key_id=str(tts_cfg.get("api_key_id") or ""),
    )
    custom_headers = _string_map(tts_cfg.get("custom_headers"))
    auth_header = custom_headers.get("authorization", "").strip()
    if not auth_header and resolved_api_key:
        auth_header = f"Bearer {resolved_api_key}"

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
    resolved_api_key = await _resolve_api_key_from_id(
        access_token=access_token,
        explicit_api_key=str(stt_cfg.get("api_key") or ""),
        api_key_id=str(stt_cfg.get("api_key_id") or ""),
    )
    custom_headers = _string_map(stt_cfg.get("custom_headers"))
    auth_header = custom_headers.get("authorization", "").strip()
    if not auth_header and resolved_api_key:
        auth_header = resolved_api_key
    status, payload = await api_request(
        api_base_url=settings.api_base_url,
        method="POST",
        path="/v1/admin/livekit/test/stt",
        access_token=access_token,
        json_body={
            "baseUrl": str(stt_cfg.get("base_url") or ""),
            "transcribePath": str(stt_cfg.get("endpoint_path") or "/v1/audio/transcriptions"),
            "authHeader": auth_header,
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
    resolved_api_key = await _resolve_api_key_from_id(
        access_token=access_token,
        explicit_api_key=str(stt_cfg.get("api_key") or ""),
        api_key_id=str(stt_cfg.get("api_key_id") or ""),
    )
    custom_headers = _string_map(stt_cfg.get("custom_headers"))
    auth_header = custom_headers.get("authorization", "").strip()
    if not auth_header and resolved_api_key:
        auth_header = resolved_api_key

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
        context = await _editor_panel_context(
            access_token=access_token,
            profile=profile if isinstance(profile, dict) else None,
            message="Could not parse cURL command",
        )
        return templates.TemplateResponse(
            request=request,
            name="profiles/_editor_panel.html",
            context=context,
            status_code=400,
        )

    get_status, get_payload = await api_request(
        api_base_url=settings.api_base_url,
        method="GET",
        path=f"/v1/admin/agent-profiles/{profile_id}",
        access_token=access_token,
    )
    if get_status != 200 or not isinstance(get_payload, dict):
        context = await _editor_panel_context(
            access_token=access_token,
            profile=None,
            message=extract_error_message(get_payload, "Failed to load profile"),
        )
        return templates.TemplateResponse(
            request=request,
            name="profiles/_editor_panel.html",
            context=context,
            status_code=502,
        )
    profile = get_payload.get("data") if isinstance(get_payload.get("data"), dict) else None
    if not isinstance(profile, dict):
        context = await _editor_panel_context(
            access_token=access_token,
            profile=None,
            message="Profile response format invalid",
        )
        return templates.TemplateResponse(
            request=request,
            name="profiles/_editor_panel.html",
            context=context,
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
    context = await _editor_panel_context(
        access_token=access_token,
        profile=final_profile if isinstance(final_profile, dict) else None,
        message=message,
    )
    return templates.TemplateResponse(
        request=request,
        name="profiles/_editor_panel.html",
        context=context,
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
