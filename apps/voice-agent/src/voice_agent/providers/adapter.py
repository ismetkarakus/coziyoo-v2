from __future__ import annotations

from typing import Any

import httpx
import openai


def build_openai_client(
    base_url: str,
    api_key: str,
    extra_headers: dict[str, str] | None = None,
) -> openai.AsyncClient:
    timeout = httpx.Timeout(connect=15.0, read=30.0, write=5.0, pool=5.0)
    http_client = httpx.AsyncClient(
        timeout=timeout,
        follow_redirects=True,
        headers=extra_headers or {},
    )
    return openai.AsyncClient(
        api_key=api_key,
        base_url=base_url,
        max_retries=0,
        http_client=http_client,
    )


def remap_response(response: dict[str, Any], field_map: dict[str, str]) -> dict[str, Any]:
    if not field_map:
        return dict(response)

    out = dict(response)
    for source, target in field_map.items():
        if source in out:
            value = out.pop(source)
            out[target] = value
    return out
