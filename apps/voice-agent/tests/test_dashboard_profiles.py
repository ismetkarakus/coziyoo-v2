from __future__ import annotations

import importlib
import os

from fastapi.testclient import TestClient

os.environ.setdefault("AI_SERVER_SHARED_SECRET", "0123456789abcdef")
os.environ.setdefault("API_BASE_URL", "https://api.coziyoo.com")

join_api = importlib.import_module("voice_agent.join_api")


def test_unauthorized_dashboard_access_redirects_to_login() -> None:
    client = TestClient(join_api.app)
    response = client.get("/dashboard/assistants", follow_redirects=False)
    assert response.status_code == 303
    assert response.headers.get("location") == "/dashboard/login"


def test_profile_list_route_calls_bff_helper(monkeypatch) -> None:
    calls: list[tuple[str, str, str]] = []

    async def fake_ensure_access_token(*, request, api_base_url):
        return "token-1", None

    async def fake_api_request(*, api_base_url, method, path, access_token, json_body=None):
        calls.append((method, path, api_base_url))
        return 200, {"data": []}

    monkeypatch.setattr(join_api, "ensure_access_token", fake_ensure_access_token)
    monkeypatch.setattr(join_api, "api_request", fake_api_request)

    client = TestClient(join_api.app)
    response = client.get("/dashboard/assistants")
    assert response.status_code == 200
    assert ("GET", "/v1/admin/agent-profiles", "https://api.coziyoo.com") in calls


def test_assistants_load_selects_default_profile_and_renders_editor(monkeypatch) -> None:
    async def fake_ensure_access_token(*, request, api_base_url):
        return "token-1", None

    async def fake_fetch_profiles(access_token: str):
        return [
            {"id": "default", "name": "Default", "is_active": True},
            {"id": "other", "name": "Other", "is_active": False},
        ], None

    async def fake_api_request(*, api_base_url, method, path, access_token, json_body=None):
        if method == "GET" and path == "/v1/admin/livekit/agent-settings/default":
            return 200, {"data": {"deviceId": "default", "agentName": "Default", "ttsConfig": {}}}
        return 404, {"error": {"code": "NOT_FOUND"}}

    monkeypatch.setattr(join_api, "ensure_access_token", fake_ensure_access_token)
    monkeypatch.setattr(join_api, "_fetch_profiles", fake_fetch_profiles)
    monkeypatch.setattr(join_api, "api_request", fake_api_request)

    client = TestClient(join_api.app)
    response = client.get("/dashboard/assistants")
    assert response.status_code == 200
    assert '/dashboard/profiles/default/save' in response.text
    assert 'id="asst-row-default"' in response.text
    assert "asst-row selected" in response.text


def test_profiles_route_redirects_to_assistants() -> None:
    client = TestClient(join_api.app)
    response = client.get("/dashboard/profiles", follow_redirects=False)
    assert response.status_code == 303
    assert response.headers.get("location") == "/dashboard/assistants"


def test_import_curl_handler_route_exists() -> None:
    match = [
        route
        for route in join_api.app.routes
        if route.path == "/dashboard/profiles/{profile_id}/import-curl" and "POST" in route.methods
    ]
    assert match, "POST /dashboard/profiles/{profile_id}/import-curl route not found"


