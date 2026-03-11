# n8n API Usage (Project Notes)

This repo talks to the n8n instance using credentials stored in `.env`.
Always consult this document before making API calls to the instance.

## Instance

| Key | Value |
|-----|-------|
| URL | `https://coziyoo.drascom.uk` |
| API key | stored in `.env.local` as `N8N_API_KEY` |

### Live Workflow IDs (coziyoo.drascom.uk)

| Workflow | n8n ID | Webhook path |
|----------|--------|--------------|
| Brain | `6bJGOBvPm9eyvooK` | `/webhook/6KFFgjd26nF0kNCA` |
| MCP Gateway | `FEJrgQ4V7DOcT9kF` | `/webhook/XYiIkxpa4PlnddQt` |

> **Note:** Webhook URLs are configured in the **admin voice agent settings page** per-device — not in `.env`.
> The n8n workflow IDs above are only needed when running `sync_n8n_workflows.py --apply` to push changes.

## Environment

Load credentials from `.env.local`:

```sh
set -a; source .env.local; set +a
```

Required vars:
- `N8N_HOST` — `https://coziyoo.drascom.uk`
- `N8N_API_KEY` — JWT token in `.env.local`

## Workflow Templates + Sync Script

Workflow templates are stored in:
- `workflows/brain_6KFFgjd26nF0kNCA.json`
- `workflows/mcp_XYiIkxpa4PlnddQt.json`

Sync command (dry-run by default):

```sh
python scripts/sync_n8n_workflows.py
```

Apply to remote n8n:

```sh
python scripts/sync_n8n_workflows.py --apply
```

## General Rules

- Use the `X-N8N-API-KEY` header.
- Prefer `curl` for quick reads; use `python3` for safe JSON edits.
- When **updating workflows**, the API is strict about request shape. Only send the minimal fields required:
  - `name`
  - `nodes`
  - `connections`
  - `settings` (only the allowed keys for that workflow; see below)
- Do **not** send read-only fields (`id`, `createdAt`, `updatedAt`, `versionId`, `active`, `tags`, etc.).

## Read Workflow

```sh
curl -sS "$N8N_HOST/api/v1/workflows/<WORKFLOW_ID>" \
  -H "X-N8N-API-KEY: $N8N_API_KEY"
```

## Update Workflow (Safe Pattern)

The server rejects extra properties. Use this pattern:

```python
import json, os
import urllib.request

host = os.environ["N8N_HOST"]
key = os.environ["N8N_API_KEY"]


def request(method, path, data=None):
    url = f"{host}{path}"
    headers = {"X-N8N-API-KEY": key}
    if data is not None:
        headers["Content-Type"] = "application/json"
        data = json.dumps(data).encode()
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read().decode())

wf_id = "<WORKFLOW_ID>"
wf = request("GET", f"/api/v1/workflows/{wf_id}")

# Modify wf['nodes'] and wf['connections'] as needed

settings = wf.get("settings", {})
# Only include allowed keys for this workflow.
allowed_settings = {k: settings[k] for k in ("executionOrder", "callerPolicy") if k in settings}

payload = {
    "name": wf.get("name"),
    "nodes": wf.get("nodes"),
    "connections": wf.get("connections"),
    "settings": allowed_settings,
}

request("PUT", f"/api/v1/workflows/{wf_id}", data=payload)
```

### Settings Notes

Some workflows accept only a subset of `settings`. If the API returns:
- `request/body/settings must NOT have additional properties`
  - Reduce settings to only `executionOrder` and `callerPolicy`.
- `request/body must have required property 'settings'`
  - Include `settings` with the allowed keys.

## Executions (Read)

```sh
# List recent executions
curl -sS "$N8N_HOST/api/v1/executions?workflowId=<WORKFLOW_ID>&limit=50" \
  -H "X-N8N-API-KEY: $N8N_API_KEY"

# Fetch one execution with run data
curl -sS "$N8N_HOST/api/v1/executions/<EXEC_ID>?includeData=true" \
  -H "X-N8N-API-KEY: $N8N_API_KEY"
```

## Safety

- Do not print `.env` contents into logs.
- Avoid writing credentials into docs or scripts.
