from __future__ import annotations

from livekit.plugins.openai import LLM as OpenAILLM

from voice_agent.providers import (
    build_llm,
    build_openai_client,
    build_stt,
    build_tts,
    parse_llm_config,
    parse_stt_config,
    parse_tts_config,
    remap_response,
)
from voice_agent.providers.http_stt import HttpSTT
from voice_agent.providers.http_tts import HttpTTS


def test_build_llm_returns_openai(mock_providers_new_schema: dict) -> None:
    """ADAPT-01: build_llm should return an OpenAI-compatible LLM instance."""
    llm_cfg = parse_llm_config(mock_providers_new_schema)
    llm = build_llm(llm_cfg)
    assert isinstance(llm, OpenAILLM)


def test_build_tts_returns_http_tts_for_custom_engine(mock_providers_new_schema: dict) -> None:
    """ADAPT-01: build_tts should return HttpTTS when engine is non-OpenAI."""
    tts_cfg = parse_tts_config(mock_providers_new_schema)
    tts = build_tts(tts_cfg)
    assert isinstance(tts, HttpTTS)


def test_build_stt_returns_http_stt(mock_providers_new_schema: dict) -> None:
    """ADAPT-01: build_stt should return HttpSTT/OpenAI-STT based on provider config."""
    stt_cfg = parse_stt_config(mock_providers_new_schema)
    stt = build_stt(stt_cfg)
    assert isinstance(stt, HttpSTT)


def test_llm_custom_headers_applied(mock_providers_with_custom_headers: dict) -> None:
    """ADAPT-02: custom LLM headers should be propagated to request options."""
    llm_cfg = parse_llm_config(mock_providers_with_custom_headers)
    llm = build_llm(llm_cfg)
    assert llm._opts.extra_headers.get("X-Custom-Auth") == "Bearer test-token"
    assert llm._opts.extra_headers.get("X-Request-ID") == "test-123"


def test_tts_custom_headers_applied(mock_providers_with_custom_headers: dict) -> None:
    """ADAPT-02: custom TTS headers should be propagated to adapter construction."""
    tts_cfg = parse_tts_config(mock_providers_with_custom_headers)
    tts = build_tts(tts_cfg)
    assert isinstance(tts, HttpTTS)
    assert tts._auth_header == "Bearer test-token"


def test_llm_custom_body_params(mock_providers_with_custom_body: dict) -> None:
    """ADAPT-03: custom LLM body params should map into request body overrides."""
    llm_cfg = parse_llm_config(mock_providers_with_custom_body)
    llm = build_llm(llm_cfg)
    assert llm._opts.extra_body == {"temperature": 0.7, "top_p": 0.9}


def test_tts_custom_body_params(mock_providers_with_custom_body: dict) -> None:
    """ADAPT-03: custom TTS body params should map into adapter body params."""
    tts_cfg = parse_tts_config(mock_providers_with_custom_body)
    tts = build_tts(tts_cfg)
    assert isinstance(tts, HttpTTS)
    assert tts._body_params == {"speed": 1.5}


def test_custom_endpoint_path_tts(mock_providers_with_custom_path: dict) -> None:
    """ADAPT-04: custom TTS endpointPath should map to adapter synth path."""
    tts_cfg = parse_tts_config(mock_providers_with_custom_path)
    tts = build_tts(tts_cfg)
    assert isinstance(tts, HttpTTS)
    assert tts._synth_path == "/synthesize"


def test_custom_endpoint_path_stt(mock_providers_with_custom_path: dict) -> None:
    """ADAPT-04: custom STT endpointPath should map to adapter transcribe path."""
    stt_cfg = parse_stt_config(mock_providers_with_custom_path)
    stt = build_stt(stt_cfg)
    assert isinstance(stt, HttpSTT)
    assert stt._transcribe_path == "/transcribe"


def test_response_remap(mock_providers_new_schema: dict) -> None:
    """ADAPT-05: remap_response should transform provider-specific response fields."""
    result = remap_response({"transcript": "hello"}, {"transcript": "text"})
    assert result == {"text": "hello"}


def test_parse_config_old_schema(mock_providers_old_schema: dict) -> None:
    """Backward compatibility: old provider schema should normalize into typed config."""
    llm = parse_llm_config(mock_providers_old_schema)
    tts = parse_tts_config(mock_providers_old_schema)
    stt = parse_stt_config(mock_providers_old_schema)

    assert llm.base_url == "https://llm-old.example.com"
    assert llm.api_key == "old-llm-token"
    assert tts.endpoint_path == "/tts"
    assert tts.text_field_name == "text"
    assert stt.endpoint_path == "/v1/audio/transcriptions"
    assert stt.custom_headers.get("Authorization") == "Bearer old-stt-token"


def test_parse_config_new_schema(mock_providers_new_schema: dict) -> None:
    """ADAPT baseline: new profile schema should parse into typed config."""
    llm = parse_llm_config(mock_providers_new_schema)
    tts = parse_tts_config(mock_providers_new_schema)
    stt = parse_stt_config(mock_providers_new_schema)

    assert llm.custom_headers.get("X-Provider") == "new-llm"
    assert llm.custom_body_params.get("temperature") == 0.2
    assert tts.endpoint_path == "/tts"
    assert tts.custom_body_params.get("speed") == 1.2
    assert stt.endpoint_path == "/v1/audio/transcriptions"
    assert stt.custom_headers.get("X-STT") == "1"


def test_build_openai_client_has_headers() -> None:
    """ADAPT-02: build_openai_client should carry extra headers into httpx client."""
    client = build_openai_client(
        base_url="https://api.openai.com/v1",
        api_key="sk-test",
        extra_headers={"X-Request-ID": "test-123"},
    )
    assert str(client.base_url).startswith("https://api.openai.com")
    assert client._client.headers.get("X-Request-ID") == "test-123"
