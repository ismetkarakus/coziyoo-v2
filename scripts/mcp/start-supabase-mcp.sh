#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Canonical Supabase MCP launcher: reads SUPABASE_HOST_URL + PAT from .env/.env.local.
exec "$SCRIPT_DIR/start-supabase-remote-mcp.sh" "$@"