def test_dashboard_test_routes_render_status_partial(monkeypatch) -> None:
    async def fake_ensure_access_token(*, request, api_base_url):
        return "token-1", None

    async def fake_api_request(*, api_base_url, method, path, access_token, json_body=None):
        if path.endswith("/test/stt/transcribe"):
            return 200, {"data": {"ok": True, "status": 200, "transcript": "Merhaba"}}
        return 200, {"data": {"ok": True, "status": 200}}

    async def fake_api_binary_request(*, api_base_url, method, path, access_token, json_body=None):
        return 200, b"\x00\x01\x02", "audio/mpeg"

    monkeypatch.setattr(join_api, "ensure_access_token", fake_ensure_access_token)
    monkeypatch.setattr(join_api, "api_request", fake_api_request)
    monkeypatch.setattr(join_api, "api_binary_request", fake_api_binary_request)

    client = TestClient(join_api.app)
    base_form = {
        "llm_config.base_url": "https://llm.example.com",
        "llm_config.model": "gpt-test",
        "tts_config.base_url": "https://tts.example.com",
        "stt_config.base_url": "https://stt.example.com",
        "n8n_config.base_url": "https://n8n.example.com",
        "stt_audio_base64": "dGVzdA==",
    }

    responses = [
        client.post("/dashboard/test/llm", data=base_form),
        client.post("/dashboard/test/tts", data=base_form),
        client.post("/dashboard/test/stt", data=base_form),
        client.post("/dashboard/test/stt/transcribe", data=base_form),
        client.post("/dashboard/test/n8n", data=base_form),
    ]

    for response in responses:
        assert response.status_code == 200
        assert "text/html" in response.headers.get("content-type", "")
        assert "data-status-state" in response.text


def test_dashboard_test_llm_handles_string_error_payload(monkeypatch) -> None:
    async def fake_ensure_access_token(*, request, api_base_url):
        return "token-1", None

    async def fake_api_request(*, api_base_url, method, path, access_token, json_body=None):
        if path.endswith("/test/llm"):
            return 404, "Cannot POST /v1/admin/livekit/test/llm"
        return 200, {"data": {"ok": True, "status": 200}}

    async def fake_direct_llm_test(*, llm_cfg, prompt):
        return False, "LLM request failed", "Cannot POST /v1/admin/livekit/test/llm"

    monkeypatch.setattr(join_api, "ensure_access_token", fake_ensure_access_token)
    monkeypatch.setattr(join_api, "api_request", fake_api_request)
    monkeypatch.setattr(join_api, "_direct_llm_test", fake_direct_llm_test)

    client = TestClient(join_api.app)
    response = client.post("/dashboard/test/llm", data={"llm_config.base_url": "https://llm.example.com"})
    assert response.status_code == 200
    assert "LLM test failed" in response.text
    assert "Cannot POST /v1/admin/livekit/test/llm" in response.text


def test_dashboard_test_llm_falls_back_to_direct_provider(monkeypatch) -> None:
    async def fake_ensure_access_token(*, request, api_base_url):
        return "token-1", None

    async def fake_api_request(*, api_base_url, method, path, access_token, json_body=None):
        if path.endswith("/test/llm"):
            return 404, "Cannot POST /v1/admin/livekit/test/llm"
        return 200, {"data": {"ok": True, "status": 200}}

    async def fake_direct_llm_test(*, llm_cfg, prompt):
        return True, "Provider responded with status 200.", None

    monkeypatch.setattr(join_api, "ensure_access_token", fake_ensure_access_token)
    monkeypatch.setattr(join_api, "api_request", fake_api_request)
    monkeypatch.setattr(join_api, "_direct_llm_test", fake_direct_llm_test)

    client = TestClient(join_api.app)
    response = client.post("/dashboard/test/llm", data={"llm_config.base_url": "https://llm.example.com"})
    assert response.status_code == 200
    assert "LLM test successful" in response.text
    assert "Provider responded with status 200" in response.text


def test_profile_editor_legacy_id_fallback(monkeypatch) -> None:
    async def fake_ensure_access_token(*, request, api_base_url):
        return "token-1", None

    async def fake_api_request(*, api_base_url, method, path, access_token, json_body=None):
        if path == "/v1/admin/agent-profiles/aktif-profil-9":
            return 404, {"error": {"code": "NOT_FOUND"}}
        if path == "/v1/admin/livekit/agent-settings/aktif-profil-9":
            return 200, {
                "data": {
                    "deviceId": "aktif-profil-9",
                    "agentName": "Aktif Profil 9",
                    "voiceLanguage": "tr",
                    "ollamaModel": "llama3.1:8b",
                    "ttsConfig": {
                        "baseUrl": "https://tts.example.com",
                        "stt": {"baseUrl": "https://stt.example.com", "transcribePath": "/v1/audio/transcriptions"},
                        "llm": {"baseUrl": "https://llm.example.com/v1", "endpointPath": "/v1/chat/completions"},
                        "n8n": {"baseUrl": "https://n8n.example.com"},
                    },
                }
            }
        return 200, {"data": []}

    monkeypatch.setattr(join_api, "ensure_access_token", fake_ensure_access_token)
    monkeypatch.setattr(join_api, "api_request", fake_api_request)

    client = TestClient(join_api.app)
    response = client.get("/dashboard/profiles/aktif-profil-9")
    assert response.status_code == 200
    assert 'value="Aktif Profil 9"' in response.text
    assert "https://llm.example.com/v1" in response.text


