---
name: coolify-app-ops
description: Manage Coolify application instances through API operations. Use when Codex needs to list apps, read/update/delete application environment variables, redeploy an app, or inspect deployment logs for troubleshooting on a Coolify server.
---

# Coolify App Ops

Use this skill to perform reliable Coolify application operations with a script-first workflow.

## Quick Start

1. Set credentials:
   - `export COOLIFY_BASE_URL='https://coolify.example.com'`
   - `export COOLIFY_TOKEN='your_api_token'`
2. Use the script:
   - `skills/coolify-app-ops/scripts/coolify_app_ops.py list-apps`

## Commands

- List apps:
  - `skills/coolify-app-ops/scripts/coolify_app_ops.py list-apps`
- List env vars:
  - `skills/coolify-app-ops/scripts/coolify_app_ops.py list-env --app <uuid-or-name>`
- Set env var (create or update by key):
  - `skills/coolify-app-ops/scripts/coolify_app_ops.py set-env --app <uuid-or-name> --key KEY --value VALUE`
- Delete env var:
  - `skills/coolify-app-ops/scripts/coolify_app_ops.py delete-env --app <uuid-or-name> --key KEY`
- Trigger redeploy:
  - `skills/coolify-app-ops/scripts/coolify_app_ops.py deploy --app <uuid-or-name>`
- Read logs:
  - `skills/coolify-app-ops/scripts/coolify_app_ops.py logs --app <uuid-or-name> --lines 200`

## Recommended Workflow

1. Resolve the target app with `list-apps` and copy the UUID.
2. Check current env vars with `list-env`.
3. Apply env changes with `set-env` or `delete-env`.
4. Trigger `deploy`.
5. Verify rollout with `logs`.

## Notes

- Prefer UUID selectors to avoid ambiguous name matches.
- Treat env values as sensitive; do not echo secrets in summaries unless requested.
- If API behavior differs by Coolify version, read [references/coolify-api-notes.md](references/coolify-api-notes.md).
