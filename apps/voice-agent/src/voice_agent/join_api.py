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
from urllib.parse import urlencode

import aiohttp
from fastapi import FastAPI, Header, HTTPException, Query, Request
from fastapi.responses import HTMLResponse, RedirectResponse, Response, StreamingResponse
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
    provider_keys = await _load_provider_api_keys(access_token)
    for section in ("llm_config", "tts_config", "stt_config"):
        cfg = _dict(payload.get(section))
        key_id = str(cfg.get("api_key_id") or "").strip()
        if key_id:
            resolved = str(provider_keys.get(key_id) or "").strip()
            if resolved:
                cfg["api_key"] = resolved
        payload[section] = cfg
    return payload


async def _editor_panel_context(
    *,
    access_token: str,
    profile: dict[str, Any] | None,
    message: str | None,
) -> dict[str, Any]:
    provider_keys = await _load_provider_api_keys(access_token)
    return {
        "profile": profile,
        "message": message,
        "provider_api_key_options": _provider_api_key_select_options(provider_keys),
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

    provider_keys = await _load_provider_api_keys(access_token)
    return templates.TemplateResponse(
        request=request,
        name="profiles/index.html",
        context={
            "profiles": profiles,
            "message": initial_message or error_message,
            "selected_profile_id": selected_profile_id,
            "profile": initial_profile,
            "provider_api_key_options": _provider_api_key_select_options(provider_keys),
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
            if canonical_provider_id not in known_base_ids:
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
    if not api_key and api_key_id:
        api_key = await _resolve_api_key_from_id(
            access_token=access_token,
            explicit_api_key="",
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
