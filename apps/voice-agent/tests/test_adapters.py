from __future__ import annotations

import pytest


@pytest.mark.skip(reason="Wave 0 stub — adapter module not yet created")
def test_build_llm_returns_openai(mock_providers_new_schema: dict) -> None:
    """ADAPT-01: build_llm should return an OpenAI-compatible LLM instance."""
    from voice_agent.providers import build_llm  # type: ignore[attr-defined]
    from voice_agent.providers.config import parse_providers_config  # type: ignore[attr-defined]

    config = parse_providers_config(mock_providers_new_schema)
    llm = build_llm(config)
    assert llm is not None


@pytest.mark.skip(reason="Wave 0 stub — adapter module not yet created")
def test_build_tts_returns_http_tts_for_custom_engine(mock_providers_new_schema: dict) -> None:
    """ADAPT-01: build_tts should return HttpTTS when engine is non-OpenAI."""
    from voice_agent.providers import build_tts  # type: ignore[attr-defined]
    from voice_agent.providers.config import parse_providers_config  # type: ignore[attr-defined]

    config = parse_providers_config(mock_providers_new_schema)
    tts = build_tts(config, language="tr")
    assert tts is not None


@pytest.mark.skip(reason="Wave 0 stub — adapter module not yet created")
def test_build_stt_returns_http_stt(mock_providers_new_schema: dict) -> None:
    """ADAPT-01: build_stt should return HttpSTT/OpenAI-STT based on provider config."""
    from voice_agent.providers import build_stt  # type: ignore[attr-defined]
    from voice_agent.providers.config import parse_providers_config  # type: ignore[attr-defined]

    config = parse_providers_config(mock_providers_new_schema)
    stt = build_stt(config, language="tr")
    assert stt is not None


@pytest.mark.skip(reason="Wave 0 stub — adapter module not yet created")
def test_llm_custom_headers_applied(mock_providers_with_custom_headers: dict) -> None:
    """ADAPT-02: custom LLM headers should be propagated to request options."""
    from voice_agent.providers import build_llm  # type: ignore[attr-defined]
    from voice_agent.providers.config import parse_providers_config  # type: ignore[attr-defined]

    config = parse_providers_config(mock_providers_with_custom_headers)
    llm = build_llm(config)
    assert llm is not None


@pytest.mark.skip(reason="Wave 0 stub — adapter module not yet created")
def test_tts_custom_headers_applied(mock_providers_with_custom_headers: dict) -> None:
    """ADAPT-02: custom TTS headers should be propagated to adapter construction."""
    from voice_agent.providers import build_tts  # type: ignore[attr-defined]
    from voice_agent.providers.config import parse_providers_config  # type: ignore[attr-defined]

    config = parse_providers_config(mock_providers_with_custom_headers)
    tts = build_tts(config, language="tr")
    assert tts is not None


@pytest.mark.skip(reason="Wave 0 stub — adapter module not yet created")
def test_llm_custom_body_params(mock_providers_with_custom_body: dict) -> None:
    """ADAPT-03: custom LLM body params should map into request body overrides."""
    from voice_agent.providers import build_llm  # type: ignore[attr-defined]
    from voice_agent.providers.config import parse_providers_config  # type: ignore[attr-defined]

    config = parse_providers_config(mock_providers_with_custom_body)
    llm = build_llm(config)
    assert llm is not None


@pytest.mark.skip(reason="Wave 0 stub — adapter module not yet created")
def test_tts_custom_body_params(mock_providers_with_custom_body: dict) -> None:
    """ADAPT-03: custom TTS body params should map into adapter body params."""
    from voice_agent.providers import build_tts  # type: ignore[attr-defined]
    from voice_agent.providers.config import parse_providers_config  # type: ignore[attr-defined]

    config = parse_providers_config(mock_providers_with_custom_body)
    tts = build_tts(config, language="tr")
    assert tts is not None


@pytest.mark.skip(reason="Wave 0 stub — adapter module not yet created")
def test_custom_endpoint_path_tts(mock_providers_with_custom_path: dict) -> None:
    """ADAPT-04: custom TTS endpointPath should map to adapter synth path."""
    from voice_agent.providers import build_tts  # type: ignore[attr-defined]
    from voice_agent.providers.config import parse_providers_config  # type: ignore[attr-defined]

    config = parse_providers_config(mock_providers_with_custom_path)
    tts = build_tts(config, language="tr")
    assert tts is not None


@pytest.mark.skip(reason="Wave 0 stub — adapter module not yet created")
def test_custom_endpoint_path_stt(mock_providers_with_custom_path: dict) -> None:
    """ADAPT-04: custom STT endpointPath should map to adapter transcribe path."""
    from voice_agent.providers import build_stt  # type: ignore[attr-defined]
    from voice_agent.providers.config import parse_providers_config  # type: ignore[attr-defined]

    config = parse_providers_config(mock_providers_with_custom_path)
    stt = build_stt(config, language="tr")
    assert stt is not None


@pytest.mark.skip(reason="Wave 0 stub — adapter module not yet created")
def test_response_remap(mock_providers_new_schema: dict) -> None:
    """ADAPT-05: remap_response should transform provider-specific response fields."""
    from voice_agent.providers.config import remap_response  # type: ignore[attr-defined]

    result = remap_response({"transcript": "hello"}, {"transcript": "text"})
    assert result == {"text": "hello"}


@pytest.mark.skip(reason="Wave 0 stub — adapter module not yet created")
def test_parse_config_old_schema(mock_providers_old_schema: dict) -> None:
    """Backward compatibility: old provider schema should normalize into typed config."""
    from voice_agent.providers.config import parse_providers_config  # type: ignore[attr-defined]

    config = parse_providers_config(mock_providers_old_schema)
    assert config is not None


@pytest.mark.skip(reason="Wave 0 stub — adapter module not yet created")
def test_parse_config_new_schema(mock_providers_new_schema: dict) -> None:
    """ADAPT baseline: new profile schema should parse into typed config."""
    from voice_agent.providers.config import parse_providers_config  # type: ignore[attr-defined]

    config = parse_providers_config(mock_providers_new_schema)
    assert config is not None