def test_profile_save_legacy_id_fallback(monkeypatch) -> None:
    calls: list[tuple[str, str, dict | None]] = []

    async def fake_ensure_access_token(*, request, api_base_url):
        return "token-1", None

    async def fake_api_request(*, api_base_url, method, path, access_token, json_body=None):
        calls.append((method, path, json_body))
        if method == "PUT" and path == "/v1/admin/agent-profiles/aktif-profil-9":
            return 404, {"error": {"code": "NOT_FOUND"}}
        if method == "PUT" and path == "/v1/admin/livekit/agent-settings/aktif-profil-9":
            return 200, {"data": {"deviceId": "aktif-profil-9"}}
        if method == "GET" and path == "/v1/admin/livekit/agent-settings/aktif-profil-9":
            return 200, {"data": {"deviceId": "aktif-profil-9", "agentName": "Aktif Profil 9", "ttsConfig": {}}}
        return 200, {"data": {}}

    monkeypatch.setattr(join_api, "ensure_access_token", fake_ensure_access_token)
    monkeypatch.setattr(join_api, "api_request", fake_api_request)

    client = TestClient(join_api.app)
    response = client.post(
        "/dashboard/profiles/aktif-profil-9/save",
        data={
            "name": "Aktif Profil 9",
            "voice_language": "tr",
            "system_prompt": "test",
            "llm_config.api_key_id": "llm.openai.prod",
            "llm_config.model": "gpt-4o-mini",
            "tts_config.provider": "openai",
            "tts_config.language": "multilingual",
            "tts_config.api_key_id": "tts.openai.prod",
            "tts_config.model": "alloy",
            "tts_config.models_path": "/v1/models",
            "stt_config.provider": "deepgram",
            "stt_config.language": "multilingual",
            "stt_config.api_key_id": "stt.deepgram.prod",
            "stt_config.model": "nova-2",
            "stt_config.models_path": "/v1/models",
        },
        follow_redirects=False,
    )
    assert response.status_code == 303
    assert response.headers.get("location") == "/dashboard/assistants"
    save_call = next((c for c in calls if c[0] == "PUT" and c[1] == "/v1/admin/livekit/agent-settings/aktif-profil-9"), None)
    assert save_call is not None
    assert isinstance(save_call[2], dict)
    assert save_call[2].get("ollamaModel") == "gpt-4o-mini"
    assert save_call[2].get("sttModel") == "nova-2"
    assert save_call[2].get("sttProvider") == "deepgram"
    assert (save_call[2].get("ttsConfig") or {}).get("provider") == "openai"
    assert (save_call[2].get("ttsConfig") or {}).get("language") == "multilingual"
    assert (save_call[2].get("ttsConfig") or {}).get("modelsPath") == "/v1/models"
    assert (save_call[2].get("ttsConfig") or {}).get("model") == "alloy"
    assert ((save_call[2].get("ttsConfig") or {}).get("stt") or {}).get("provider") == "deepgram"
    assert ((save_call[2].get("ttsConfig") or {}).get("stt") or {}).get("language") == "multilingual"
    assert ((save_call[2].get("ttsConfig") or {}).get("stt") or {}).get("modelsPath") == "/v1/models"
    assert ((save_call[2].get("ttsConfig") or {}).get("llm") or {}).get("apiKeyId") == "llm.openai.prod"
    assert (save_call[2].get("ttsConfig") or {}).get("apiKeyId") == "tts.openai.prod"
    assert ((save_call[2].get("ttsConfig") or {}).get("stt") or {}).get("apiKeyId") == "stt.deepgram.prod"


