from __future__ import annotations

import json
from typing import Any

import aiohttp


async def api_request(
    *,
    api_base_url: str,
    method: str,
    path: str,
    access_token: str | None,
    json_body: dict[str, Any] | None = None,
) -> tuple[int, Any]:
    base = api_base_url.rstrip("/")
    if not base:
        raise RuntimeError("API_BASE_URL is required for dashboard proxy requests")
    url = f"{base}{path}"

    headers: dict[str, str] = {"accept": "application/json"}
    if json_body is not None:
        headers["content-type"] = "application/json"
    if access_token:
        headers["authorization"] = f"Bearer {access_token}"

    timeout = aiohttp.ClientTimeout(total=30)
    async with aiohttp.ClientSession(timeout=timeout) as session:
        async with session.request(method.upper(), url, headers=headers, json=json_body) as response:
            content_type = (response.headers.get("content-type") or "").lower()
            text = await response.text()
            if "application/json" in content_type:
                try:
                    return response.status, json.loads(text)
                except json.JSONDecodeError:
                    return response.status, {"error": {"code": "INVALID_JSON", "message": text}}
            return response.status, text


async def api_binary_request(
    *,
    api_base_url: str,
    method: str,
    path: str,
    access_token: str | None,
    json_body: dict[str, Any] | None = None,
) -> tuple[int, bytes, str]:
    base = api_base_url.rstrip("/")
    if not base:
        raise RuntimeError("API_BASE_URL is required for dashboard proxy requests")
    url = f"{base}{path}"

    headers: dict[str, str] = {"accept": "*/*"}
    if json_body is not None:
        headers["content-type"] = "application/json"
    if access_token:
        headers["authorization"] = f"Bearer {access_token}"

    timeout = aiohttp.ClientTimeout(total=45)
    async with aiohttp.ClientSession(timeout=timeout) as session:
        async with session.request(method.upper(), url, headers=headers, json=json_body) as response:
            content_type = response.headers.get("content-type") or "application/octet-stream"
            data = await response.read()
            return response.status, data, content_type
