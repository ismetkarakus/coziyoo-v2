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
    --force) FORCE="true"; shift ;;
    --output) OUTPUT_PATH="$2"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "ERROR: Unknown argument: $1" >&2; usage; exit 1 ;;
  esac
done

[[ -f "${TEMPLATE_PATH}" ]] || { echo "ERROR: Missing template: ${TEMPLATE_PATH}" >&2; exit 1; }
[[ -f "${INSTALL_CFG_PATH}" ]] || { echo "ERROR: Missing install config: ${INSTALL_CFG_PATH}" >&2; exit 1; }
command -v openssl >/dev/null 2>&1 || { echo "ERROR: openssl is required" >&2; exit 1; }

if [[ -f "${OUTPUT_PATH}" && "${FORCE}" != "true" ]]; then
  echo "ERROR: ${OUTPUT_PATH} already exists. Use --force to overwrite." >&2
  exit 1
fi

# Load installation config safely
test -r "${INSTALL_CFG_PATH}" && set -a && source "${INSTALL_CFG_PATH}" && set +a

# Validate required configuration
required_install_keys=(API_DOMAIN ADMIN_DOMAIN API_PORT API_START_CMD DEPLOY_BRANCH REPO_ROOT PG_DB PG_USER PG_PASSWORD SEED_ADMIN_EMAIL SEED_ADMIN_PASSWORD)
for key in "${required_install_keys[@]}"; do
  if [[ -z "${!key:-}" ]]; then
    echo "ERROR: Required key '${key}' is missing in ${INSTALL_CFG_PATH}" >&2
    exit 1
  fi
done

# Prepare default variables
PGHOST="${PGHOST:-127.0.0.1}"
PGPORT="${PGPORT:-5432}"
DATABASE_URL="postgresql://${PG_USER}:${PG_PASSWORD}@${PGHOST}:${PGPORT}/${PG_DB}"
CORS_VALUE="https://${ADMIN_DOMAIN},https://coziyoo.com,http://${ADMIN_DOMAIN},http://localhost:8081,http://localhost:5173,http://localhost:19006"

# Create associative array for generated secrets
declare -A secrets
for sk in APP_JWT_SECRET ADMIN_JWT_SECRET PAYMENT_WEBHOOK_SECRET AI_SERVER_SHARED_SECRET; do
  if [[ "${sk}" == "PAYMENT_WEBHOOK_SECRET" || "${sk}" == "AI_SERVER_SHARED_SECRET" ]]; then
    secrets[$sk]="$(openssl rand -hex 24)"
  else
    secrets[$sk]="$(openssl rand -hex 32)"
  fi
done

# Generate .env file by replacing specific variables during generation
mkdir -p "$(dirname "${OUTPUT_PATH}")"
tmp_file="$(mktemp "${OUTPUT_PATH}.tmp.XXXXXX")"
trap 'rm -f "${tmp_file}"' EXIT

