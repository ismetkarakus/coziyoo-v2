#!/usr/bin/env python3
"""Coolify application operations CLI.

Supports:
- list applications
- list/set/delete env vars
- trigger deploy
- read deploy logs
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Dict, List, Optional


class CoolifyClient:
    def __init__(self, base_url: str, token: str, timeout: int = 30) -> None:
        self.base_url = base_url.rstrip("/")
        self.token = token
        self.timeout = timeout

    def _request(
        self,
        method: str,
        path: str,
        payload: Optional[Dict[str, Any]] = None,
        query: Optional[Dict[str, Any]] = None,
    ) -> Any:
        url = f"{self.base_url}{path}"
        if query:
            qs = urllib.parse.urlencode({k: v for k, v in query.items() if v is not None})
            if qs:
                url = f"{url}?{qs}"

        data = None
        headers = {
            "Accept": "application/json",
            "Authorization": f"Bearer {self.token}",
        }
        if payload is not None:
            data = json.dumps(payload).encode("utf-8")
            headers["Content-Type"] = "application/json"

        req = urllib.request.Request(url, data=data, headers=headers, method=method)
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as resp:
                body = resp.read().decode("utf-8")
                if not body:
                    return {}
                try:
                    return json.loads(body)
                except json.JSONDecodeError:
                    return body
        except urllib.error.HTTPError as e:
            body = e.read().decode("utf-8", errors="replace")
            raise RuntimeError(f"HTTP {e.code} {method} {path}: {body}") from e
        except urllib.error.URLError as e:
            raise RuntimeError(f"Request failed {method} {path}: {e}") from e

    def applications(self) -> List[Dict[str, Any]]:
        data = self._request("GET", "/api/v1/applications")
        if isinstance(data, list):
            return data
        if isinstance(data, dict):
            for key in ("data", "applications", "items"):
                maybe = data.get(key)
                if isinstance(maybe, list):
                    return maybe
        raise RuntimeError("Unexpected response shape for /applications")

    def resolve_app(self, selector: str) -> Dict[str, Any]:
        apps = self.applications()
        for app in apps:
            if str(app.get("uuid", "")) == selector:
                return app
        matches = [a for a in apps if str(a.get("name", "")).lower() == selector.lower()]
        if len(matches) == 1:
            return matches[0]
        if not matches:
            raise RuntimeError(f"Application not found: {selector}")
        names = ", ".join(str(a.get("uuid", "")) for a in matches)
        raise RuntimeError(f"Application name is ambiguous: {selector}. Matching UUIDs: {names}")

    def app_envs(self, app_uuid: str) -> List[Dict[str, Any]]:
        data = self._request("GET", f"/api/v1/applications/{app_uuid}/envs")
        if isinstance(data, list):
            return data
        if isinstance(data, dict):
            for key in ("data", "envs", "items"):
                maybe = data.get(key)
                if isinstance(maybe, list):
                    return maybe
        raise RuntimeError("Unexpected response shape for /envs")

    def create_env(
        self,
        app_uuid: str,
        key: str,
        value: str,
        is_preview: bool,
        is_build_time: bool,
        is_literal: bool,
    ) -> Any:
        payload = {
            "key": key,
            "value": value,
            "is_preview": is_preview,
            "is_build_time": is_build_time,
            "is_literal": is_literal,
        }
        return self._request("POST", f"/api/v1/applications/{app_uuid}/envs", payload=payload)

    def update_env(
        self,
        app_uuid: str,
        env_uuid: str,
        key: str,
        value: str,
        is_preview: bool,
        is_build_time: bool,
        is_literal: bool,
    ) -> Any:
        payload = {
            "key": key,
            "value": value,
            "is_preview": is_preview,
            "is_build_time": is_build_time,
            "is_literal": is_literal,
        }
        for method in ("PATCH", "PUT"):
            try:
                return self._request(
                    method,
                    f"/api/v1/applications/{app_uuid}/envs/{env_uuid}",
                    payload=payload,
                )
            except RuntimeError as e:
                last_error = e
        raise RuntimeError(str(last_error))

    def delete_env(self, app_uuid: str, env_uuid: str) -> Any:
        return self._request("DELETE", f"/api/v1/applications/{app_uuid}/envs/{env_uuid}")

    def deploy(self, app_uuid: str) -> Any:
        # Coolify deploy endpoint behavior can vary by version; try POST then GET.
        try:
            return self._request("POST", f"/api/v1/applications/{app_uuid}/deploy")
        except RuntimeError:
            return self._request("GET", f"/api/v1/applications/{app_uuid}/deploy")

    def logs(self, app_uuid: str, lines: Optional[int]) -> Any:
        query = {"lines": lines} if lines is not None else None
        return self._request("GET", f"/api/v1/applications/{app_uuid}/logs", query=query)


def parse_bool(value: str) -> bool:
    truthy = {"1", "true", "yes", "y", "on"}
    falsy = {"0", "false", "no", "n", "off"}
    normalized = value.strip().lower()
    if normalized in truthy:
        return True
    if normalized in falsy:
        return False
    raise argparse.ArgumentTypeError(f"Invalid boolean value: {value}")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Manage Coolify applications via API")
    parser.add_argument(
        "--base-url",
        default=os.getenv("COOLIFY_BASE_URL", ""),
        help="Coolify base URL (or set COOLIFY_BASE_URL)",
    )
    parser.add_argument(
        "--token",
        default=os.getenv("COOLIFY_TOKEN", ""),
        help="Coolify API token (or set COOLIFY_TOKEN)",
    )
    parser.add_argument("--timeout", type=int, default=30, help="HTTP timeout in seconds")

    subparsers = parser.add_subparsers(dest="command", required=True)

    subparsers.add_parser("list-apps", help="List applications")

    list_env = subparsers.add_parser("list-env", help="List env vars for an app")
    list_env.add_argument("--app", required=True, help="Application UUID or exact name")

    set_env = subparsers.add_parser("set-env", help="Create or update an env var")
    set_env.add_argument("--app", required=True, help="Application UUID or exact name")
    set_env.add_argument("--key", required=True, help="Environment variable key")
    set_env.add_argument("--value", required=True, help="Environment variable value")
    set_env.add_argument(
        "--is-preview",
        default="false",
        type=parse_bool,
        help="Mark as preview variable (true/false)",
    )
    set_env.add_argument(
        "--is-build-time",
        default="false",
        type=parse_bool,
        help="Mark as build-time variable (true/false)",
    )
    set_env.add_argument(
        "--is-literal",
        default="true",
        type=parse_bool,
        help="Treat as literal value (true/false)",
    )

    del_env = subparsers.add_parser("delete-env", help="Delete an env var by key")
    del_env.add_argument("--app", required=True, help="Application UUID or exact name")
    del_env.add_argument("--key", required=True, help="Environment variable key")

    deploy = subparsers.add_parser("deploy", help="Trigger application redeploy")
    deploy.add_argument("--app", required=True, help="Application UUID or exact name")

    logs = subparsers.add_parser("logs", help="Read application deploy logs")
    logs.add_argument("--app", required=True, help="Application UUID or exact name")
    logs.add_argument("--lines", type=int, default=None, help="Number of log lines")

    return parser


def pick_env_by_key(envs: List[Dict[str, Any]], key: str) -> Optional[Dict[str, Any]]:
    key_lower = key.lower()
    for env in envs:
        if str(env.get("key", "")).lower() == key_lower:
            return env
    return None


def ensure_client(args: argparse.Namespace) -> CoolifyClient:
    if not args.base_url:
        raise RuntimeError("Missing --base-url (or COOLIFY_BASE_URL)")
    if not args.token:
        raise RuntimeError("Missing --token (or COOLIFY_TOKEN)")
    return CoolifyClient(args.base_url, args.token, timeout=args.timeout)


def print_json(data: Any) -> None:
    print(json.dumps(data, indent=2, sort_keys=True))


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()

    try:
        client = ensure_client(args)

        if args.command == "list-apps":
            apps = client.applications()
            rows = []
            for app in apps:
                rows.append(
                    {
                        "uuid": app.get("uuid"),
                        "name": app.get("name"),
                        "status": app.get("status"),
                        "fqdn": app.get("fqdn") or app.get("domains"),
                    }
                )
            print_json(rows)
            return 0

        if args.command == "list-env":
            app = client.resolve_app(args.app)
            envs = client.app_envs(str(app["uuid"]))
            print_json(envs)
            return 0

        if args.command == "set-env":
            app = client.resolve_app(args.app)
            app_uuid = str(app["uuid"])
            envs = client.app_envs(app_uuid)
            existing = pick_env_by_key(envs, args.key)
            if existing and existing.get("uuid"):
                result = client.update_env(
                    app_uuid,
                    str(existing["uuid"]),
                    args.key,
                    args.value,
                    args.is_preview,
                    args.is_build_time,
                    args.is_literal,
                )
                print_json({"action": "updated", "result": result})
            else:
                result = client.create_env(
                    app_uuid,
                    args.key,
                    args.value,
                    args.is_preview,
                    args.is_build_time,
                    args.is_literal,
                )
                print_json({"action": "created", "result": result})
            return 0

        if args.command == "delete-env":
            app = client.resolve_app(args.app)
            app_uuid = str(app["uuid"])
            envs = client.app_envs(app_uuid)
            existing = pick_env_by_key(envs, args.key)
            if not existing or not existing.get("uuid"):
                raise RuntimeError(f"Env key not found: {args.key}")
            result = client.delete_env(app_uuid, str(existing["uuid"]))
            print_json({"action": "deleted", "result": result})
            return 0

        if args.command == "deploy":
            app = client.resolve_app(args.app)
            result = client.deploy(str(app["uuid"]))
            print_json(result)
            return 0

        if args.command == "logs":
            app = client.resolve_app(args.app)
            result = client.logs(str(app["uuid"]), args.lines)
            if isinstance(result, str):
                print(result)
            else:
                print_json(result)
            return 0

        parser.error(f"Unknown command: {args.command}")
        return 2
    except RuntimeError as e:
        print(f"error: {e}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
