#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENV_FILES=("$ROOT_DIR/.env")

read_env_var() {
  local file="$1"
  local key="$2"
  local raw
  raw="$(awk -F= -v key="$key" '$1==key {print substr($0, index($0, "=") + 1)}' "$file" | tail -n 1)"
  raw="${raw%$'\r'}"

  if [[ "$raw" =~ ^\".*\"$ ]]; then
    raw="${raw:1:${#raw}-2}"
  elif [[ "$raw" =~ ^\'.*\'$ ]]; then
    raw="${raw:1:${#raw}-2}"
  fi

  printf '%s' "$raw"
}

read_first_non_empty() {
  local key="$1"
  local value=""
  local env_file
  for env_file in "${ENV_FILES[@]}"; do
    [[ -f "$env_file" ]] || continue
    value="$(read_env_var "$env_file" "$key")"
    [[ -n "$value" ]] && break
  done
  printf '%s' "$value"
}

SUPABASE_HOST_URL="$(read_first_non_empty "SUPABASE_HOST_URL")"
SUPABASE_TOKEN="$(read_first_non_empty "SUPABASE_PERSONAL_ACCESS_TOKEN")"

if [[ -z "${SUPABASE_TOKEN:-}" ]]; then
  SUPABASE_TOKEN="$(read_first_non_empty "SUPABASE_ACCESS_TOKEN")"
fi

if [[ -z "${SUPABASE_HOST_URL:-}" ]]; then
  SUPABASE_HOST_URL="$(read_first_non_empty "SUPABASE_URL")"
fi

if [[ -z "${SUPABASE_HOST_URL:-}" ]]; then
  echo "Missing SUPABASE_HOST_URL (or SUPABASE_URL) in .env" >&2
  exit 1
fi

if [[ -z "${SUPABASE_TOKEN:-}" ]]; then
  echo "Missing SUPABASE_PERSONAL_ACCESS_TOKEN (or SUPABASE_ACCESS_TOKEN) in .env" >&2
  exit 1
fi

SUPABASE_HOST_URL="${SUPABASE_HOST_URL%/}"
if [[ "$SUPABASE_HOST_URL" == *"/mcp" ]]; then
  MCP_URL="$SUPABASE_HOST_URL"
else
  MCP_URL="${SUPABASE_HOST_URL}/mcp"
fi

exec npx -y supergateway \
  --streamableHttp "$MCP_URL" \
  --header "authorization:Bearer ${SUPABASE_TOKEN}" \
  "$@"