def test_legacy_profile_editor_prefers_nested_llm_model(monkeypatch) -> None:
    async def fake_ensure_access_token(*, request, api_base_url):
        return "token-1", None

    async def fake_api_request(*, api_base_url, method, path, access_token, json_body=None):
        if method == "GET" and path == "/v1/admin/livekit/agent-settings/default":
            return 200, {
                "data": {
                    "deviceId": "default",
                    "agentName": "Default",
                    "ollamaModel": "old-top-level-model",
                    "sttModel": "old-stt-model",
                    "ttsConfig": {
                        "provider": "openai",
                        "language": "multilingual",
                        "apiKeyId": "tts.openai.prod",
                        "modelsPath": "/v1/models",
                        "model": "new-tts-model",
                        "stt": {
                            "provider": "deepgram",
                            "language": "multilingual",
                            "apiKeyId": "stt.deepgram.prod",
                            "modelsPath": "/v1/models",
                            "model": "new-stt-model",
                        },
                        "llm": {"model": "new-nested-model", "apiKeyId": "llm.openai.prod"},
                    },
                }
            }
        return 404, {"error": {"code": "NOT_FOUND"}}

    monkeypatch.setattr(join_api, "ensure_access_token", fake_ensure_access_token)
    monkeypatch.setattr(join_api, "api_request", fake_api_request)

    client = TestClient(join_api.app)
    response = client.get("/dashboard/profiles/default")
    assert response.status_code == 200
    assert '<option value="new-nested-model">new-nested-model</option>' in response.text
    assert '<option value="new-stt-model">new-stt-model</option>' in response.text
    assert '<option value="new-tts-model">new-tts-model</option>' in response.text
    assert 'name="tts_config.models_path" value="/v1/models"' in response.text
    assert 'name="stt_config.models_path" value="/v1/models"' in response.text
    assert 'id="llm-api-key-id"' in response.text
    assert 'id="tts-api-key-id"' in response.text
    assert 'id="stt-api-key-id"' in response.text


def test_dashboard_models_uses_api_key_id_when_direct_key_missing(monkeypatch) -> None:
    captured: dict[str, dict | None] = {}

    async def fake_ensure_access_token(*, request, api_base_url):
        return "token-1", None

    async def fake_api_request(*, api_base_url, method, path, access_token, json_body=None):
        if method == "GET" and path == "/v1/admin/livekit/agent-settings/default":
            return 200, {
                "data": {
                    "ttsConfig": {
                        "providerApiKeys": {
                            "llm.openai.prod": "sk-from-provider-map",
                        }
                    }
                }
            }
        if method == "POST" and path == "/v1/admin/livekit/llm/models":
            captured["json_body"] = json_body
            return 200, {"data": {"models": ["gpt-4o-mini"]}}
        return 200, {"data": {}}

    monkeypatch.setattr(join_api, "ensure_access_token", fake_ensure_access_token)
    monkeypatch.setattr(join_api, "api_request", fake_api_request)

    client = TestClient(join_api.app)
    response = client.post(
        "/dashboard/models",
        json={
            "baseUrl": "https://api.openai.com",
            "modelsPath": "/v1/models",
            "apiKey": "",
            "apiKeyId": "llm.openai.prod",
            "customHeaders": {},
        },
    )
    assert response.status_code == 200
    assert response.json().get("models") == ["gpt-4o-mini"]
    posted = captured.get("json_body") or {}
    assert posted.get("apiKey") == "sk-from-provider-map"


