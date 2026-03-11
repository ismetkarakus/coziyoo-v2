#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
WORKFLOWS_DIR = ROOT / "workflows"

WORKFLOW_FILES = {
    "6bJGOBvPm9eyvooK": WORKFLOWS_DIR / "brain_6KFFgjd26nF0kNCA.json",
    "FEJrgQ4V7DOcT9kF": WORKFLOWS_DIR / "mcp_XYiIkxpa4PlnddQt.json",
}


def read_env_file(path: Path) -> dict[str, str]:
    out: dict[str, str] = {}
    if not path.exists():
        return out
    for line in path.read_text(encoding="utf-8").splitlines():
        s = line.strip()
        if not s or s.startswith("#") or "=" not in s:
            continue
        k, v = s.split("=", 1)
        out[k.strip()] = v.strip().strip('"').strip("'")
    return out


def resolve_config() -> tuple[str, str]:
    merged: dict[str, str] = {}
    merged.update(read_env_file(ROOT.parent.parent / ".env"))
    merged.update(read_env_file(ROOT.parent.parent / ".env.local"))
    merged.update(os.environ)
    base = (merged.get("N8N_HOST") or "").strip().rstrip("/")
    key = (merged.get("N8N_API_KEY") or "").strip()
    return base, key


def request_json(method: str, url: str, api_key: str, payload: dict | None = None) -> dict:
    data = None
    headers = {
        "Accept": "application/json",
        "X-N8N-API-KEY": api_key,
        "Authorization": f"Bearer {api_key}",
    }
    if payload is not None:
        data = json.dumps(payload).encode("utf-8")
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    with urllib.request.urlopen(req, timeout=25) as resp:
        body = resp.read().decode("utf-8")
        return json.loads(body) if body else {}


def load_template(workflow_id: str) -> dict:
    path = WORKFLOW_FILES[workflow_id]
    return json.loads(path.read_text(encoding="utf-8"))


def build_update_payload(existing: dict, template: dict) -> dict:
    settings = existing.get("settings", {})
    allowed_settings = {
        k: settings[k] for k in ("executionOrder", "callerPolicy") if k in settings
    }
    if "settings" in template and isinstance(template["settings"], dict):
        allowed_settings.update(
            {k: v for k, v in template["settings"].items() if k in ("executionOrder", "callerPolicy")}
        )
    return {
        "name": template.get("name") or existing.get("name"),
        "nodes": template.get("nodes", []),
        "connections": template.get("connections", {}),
        "settings": allowed_settings,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Sync n8n workflow templates to remote n8n.")
    parser.add_argument("--apply", action="store_true", help="Apply updates (default is dry-run)")
    args = parser.parse_args()

    base, key = resolve_config()
    if not base:
        print("N8N host missing (N8N_HOST).", file=sys.stderr)
        return 2
    if not key:
        print("N8N API key missing (N8N_API_KEY).", file=sys.stderr)
        return 2

    print(f"n8n base: {base}")
    for workflow_id in WORKFLOW_FILES:
        url = f"{base}/api/v1/workflows/{workflow_id}"
        print(f"\n== {workflow_id} ==")
        try:
            current = request_json("GET", url, key)
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="replace")
            print(f"GET failed: HTTP {exc.code} {detail[:300]}", file=sys.stderr)
            return 1
        except Exception as exc:
            print(f"GET failed: {exc}", file=sys.stderr)
            return 1

        template = load_template(workflow_id)
        update_payload = build_update_payload(current, template)
        print(f"name: {current.get('name')} -> {update_payload.get('name')}")
        print(f"nodes: {len(current.get('nodes') or [])} -> {len(update_payload.get('nodes') or [])}")

        if not args.apply:
            print("dry-run: skipped PUT")
            continue

        try:
            request_json("PUT", url, key, payload=update_payload)
            print("updated")
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="replace")
            print(f"PUT failed: HTTP {exc.code} {detail[:300]}", file=sys.stderr)
            return 1
        except Exception as exc:
            print(f"PUT failed: {exc}", file=sys.stderr)
            return 1

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
