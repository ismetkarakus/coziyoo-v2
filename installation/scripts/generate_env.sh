#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INSTALL_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
REPO_ROOT="$(cd "${INSTALL_DIR}/.." && pwd)"
TEMPLATE_PATH="${REPO_ROOT}/.env.example"
INSTALL_CFG_PATH="${INSTALL_DIR}/config.env"
OUTPUT_PATH="${REPO_ROOT}/.env"
FORCE="false"

usage() {
  cat <<'EOF'
Usage:
  bash installation/scripts/generate_env.sh [--force] [--output /path/to/.env]

Options:
  --force            Overwrite output file if it already exists.
  --output PATH      Output env file path. Default: <repo>/.env
  -h, --help         Show this help.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --force)
      FORCE="true"
      shift
      ;;
    --output)
      [[ $# -ge 2 ]] || { echo "ERROR: --output requires a path" >&2; exit 1; }
      OUTPUT_PATH="$2"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "ERROR: Unknown argument: $1" >&2
      usage
      exit 1
      ;;
  esac
done

[[ -f "${TEMPLATE_PATH}" ]] || { echo "ERROR: Missing template: ${TEMPLATE_PATH}" >&2; exit 1; }
[[ -f "${INSTALL_CFG_PATH}" ]] || { echo "ERROR: Missing install config: ${INSTALL_CFG_PATH}" >&2; exit 1; }
command -v openssl >/dev/null 2>&1 || { echo "ERROR: openssl is required" >&2; exit 1; }

if [[ -f "${OUTPUT_PATH}" && "${FORCE}" != "true" ]]; then
  echo "ERROR: ${OUTPUT_PATH} already exists. Use --force to overwrite." >&2
  exit 1
fi

# shellcheck disable=SC1090
set -a
source "${INSTALL_CFG_PATH}"
set +a

required_install_keys=(API_DOMAIN ADMIN_DOMAIN API_PORT ADMIN_PORT API_START_CMD DEPLOY_BRANCH REPO_ROOT PG_DB PG_USER PG_PASSWORD SEED_ADMIN_EMAIL SEED_ADMIN_PASSWORD)
for key in "${required_install_keys[@]}"; do
  if [[ -z "${!key:-}" ]]; then
    echo "ERROR: Required key '${key}' is missing in ${INSTALL_CFG_PATH}" >&2
    exit 1
  fi
done

PGHOST="${PGHOST:-127.0.0.1}"
PGPORT="${PGPORT:-5432}"
PGUSER="${PG_USER}"
PGPASSWORD="${PG_PASSWORD}"
PGDATABASE="${PG_DB}"
DATABASE_URL="postgresql://${PGUSER}:${PGPASSWORD}@${PGHOST}:${PGPORT}/${PGDATABASE}"

cfg_raw() {
  local key="$1"
  awk -F= -v k="${key}" '$1 == k { sub($1 "=", ""); print; exit }' "${INSTALL_CFG_PATH}"
}

generate_hex() {
  local bytes="$1"
  openssl rand -hex "${bytes}"
}

is_placeholder_like() {
  local value="${1:-}"
  local lowered
  lowered="$(printf '%s' "${value}" | tr '[:upper:]' '[:lower:]')"
  [[ -z "${value}" || "${lowered}" == *"change_me"* || "${lowered}" == *"yourdomain"* || "${lowered}" == *"example.com"* ]]
}

MAP_FILE="$(mktemp "${OUTPUT_PATH}.map.XXXXXX")"
cleanup_map() { rm -f "${MAP_FILE}"; }
trap cleanup_map EXIT

awk -F= '/^[A-Z0-9_]+=/ {print $1"="$2}' "${TEMPLATE_PATH}" > "${MAP_FILE}"

set_k() {
  local key="$1"
  local value="$2"
  local tmp
  tmp="$(mktemp "${MAP_FILE}.tmp.XXXXXX")"
  awk -F= -v k="${key}" -v v="${value}" '
    BEGIN { found = 0 }
    $1 == k { print k "=" v; found = 1; next }
    { print }
    END { if (!found) print k "=" v }
  ' "${MAP_FILE}" > "${tmp}"
  mv "${tmp}" "${MAP_FILE}"
}

get_k() {
  local key="$1"
  awk -F= -v k="${key}" '$1 == k { sub($1 "=", ""); print; exit }' "${MAP_FILE}"
}

has_k() {
  local key="$1"
  grep -q "^${key}=" "${MAP_FILE}"
}

# Mirror overlap keys from installation/config.env
set_k "ADMIN_DOMAIN" "$(cfg_raw ADMIN_DOMAIN)"
set_k "ADMIN_PORT" "$(cfg_raw ADMIN_PORT)"
set_k "API_DOMAIN" "$(cfg_raw API_DOMAIN)"
set_k "API_PORT" "$(cfg_raw API_PORT)"
set_k "API_START_CMD" "$(cfg_raw API_START_CMD)"
set_k "DEPLOY_BRANCH" "$(cfg_raw DEPLOY_BRANCH)"
set_k "REPO_ROOT" "$(cfg_raw REPO_ROOT)"
set_k "SEED_ADMIN_EMAIL" "$(cfg_raw SEED_ADMIN_EMAIL)"
set_k "SEED_ADMIN_PASSWORD" "$(cfg_raw SEED_ADMIN_PASSWORD)"

# DB consistency from installation/config.env
set_k "PGHOST" "${PGHOST}"
set_k "PGPORT" "${PGPORT}"
set_k "PGUSER" "${PGUSER}"
set_k "PGPASSWORD" "${PGPASSWORD}"
set_k "PGDATABASE" "${PGDATABASE}"
set_k "DATABASE_URL" "${DATABASE_URL}"

# Runtime network keys
set_k "HOST" "0.0.0.0"
set_k "PORT" "${API_PORT}"
set_k "VITE_API_BASE_URL" "https://${API_DOMAIN}"
CORS_VALUE="https://${ADMIN_DOMAIN},https://coziyoo.com,http://${ADMIN_DOMAIN},http://localhost:8081,http://localhost:5173,http://localhost:19006"
set_k "CORS_ALLOWED_ORIGINS" "${CORS_VALUE}"
if has_k "API_CORS_ALLOWED_ORIGINS"; then
  set_k "API_CORS_ALLOWED_ORIGINS" "${CORS_VALUE}"
fi

# Ensure production default unless explicitly non-placeholder
if is_placeholder_like "$(get_k NODE_ENV)"; then
  set_k "NODE_ENV" "production"
fi

generated_secrets=()
for sk in APP_JWT_SECRET ADMIN_JWT_SECRET PAYMENT_WEBHOOK_SECRET AI_SERVER_SHARED_SECRET; do
  current="$(get_k "${sk}")"
  if is_placeholder_like "${current}"; then
    if [[ "${sk}" == "PAYMENT_WEBHOOK_SECRET" || "${sk}" == "AI_SERVER_SHARED_SECRET" ]]; then
      set_k "${sk}" "$(generate_hex 24)"
    else
      set_k "${sk}" "$(generate_hex 32)"
    fi
    generated_secrets+=("${sk}")
  fi
done

tmp_file="$(mktemp "${OUTPUT_PATH}.tmp.XXXXXX")"
cleanup_output() { rm -f "${tmp_file}"; }
trap 'cleanup_output; cleanup_map' EXIT

# Preserve comments/order by rewriting key lines from template.
while IFS= read -r line; do
  if [[ "${line}" =~ ^([A-Z0-9_]+)=(.*)$ ]]; then
    key="${BASH_REMATCH[1]}"
    if has_k "${key}"; then
      printf '%s=%s\n' "${key}" "$(get_k "${key}")" >> "${tmp_file}"
    else
      printf '%s\n' "${line}" >> "${tmp_file}"
    fi
  else
    printf '%s\n' "${line}" >> "${tmp_file}"
  fi
done < "${TEMPLATE_PATH}"

# Append any mandatory keys missing from template
append_if_missing() {
  local key="$1"
  local val="$2"
  if ! grep -q "^${key}=" "${tmp_file}"; then
    printf '%s=%s\n' "${key}" "${val}" >> "${tmp_file}"
  fi
}

append_if_missing "HOST" "0.0.0.0"
append_if_missing "PORT" "${API_PORT}"
append_if_missing "CORS_ALLOWED_ORIGINS" "${CORS_VALUE}"
append_if_missing "API_CORS_ALLOWED_ORIGINS" "${CORS_VALUE}"
append_if_missing "PGHOST" "${PGHOST}"
append_if_missing "PGPORT" "${PGPORT}"
append_if_missing "PGUSER" "${PGUSER}"
append_if_missing "PGPASSWORD" "${PGPASSWORD}"
append_if_missing "PGDATABASE" "${PGDATABASE}"
append_if_missing "DATABASE_URL" "${DATABASE_URL}"
append_if_missing "VITE_API_BASE_URL" "https://${API_DOMAIN}"

mandatory=(NODE_ENV HOST PORT DATABASE_URL APP_JWT_SECRET ADMIN_JWT_SECRET PAYMENT_WEBHOOK_SECRET CORS_ALLOWED_ORIGINS)
for key in "${mandatory[@]}"; do
  if ! grep -q "^${key}=" "${tmp_file}"; then
    echo "ERROR: generated env is missing mandatory key ${key}" >&2
    exit 1
  fi
done

# Cross-file consistency checks
generated_api_port="$(grep -E '^API_PORT=' "${tmp_file}" | head -n1 | cut -d= -f2-)"
[[ "${generated_api_port}" == "${API_PORT}" ]] || { echo "ERROR: API_PORT mismatch after generation" >&2; exit 1; }
grep -q "^DATABASE_URL=${DATABASE_URL}$" "${tmp_file}" || { echo "ERROR: DATABASE_URL mismatch after generation" >&2; exit 1; }

mkdir -p "$(dirname "${OUTPUT_PATH}")"
mv "${tmp_file}" "${OUTPUT_PATH}"
rm -f "${MAP_FILE}"
trap - EXIT

echo "Generated env file: ${OUTPUT_PATH}"
echo "Mirrored source: ${INSTALL_CFG_PATH}"
if [[ ${#generated_secrets[@]} -gt 0 ]]; then
  echo "Generated secrets: ${generated_secrets[*]}"
else
  echo "Generated secrets: none (existing non-placeholder values preserved)"
fi