def test_placeholder_routes_require_auth_and_render(monkeypatch) -> None:
    client = TestClient(join_api.app)
    protected_paths = [
        "/dashboard/tools",
        "/dashboard/phone-numbers",
        "/dashboard/org",
        "/dashboard/squads",
        "/dashboard/test-suites",
        "/dashboard/evals",
        "/dashboard/library/voice",
    ]

    # Unauthenticated users are redirected to login.
    for path in protected_paths:
        redirect_response = client.get(path, follow_redirects=False)
        assert redirect_response.status_code == 303
        assert redirect_response.headers.get("location") == "/dashboard/login"

    async def fake_ensure_access_token(*, request, api_base_url):
        return "token-1", None

    monkeypatch.setattr(join_api, "ensure_access_token", fake_ensure_access_token)
    authed_client = TestClient(join_api.app)

    for path in protected_paths:
        response = authed_client.get(path, follow_redirects=False)
        assert response.status_code == 200
        assert "Coming soon" in response.text


def test_api_keys_page_requires_auth_and_renders(monkeypatch) -> None:
    client = TestClient(join_api.app)
    redirect = client.get("/dashboard/org/api-keys", follow_redirects=False)
    assert redirect.status_code == 303
    assert redirect.headers.get("location") == "/dashboard/login"

    async def fake_ensure_access_token(*, request, api_base_url):
        return "token-1", None

    async def fake_api_request(*, api_base_url, method, path, access_token, json_body=None):
        if method == "GET" and path == "/v1/admin/livekit/agent-settings/default":
            return 200, {"data": {"ttsConfig": {"providerApiKeys": {"llm.openai": "sk-openai", "tts.openai": "sk-tts"}}}}
        return 200, {"data": {}}

    monkeypatch.setattr(join_api, "ensure_access_token", fake_ensure_access_token)
    monkeypatch.setattr(join_api, "api_request", fake_api_request)
    authed = TestClient(join_api.app)
    response = authed.get("/dashboard/org/api-keys")
    assert response.status_code == 200
    assert "API Keys" in response.text
    assert "Added Keys" in response.text
    assert "OpenAI" in response.text
    assert "sk-o...enai" in response.text
    assert response.text.count('value="openai"') == 1


def test_api_keys_save_posts_provider_map(monkeypatch) -> None:
    calls: list[tuple[str, str, dict | None]] = []

    async def fake_ensure_access_token(*, request, api_base_url):
        return "token-1", None

    async def fake_api_request(*, api_base_url, method, path, access_token, json_body=None):
        calls.append((method, path, json_body))
        if method == "GET" and path == "/v1/admin/livekit/agent-settings/default":
            return 200, {"data": {"agentName": "coziyoo-agent", "ttsConfig": {}}}
        if method == "PUT" and path == "/v1/admin/livekit/agent-settings/default":
            return 200, {"data": {"ok": True}}
        return 200, {"data": {}}

    monkeypatch.setattr(join_api, "ensure_access_token", fake_ensure_access_token)
    monkeypatch.setattr(join_api, "api_request", fake_api_request)

    client = TestClient(join_api.app)
    response = client.post(
        "/dashboard/org/api-keys",
        data={
            "provider_keys.llm.openai": "sk-openai",
            "provider_keys.stt.deepgram": "dg-key",
            "provider_keys.tts.elevenlabs": "el-key",
            "provider_keys.llm.custom": "custom-llm",
        },
    )
    assert response.status_code == 200
    put_call = next((c for c in calls if c[0] == "PUT" and c[1] == "/v1/admin/livekit/agent-settings/default"), None)
    assert put_call is not None
    payload = put_call[2] or {}
    keys = (((payload.get("ttsConfig") or {}).get("providerApiKeys")) or {})
    assert keys.get("llm.openai") == "sk-openai"
    assert keys.get("stt.deepgram") == "dg-key"
    assert keys.get("tts.elevenlabs") == "el-key"
    assert keys.get("llm.custom") == "custom-llm"


