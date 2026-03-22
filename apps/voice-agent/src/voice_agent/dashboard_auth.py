from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Any

from fastapi import Request
from fastapi.responses import RedirectResponse, Response

from .dashboard_api import api_request

ACCESS_COOKIE = "coziyoo_admin_at"
REFRESH_COOKIE = "coziyoo_admin_rt"


@dataclass
class SessionTokens:
    access_token: str | None
    refresh_token: str | None


def _cookie_secure() -> bool:
    value = str(os.getenv("DASHBOARD_COOKIE_SECURE", "")).strip().lower()
    if value in {"1", "true", "yes"}:
        return True
    if value in {"0", "false", "no"}:
        return False
    return False


def read_tokens(request: Request) -> SessionTokens:
    return SessionTokens(
        access_token=request.cookies.get(ACCESS_COOKIE),
        refresh_token=request.cookies.get(REFRESH_COOKIE),
    )


def set_auth_cookies(response: Response, access_token: str, refresh_token: str) -> None:
    secure = _cookie_secure()
    response.set_cookie(ACCESS_COOKIE, access_token, httponly=True, secure=secure, samesite="lax", path="/")
    response.set_cookie(REFRESH_COOKIE, refresh_token, httponly=True, secure=secure, samesite="lax", path="/")


def clear_auth_cookies(response: Response) -> None:
    response.delete_cookie(ACCESS_COOKIE, path="/")
    response.delete_cookie(REFRESH_COOKIE, path="/")


async def refresh_access_token(*, api_base_url: str, refresh_token: str) -> SessionTokens | None:
    status, payload = await api_request(
        api_base_url=api_base_url,
        method="POST",
        path="/v1/admin/auth/refresh",
        access_token=None,
        json_body={"refreshToken": refresh_token},
    )
    if status != 200 or not isinstance(payload, dict):
        return None
    tokens = (payload.get("data") or {}).get("tokens") if isinstance(payload.get("data"), dict) else None
    if not isinstance(tokens, dict):
        return None
    access = tokens.get("accessToken")
    refresh = tokens.get("refreshToken")
    if not isinstance(access, str) or not isinstance(refresh, str):
        return None
    return SessionTokens(access_token=access, refresh_token=refresh)


async def ensure_access_token(
    *,
    request: Request,
    api_base_url: str,
) -> tuple[str | None, Response | None]:
    tokens = read_tokens(request)
    if tokens.access_token:
        return tokens.access_token, None
    if not tokens.refresh_token:
        return None, RedirectResponse(url="/dashboard/login", status_code=303)

    refreshed = await refresh_access_token(api_base_url=api_base_url, refresh_token=tokens.refresh_token)
    if refreshed is None:
        response = RedirectResponse(url="/dashboard/login", status_code=303)
        clear_auth_cookies(response)
        return None, response

    response = RedirectResponse(url=str(request.url), status_code=303)
    set_auth_cookies(response, refreshed.access_token or "", refreshed.refresh_token or "")
    return None, response


def extract_error_message(payload: Any, fallback: str) -> str:
    if not isinstance(payload, dict):
        return fallback
    error = payload.get("error")
    if isinstance(error, dict) and isinstance(error.get("message"), str):
        return error["message"]
    return fallback