while IFS= read -r line || [[ -n "$line" ]]; do
  if [[ ! "$line" =~ ^[A-Z0-9_]+= ]]; then
    echo "$line" >> "$tmp_file"
    continue
  fi

  key="${line%%=*}"
  val="${line#*=}"
  
  # Replace with generated secrets if placeholder
  if [[ -n "${secrets[$key]:-}" ]] && [[ -z "$val" || "$val" =~ change_me|yourdomain|example.com ]]; then
    echo "${key}=${secrets[$key]}" >> "$tmp_file"
    continue
  fi

  # Replace other mapped values
  case "$key" in
    ADMIN_DOMAIN) echo "ADMIN_DOMAIN=${ADMIN_DOMAIN}" >> "$tmp_file" ;;
    ADMIN_PORT) echo "ADMIN_PORT=${ADMIN_PORT}" >> "$tmp_file" ;;
    API_DOMAIN) echo "API_DOMAIN=${API_DOMAIN}" >> "$tmp_file" ;;
    API_PORT|PORT) echo "${key}=${API_PORT}" >> "$tmp_file" ;;
    API_START_CMD) echo "API_START_CMD=${API_START_CMD}" >> "$tmp_file" ;;
    DEPLOY_BRANCH) echo "DEPLOY_BRANCH=${DEPLOY_BRANCH}" >> "$tmp_file" ;;
    REPO_ROOT) echo "REPO_ROOT=${REPO_ROOT}" >> "$tmp_file" ;;
    SEED_ADMIN_EMAIL) echo "SEED_ADMIN_EMAIL=${SEED_ADMIN_EMAIL}" >> "$tmp_file" ;;
    SEED_ADMIN_PASSWORD) echo "SEED_ADMIN_PASSWORD=${SEED_ADMIN_PASSWORD}" >> "$tmp_file" ;;
    PGHOST) echo "PGHOST=${PGHOST}" >> "$tmp_file" ;;
    PGPORT) echo "PGPORT=${PGPORT}" >> "$tmp_file" ;;
    PGUSER) echo "PGUSER=${PG_USER}" >> "$tmp_file" ;;
    PGPASSWORD) echo "PGPASSWORD=${PG_PASSWORD}" >> "$tmp_file" ;;
    PGDATABASE) echo "PGDATABASE=${PG_DB}" >> "$tmp_file" ;;
    DATABASE_URL) echo "DATABASE_URL=${DATABASE_URL}" >> "$tmp_file" ;;
    HOST) echo "HOST=0.0.0.0" >> "$tmp_file" ;;
    VITE_API_BASE_URL) echo "VITE_API_BASE_URL=https://${API_DOMAIN}" >> "$tmp_file" ;;
    CORS_ALLOWED_ORIGINS|API_CORS_ALLOWED_ORIGINS) echo "${key}=${CORS_VALUE}" >> "$tmp_file" ;;
    NODE_ENV) 
      if [[ -z "$val" || "$val" =~ change_me|yourdomain|example.com ]]; then
        echo "NODE_ENV=production" >> "$tmp_file"
      else
        echo "$line" >> "$tmp_file"
      fi
      ;;
    *) echo "$line" >> "$tmp_file" ;;
  esac
done < "${TEMPLATE_PATH}"

# Ensure mandatory variables that might not be in template are added
append_if_missing() {
  local k="$1"
  local v="$2"
  if ! grep -q "^${k}=" "$tmp_file"; then
    echo "${k}=${v}" >> "$tmp_file"
  fi
}

append_if_missing "HOST" "0.0.0.0"
append_if_missing "PORT" "${API_PORT}"
append_if_missing "CORS_ALLOWED_ORIGINS" "${CORS_VALUE}"
append_if_missing "API_CORS_ALLOWED_ORIGINS" "${CORS_VALUE}"
append_if_missing "PGHOST" "${PGHOST}"
append_if_missing "PGPORT" "${PGPORT}"
append_if_missing "PGUSER" "${PG_USER}"
append_if_missing "PGPASSWORD" "${PG_PASSWORD}"
append_if_missing "PGDATABASE" "${PG_DB}"
append_if_missing "DATABASE_URL" "${DATABASE_URL}"
append_if_missing "VITE_API_BASE_URL" "https://${API_DOMAIN}"

# Final cross-check
for check_key in NODE_ENV HOST PORT DATABASE_URL APP_JWT_SECRET ADMIN_JWT_SECRET PAYMENT_WEBHOOK_SECRET CORS_ALLOWED_ORIGINS; do
  if ! grep -q "^${check_key}=" "$tmp_file"; then
    echo "ERROR: generated env is missing mandatory key ${check_key}" >&2
    exit 1
  fi
done

mv "$tmp_file" "${OUTPUT_PATH}"
trap - EXIT

echo "Generated env file: ${OUTPUT_PATH}"
echo "Mirrored source: ${INSTALL_CFG_PATH}"
echo "Generated secrets successfully."
