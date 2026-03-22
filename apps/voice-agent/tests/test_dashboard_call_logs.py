from __future__ import annotations

import importlib
import os

from fastapi.testclient import TestClient

os.environ.setdefault("AI_SERVER_SHARED_SECRET", "0123456789abcdef")
os.environ.setdefault("API_BASE_URL", "https://api.coziyoo.com")

join_api = importlib.import_module("voice_agent.join_api")


def test_call_logs_route_passes_profile_and_date_filters(monkeypatch) -> None:
    captured: dict[str, str] = {}

    async def fake_ensure_access_token(*, request, api_base_url):
        return "token-1", None

    async def fake_api_request(*, api_base_url, method, path, access_token, json_body=None):
        if path.startswith("/v1/admin/agent-call-logs"):
            captured["path"] = path
            captured["method"] = method
            return 200, {"data": []}
        if path == "/v1/admin/agent-profiles":
            return 200, {"data": [{"id": "profile-1", "name": "Alpha", "is_active": True}]}
        return 200, {"data": []}

    monkeypatch.setattr(join_api, "ensure_access_token", fake_ensure_access_token)
    monkeypatch.setattr(join_api, "api_request", fake_api_request)

    client = TestClient(join_api.app)
    response = client.get(
        "/dashboard/call-logs?profileId=profile-1&from=2026-03-20&to=2026-03-22"
    )
    assert response.status_code == 200
    assert captured["method"] == "GET"
    assert "profileId=profile-1" in captured["path"]
    assert "from=2026-03-20T00%3A00%3A00.000Z" in captured["path"]
    assert "to=2026-03-22T23%3A59%3A59.999Z" in captured["path"]
    assert 'value="2026-03-20"' in response.text
    assert 'value="2026-03-22"' in response.text


def test_call_logs_template_has_hx_push_url_and_profile_filter(monkeypatch) -> None:
    async def fake_ensure_access_token(*, request, api_base_url):
        return "token-1", None

    async def fake_api_request(*, api_base_url, method, path, access_token, json_body=None):
        if path == "/v1/admin/agent-profiles":
            return 200, {"data": [{"id": "p1", "name": "One", "is_active": False}]}
        if path.startswith("/v1/admin/agent-call-logs"):
            return 200, {"data": []}
        return 200, {"data": []}

    monkeypatch.setattr(join_api, "ensure_access_token", fake_ensure_access_token)
    monkeypatch.setattr(join_api, "api_request", fake_api_request)

    client = TestClient(join_api.app)
    response = client.get("/dashboard/call-logs")
    assert response.status_code == 200
    assert 'hx-push-url="true"' in response.text
    assert 'name="profileId"' in response.text


def test_call_logs_table_handles_unknown_profile_and_zero_duration(monkeypatch) -> None:
    async def fake_ensure_access_token(*, request, api_base_url):
        return "token-1", None

    async def fake_api_request(*, api_base_url, method, path, access_token, json_body=None):
        if path.startswith("/v1/admin/agent-call-logs"):
            return 200, {
                "data": [
                    {
                        "id": "log-1",
                        "room_name": "room-x",
                        "profile_id": None,
                        "profile_name": None,
                        "started_at": "2026-03-22T10:00:00.000Z",
                        "ended_at": "2026-03-22T10:00:00.000Z",
                        "duration_seconds": 0,
                        "outcome": "completed",
                    }
                ]
            }
        return 200, {"data": []}

    monkeypatch.setattr(join_api, "ensure_access_token", fake_ensure_access_token)
    monkeypatch.setattr(join_api, "api_request", fake_api_request)

    client = TestClient(join_api.app)
    response = client.get("/dashboard/call-logs/table")
    assert response.status_code == 200
    assert "Unknown profile" in response.text
    assert "0s" in response.text
    assert "room-x" in response.text

