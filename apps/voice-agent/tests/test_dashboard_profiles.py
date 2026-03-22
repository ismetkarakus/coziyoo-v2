from __future__ import annotations

import importlib
import os

from fastapi.testclient import TestClient

os.environ.setdefault("AI_SERVER_SHARED_SECRET", "0123456789abcdef")
os.environ.setdefault("API_BASE_URL", "https://api.coziyoo.com")

join_api = importlib.import_module("voice_agent.join_api")


def test_unauthorized_dashboard_access_redirects_to_login() -> None:
    client = TestClient(join_api.app)
    response = client.get("/dashboard/profiles", follow_redirects=False)
    assert response.status_code == 303
    assert response.headers.get("location") == "/dashboard/login"


def test_profile_list_route_calls_bff_helper(monkeypatch) -> None:
    captured: dict[str, str] = {}

    async def fake_ensure_access_token(*, request, api_base_url):
        return "token-1", None

    async def fake_api_request(*, api_base_url, method, path, access_token, json_body=None):
        captured["path"] = path
        captured["method"] = method
        captured["api_base_url"] = api_base_url
        return 200, {"data": []}

    monkeypatch.setattr(join_api, "ensure_access_token", fake_ensure_access_token)
    monkeypatch.setattr(join_api, "api_request", fake_api_request)

    client = TestClient(join_api.app)
    response = client.get("/dashboard/profiles")
    assert response.status_code == 200
    assert captured["path"] == "/v1/admin/agent-profiles"
    assert captured["method"] == "GET"
    assert captured["api_base_url"] == "https://api.coziyoo.com"


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
