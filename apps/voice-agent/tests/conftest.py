from __future__ import annotations

import pytest


@pytest.fixture
def mock_providers_old_schema() -> dict:
    return {
        "llm": {
            "baseUrl": "https://llm-old.example.com",
            "model": "llama3.1:8b",
            "authHeader": "Bearer old-llm-token",
        },
        "stt": {
            "provider": "remote-speech-server",
            "baseUrl": "https://stt-old.example.com",
            "transcribePath": "/v1/audio/transcriptions",
            "model": "whisper-1",
            "queryParams": {"language": "tr"},
            "authHeader": "Bearer old-stt-token",
        },
        "tts": {
            "engine": "f5-tts",
            "baseUrl": "https://tts-old.example.com",
            "synthPath": "/tts",
            "textFieldName": "text",
            "bodyParams": {"speed": 1.0, "output_format": "wav"},
            "queryParams": {"voice": "alloy"},
            "authHeader": "Bearer old-tts-token",
        },
        "n8n": {
            "baseUrl": "https://n8n-old.example.com",
            "workflowId": "wf-old-123",
            "mcpWorkflowId": "wf-old-mcp-123",
            "webhookPath": "/webhook/old",
            "mcpWebhookPath": "/webhook/old-mcp",
            "authHeader": "Bearer old-n8n-token",
        },
    }


@pytest.fixture
def mock_providers_new_schema() -> dict:
    return {
        "llm": {
            "baseUrl": "https://llm-new.example.com/v1",
            "apiKey": "sk-llm-new",
            "model": "gpt-4o-mini",
            "endpointPath": "/v1/chat/completions",
            "customHeaders": {"X-Provider": "new-llm"},
            "customBodyParams": {"temperature": 0.2},
        },
        "stt": {
            "baseUrl": "https://stt-new.example.com",
            "apiKey": "sk-stt-new",
            "model": "whisper-1",
            "endpointPath": "/v1/audio/transcriptions",
            "customHeaders": {"X-STT": "1"},
            "customBodyParams": {"language": "tr"},
            "responseFieldMap": {},
        },
        "tts": {
            "baseUrl": "https://tts-new.example.com",
            "apiKey": "sk-tts-new",
            "model": "tts-1",
            "endpointPath": "/tts",
            "customHeaders": {"X-TTS": "1"},
            "customBodyParams": {"speed": 1.2},
            "voice": "alloy",
            "engine": "f5-tts",
            "textFieldName": "text",
        },
        "n8n": {
            "baseUrl": "https://n8n-new.example.com",
            "workflowId": "wf-new-123",
            "mcpWorkflowId": "wf-new-mcp-123",
            "webhookPath": "/webhook/new",
            "mcpWebhookPath": "/webhook/new-mcp",
        },
    }


@pytest.fixture
def mock_providers_with_custom_headers(mock_providers_new_schema: dict) -> dict:
    payload = dict(mock_providers_new_schema)
    headers = {"X-Custom-Auth": "Bearer test-token", "X-Request-ID": "test-123"}
    payload["llm"] = dict(payload["llm"], customHeaders=headers)
    payload["tts"] = dict(payload["tts"], customHeaders=headers)
    payload["stt"] = dict(payload["stt"], customHeaders=headers)
    return payload


@pytest.fixture
def mock_providers_with_custom_body(mock_providers_new_schema: dict) -> dict:
    payload = dict(mock_providers_new_schema)
    payload["llm"] = dict(payload["llm"], customBodyParams={"temperature": 0.7, "top_p": 0.9})
    payload["tts"] = dict(payload["tts"], customBodyParams={"speed": 1.5})
    return payload


@pytest.fixture
def mock_providers_with_custom_path(mock_providers_new_schema: dict) -> dict:
    payload = dict(mock_providers_new_schema)
    payload["llm"] = dict(payload["llm"], endpointPath="/custom/completions")
    payload["tts"] = dict(payload["tts"], endpointPath="/synthesize")
    payload["stt"] = dict(payload["stt"], endpointPath="/transcribe")
    return payload


@pytest.fixture
def mock_providers_n8n_only() -> dict:
    return {
        "n8n": {
            "baseUrl": "https://n8n-only.example.com",
            "workflowId": "wf-n8n-only",
            "mcpWorkflowId": "wf-n8n-only-mcp",
            "webhookPath": "/webhook/n8n-only",
            "mcpWebhookPath": "/webhook/n8n-only-mcp",
        }
    }