def test_api_keys_add_action_saves_single_provider_key(monkeypatch) -> None:
    calls: list[tuple[str, str, dict | None]] = []

    async def fake_ensure_access_token(*, request, api_base_url):
        return "token-1", None

    async def fake_api_request(*, api_base_url, method, path, access_token, json_body=None):
        calls.append((method, path, json_body))
        if method == "GET" and path == "/v1/admin/livekit/agent-settings/default":
            return 200, {"data": {"agentName": "coziyoo-agent", "ttsConfig": {"providerApiKeys": {"llm.openai": "old-key"}}}}
        if method == "PUT" and path == "/v1/admin/livekit/agent-settings/default":
            return 200, {"data": {"ok": True}}
        return 200, {"data": {}}

    monkeypatch.setattr(join_api, "ensure_access_token", fake_ensure_access_token)
    monkeypatch.setattr(join_api, "api_request", fake_api_request)

    client = TestClient(join_api.app)
    response = client.post(
        "/dashboard/org/api-keys",
        data={"action": "add", "provider_id": "stt.deepgram", "provider_key": "dg-new"},
    )
    assert response.status_code == 200
    put_call = next((c for c in calls if c[0] == "PUT" and c[1] == "/v1/admin/livekit/agent-settings/default"), None)
    assert put_call is not None
    payload = put_call[2] or {}
    keys = (((payload.get("ttsConfig") or {}).get("providerApiKeys")) or {})
    assert keys.get("llm.openai") == "old-key"
    assert keys.get("stt.deepgram") == "dg-new"


def test_api_keys_add_custom_provider_uses_named_key_id(monkeypatch) -> None:
    calls: list[tuple[str, str, dict | None]] = []

    async def fake_ensure_access_token(*, request, api_base_url):
        return "token-1", None

    async def fake_api_request(*, api_base_url, method, path, access_token, json_body=None):
        calls.append((method, path, json_body))
        if method == "GET" and path == "/v1/admin/livekit/agent-settings/default":
            return 200, {"data": {"agentName": "coziyoo-agent", "ttsConfig": {"providerApiKeys": {}}}}
        if method == "PUT" and path == "/v1/admin/livekit/agent-settings/default":
            return 200, {"data": {"ok": True}}
        return 200, {"data": {}}

    monkeypatch.setattr(join_api, "ensure_access_token", fake_ensure_access_token)
    monkeypatch.setattr(join_api, "api_request", fake_api_request)

    client = TestClient(join_api.app)
    response = client.post(
        "/dashboard/org/api-keys",
        data={"action": "add", "provider_id": "llm.custom", "api_key_name": "Open Router", "provider_key": "or-key"},
    )
    assert response.status_code == 200
    put_call = next((c for c in calls if c[0] == "PUT" and c[1] == "/v1/admin/livekit/agent-settings/default"), None)
    assert put_call is not None
    payload = put_call[2] or {}
    keys = (((payload.get("ttsConfig") or {}).get("providerApiKeys")) or {})
    assert keys.get("llm.custom.open-router") == "or-key"


def test_api_keys_add_named_non_custom_provider(monkeypatch) -> None:
    calls: list[tuple[str, str, dict | None]] = []

    async def fake_ensure_access_token(*, request, api_base_url):
        return "token-1", None

    async def fake_api_request(*, api_base_url, method, path, access_token, json_body=None):
        calls.append((method, path, json_body))
        if method == "GET" and path == "/v1/admin/livekit/agent-settings/default":
            return 200, {"data": {"agentName": "coziyoo-agent", "ttsConfig": {"providerApiKeys": {}}}}
        if method == "PUT" and path == "/v1/admin/livekit/agent-settings/default":
            return 200, {"data": {"ok": True}}
        return 200, {"data": {}}

    monkeypatch.setattr(join_api, "ensure_access_token", fake_ensure_access_token)
    monkeypatch.setattr(join_api, "api_request", fake_api_request)

    client = TestClient(join_api.app)
    response = client.post(
        "/dashboard/org/api-keys",
        data={"action": "add", "provider_id": "llm.openai", "api_key_name": "Prod", "provider_key": "sk-prod"},
    )
    assert response.status_code == 200
    put_call = next((c for c in calls if c[0] == "PUT" and c[1] == "/v1/admin/livekit/agent-settings/default"), None)
    assert put_call is not None
    payload = put_call[2] or {}
    keys = (((payload.get("ttsConfig") or {}).get("providerApiKeys")) or {})
    assert keys.get("llm.openai.prod") == "sk-prod"
