from __future__ import annotations

from livekit.plugins.openai import LLM as OpenAILLM

from voice_agent.entrypoint import N8nLLM, _build_llm, _build_stt, _build_tts
from voice_agent.providers.http_stt import HttpSTT
from voice_agent.providers.http_tts import HttpTTS


def test_build_stt_via_entrypoint(mock_providers_old_schema: dict) -> None:
    stt = _build_stt(mock_providers_old_schema, "en")
    assert isinstance(stt, HttpSTT)
    assert stt._base_url == "https://stt-old.example.com"
    assert stt._transcribe_path == "/v1/audio/transcriptions"


def test_build_stt_new_schema(mock_providers_new_schema: dict) -> None:
    stt = _build_stt(mock_providers_new_schema, "tr")
    assert isinstance(stt, HttpSTT)
    assert stt._transcribe_path == "/v1/audio/transcriptions"


def test_build_llm_n8n_unchanged(mock_providers_n8n_only: dict, monkeypatch) -> None:
    monkeypatch.setattr("voice_agent.entrypoint._resolve_n8n_webhook", lambda *args, **kwargs: "https://n8n.example.com/webhook/ok")
    llm = _build_llm(mock_providers_n8n_only)
    assert isinstance(llm, N8nLLM)


def test_build_llm_openai_path(mock_providers_new_schema: dict, monkeypatch) -> None:
    monkeypatch.setattr("voice_agent.entrypoint._resolve_n8n_webhook", lambda *args, **kwargs: "")
    providers = dict(mock_providers_new_schema)
    providers.pop("n8n", None)
    llm = _build_llm(providers)
    assert hasattr(llm, "_inner")
    assert isinstance(llm._inner, OpenAILLM)
    assert llm._inner._opts.extra_headers.get("X-Provider") == "new-llm"


def test_build_tts_via_entrypoint(mock_providers_old_schema: dict) -> None:
    tts = _build_tts(mock_providers_old_schema, "en")
    assert isinstance(tts, HttpTTS)
    assert tts._synth_path == "/tts"


def test_build_tts_new_schema(mock_providers_new_schema: dict) -> None:
    tts = _build_tts(mock_providers_new_schema, "tr")
    assert isinstance(tts, HttpTTS)
    assert tts._synth_path == "/tts"
