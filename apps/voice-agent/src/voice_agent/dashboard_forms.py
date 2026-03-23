from __future__ import annotations

import json
from typing import Mapping


def _as_bool(value: str | None, default: bool = False) -> bool:
    if value is None:
        return default
    return value.lower() in {"1", "true", "yes", "on"}


def _as_text(value: str | None, default: str = "") -> str:
    if value is None:
        return default
    return value.strip()


def _as_json_map(value: str | None) -> dict[str, str]:
    raw = _as_text(value)
    if not raw:
        return {}
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        return {}
    if not isinstance(parsed, dict):
        return {}
    result: dict[str, str] = {}
    for key, item in parsed.items():
        if isinstance(key, str):
            result[key] = str(item)
    return result


def normalize_profile_payload(form_data: Mapping[str, str]) -> dict:
    return {
        "name": _as_text(form_data.get("name")),
        "speaks_first": _as_bool(form_data.get("speaks_first")),
        "system_prompt": _as_text(form_data.get("system_prompt")),
        "greeting_enabled": _as_bool(form_data.get("greeting_enabled"), default=True),
        "greeting_instruction": _as_text(form_data.get("greeting_instruction")),
        "voice_language": _as_text(form_data.get("voice_language"), default="tr") or "tr",
        "llm_config": {
            "base_url": _as_text(form_data.get("llm_config.base_url")),
            "api_key": _as_text(form_data.get("llm_config.api_key")),
            "api_key_id": _as_text(form_data.get("llm_config.api_key_id")),
            "model": _as_text(form_data.get("llm_config.model")),
            "endpoint_path": _as_text(form_data.get("llm_config.endpoint_path"), "/v1/chat/completions")
            or "/v1/chat/completions",
            "custom_headers": _as_json_map(form_data.get("llm_config.custom_headers")),
            "custom_body_params": _as_json_map(form_data.get("llm_config.custom_body_params")),
        },
        "tts_config": {
            "provider": _as_text(form_data.get("tts_config.provider"), "custom") or "custom",
            "language": _as_text(form_data.get("tts_config.language"), "multilingual") or "multilingual",
            "base_url": _as_text(form_data.get("tts_config.base_url")),
            "api_key": _as_text(form_data.get("tts_config.api_key")),
            "api_key_id": _as_text(form_data.get("tts_config.api_key_id")),
            "model": _as_text(form_data.get("tts_config.model")),
            "models_path": _as_text(form_data.get("tts_config.models_path"), "/v1/models") or "/v1/models",
            "endpoint_path": _as_text(form_data.get("tts_config.endpoint_path"), "/v1/audio/speech")
            or "/v1/audio/speech",
            "voice_id": _as_text(form_data.get("tts_config.voice_id")),
            "text_field_name": _as_text(form_data.get("tts_config.text_field_name"), "input") or "input",
            "custom_headers": _as_json_map(form_data.get("tts_config.custom_headers")),
            "custom_body_params": _as_json_map(form_data.get("tts_config.custom_body_params")),
        },
        "stt_config": {
            "provider": _as_text(form_data.get("stt_config.provider"), "custom") or "custom",
            "base_url": _as_text(form_data.get("stt_config.base_url")),
            "api_key": _as_text(form_data.get("stt_config.api_key")),
            "api_key_id": _as_text(form_data.get("stt_config.api_key_id")),
            "model": _as_text(form_data.get("stt_config.model")),
            "models_path": _as_text(form_data.get("stt_config.models_path"), "/v1/models") or "/v1/models",
            "endpoint_path": _as_text(form_data.get("stt_config.endpoint_path"), "/v1/audio/transcriptions")
            or "/v1/audio/transcriptions",
            "language": _as_text(form_data.get("stt_config.language")),
            "custom_headers": _as_json_map(form_data.get("stt_config.custom_headers")),
            "custom_body_params": _as_json_map(form_data.get("stt_config.custom_body_params")),
            "custom_query_params": _as_json_map(form_data.get("stt_config.custom_query_params")),
        },
        "n8n_config": {
            "base_url": _as_text(form_data.get("n8n_config.base_url")),
            "webhook_path": _as_text(form_data.get("n8n_config.webhook_path")),
            "mcp_webhook_path": _as_text(form_data.get("n8n_config.mcp_webhook_path")),
        },
    }
