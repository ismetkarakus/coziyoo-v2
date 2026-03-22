from __future__ import annotations

from pydantic import BaseModel, Field


class ServiceConfig(BaseModel):
    base_url: str = ""
    api_key: str = ""
    model: str = ""
    endpoint_path: str = ""
    custom_headers: dict[str, str] = Field(default_factory=dict)
    custom_body_params: dict = Field(default_factory=dict)
    response_field_map: dict[str, str] = Field(default_factory=dict)


class LLMConfig(ServiceConfig):
    model: str = "llama3.1:8b"
    endpoint_path: str = "/v1/chat/completions"


class TTSConfig(ServiceConfig):
    endpoint_path: str = "/tts"
    voice: str = ""
    speed: float = 1.0
    engine: str = "f5-tts"
    language: str = "en"
    text_field_name: str = "text"


class STTConfig(ServiceConfig):
    endpoint_path: str = "/v1/audio/transcriptions"
    language: str = "en"
    response_format: str = "verbose_json"


def _as_dict(value: object) -> dict:
    return value if isinstance(value, dict) else {}


def _stringify_map(value: object) -> dict[str, str]:
    if not isinstance(value, dict):
        return {}
    out: dict[str, str] = {}
    for k, v in value.items():
        if isinstance(k, str):
            out[k] = str(v)
    return out


def _extract_api_key(raw: str | None) -> str:
    if not raw:
        return ""
    val = raw.strip()
    if val.lower().startswith("bearer "):
        return val[7:].strip()
    return val


def parse_llm_config(providers: dict) -> LLMConfig:
    cfg = _as_dict(providers.get("llm"))
    custom_headers = _stringify_map(cfg.get("customHeaders"))
    custom_body = _as_dict(cfg.get("customBodyParams"))
    response_map = _stringify_map(cfg.get("responseFieldMap"))

    auth_header = str(cfg.get("authHeader") or "").strip()
    api_key = str(cfg.get("apiKey") or "").strip() or _extract_api_key(auth_header)
    if auth_header and "Authorization" not in custom_headers:
        custom_headers["Authorization"] = auth_header

    return LLMConfig(
        base_url=str(cfg.get("baseUrl") or ""),
        api_key=api_key,
        model=str(cfg.get("model") or "llama3.1:8b"),
        endpoint_path=str(cfg.get("endpointPath") or "/v1/chat/completions"),
        custom_headers=custom_headers,
        custom_body_params=custom_body,
        response_field_map=response_map,
    )


def parse_tts_config(providers: dict) -> TTSConfig:
    cfg = _as_dict(providers.get("tts"))
    custom_headers = _stringify_map(cfg.get("customHeaders"))
    custom_body = _as_dict(cfg.get("customBodyParams")) or _as_dict(cfg.get("bodyParams"))
    response_map = _stringify_map(cfg.get("responseFieldMap"))

    auth_header = str(cfg.get("authHeader") or "").strip()
    api_key = str(cfg.get("apiKey") or "").strip() or _extract_api_key(auth_header)
    if auth_header and "Authorization" not in custom_headers:
        custom_headers["Authorization"] = auth_header

    return TTSConfig(
        base_url=str(cfg.get("baseUrl") or ""),
        api_key=api_key,
        model=str(cfg.get("model") or ""),
        endpoint_path=str(cfg.get("endpointPath") or cfg.get("synthPath") or "/tts"),
        custom_headers=custom_headers,
        custom_body_params=custom_body,
        response_field_map=response_map,
        voice=str(cfg.get("voice") or ""),
        speed=float(cfg.get("speed") or 1.0),
        engine=str(cfg.get("engine") or "f5-tts"),
        language=str(cfg.get("language") or "en"),
        text_field_name=str(cfg.get("textFieldName") or "text"),
    )


def parse_stt_config(providers: dict) -> STTConfig:
    cfg = _as_dict(providers.get("stt"))
    custom_headers = _stringify_map(cfg.get("customHeaders"))
    custom_body = _as_dict(cfg.get("customBodyParams"))
    response_map = _stringify_map(cfg.get("responseFieldMap"))

    auth_header = str(cfg.get("authHeader") or "").strip()
    api_key = str(cfg.get("apiKey") or "").strip() or _extract_api_key(auth_header)
    if auth_header and "Authorization" not in custom_headers:
        custom_headers["Authorization"] = auth_header

    return STTConfig(
        base_url=str(cfg.get("baseUrl") or ""),
        api_key=api_key,
        model=str(cfg.get("model") or "whisper-1"),
        endpoint_path=str(cfg.get("endpointPath") or cfg.get("transcribePath") or "/v1/audio/transcriptions"),
        custom_headers=custom_headers,
        custom_body_params=custom_body,
        response_field_map=response_map,
        language=str(cfg.get("language") or "en"),
        response_format=str(cfg.get("responseFormat") or "verbose_json"),
    )


def parse_providers_config(providers: dict) -> dict[str, ServiceConfig]:
    return {
        "llm": parse_llm_config(providers),
        "tts": parse_tts_config(providers),
        "stt": parse_stt_config(providers),
    }
