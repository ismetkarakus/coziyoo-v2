#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENV_FILES=("$ROOT_DIR/.env" "$ROOT_DIR/.env.local")

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

SUPABASE_TOKEN=""
for env_file in "${ENV_FILES[@]}"; do
  [[ -f "$env_file" ]] || continue
  SUPABASE_TOKEN="$(read_env_var "$env_file" "SUPABASE_PERSONAL_ACCESS_TOKEN")"
  [[ -n "$SUPABASE_TOKEN" ]] || SUPABASE_TOKEN="$(read_env_var "$env_file" "SUPABASE_ACCESS_TOKEN")"
  [[ -n "$SUPABASE_TOKEN" ]] && break
done

if [[ -z "${SUPABASE_TOKEN:-}" ]]; then
  echo "Missing SUPABASE_PERSONAL_ACCESS_TOKEN (or SUPABASE_ACCESS_TOKEN) in .env/.env.local" >&2
  exit 1
fi

exec npx -y supergateway \
  --streamableHttp "https://mcp.supabase.com/mcp" \
  --header "authorization:Bearer ${SUPABASE_TOKEN}" \
  "$@"
