#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENV_FILE="$ROOT_DIR/.env.local"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing $ENV_FILE" >&2
  exit 1
fi

read_env_var() {
  local key="$1"
  local raw
  raw="$(awk -F= -v key="$key" '$1==key {print substr($0, index($0, "=") + 1)}' "$ENV_FILE" | tail -n 1)"
  raw="${raw%$'\r'}"

  if [[ "$raw" =~ ^\".*\"$ ]]; then
    raw="${raw:1:${#raw}-2}"
  elif [[ "$raw" =~ ^\'.*\'$ ]]; then
    raw="${raw:1:${#raw}-2}"
  fi

  printf '%s' "$raw"
}

SUPABASE_URL="$(read_env_var SUPABASE_URL)"
SUPABASE_SERVICE_KEY="$(read_env_var SUPABASE_SERVICE_KEY)"
SUPABASE_SERVICE_ROLE_KEY="$(read_env_var SUPABASE_SERVICE_ROLE_KEY)"
SUPABASE_ANON_KEY="$(read_env_var SUPABASE_ANON_KEY)"
MCP_API_KEY="$(read_env_var MCP_API_KEY)"

if [[ -z "${SUPABASE_URL:-}" ]]; then
  echo "SUPABASE_URL is required in .env.local" >&2
  exit 1
fi

if [[ -z "${SUPABASE_SERVICE_KEY:-}" ]]; then
  echo "SUPABASE_SERVICE_KEY is required in .env.local" >&2
  exit 1
fi

# Map project variable names to the MCP server's expected env names.
export SUPABASE_URL
export SUPABASE_SERVICE_KEY
export SUPABASE_SERVICE_ROLE_KEY="${SUPABASE_SERVICE_ROLE_KEY:-$SUPABASE_SERVICE_KEY}"
export SUPABASE_ANON_KEY="${SUPABASE_ANON_KEY:-$SUPABASE_SERVICE_KEY}"
export MCP_API_KEY="${MCP_API_KEY:-local-codex-mcp-key}"

exec npx -y supabase-mcp@latest supabase-mcp-claude "$@"
