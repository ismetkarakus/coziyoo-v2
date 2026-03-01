#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INSTALL_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

log() {
  printf "[%s] %s\n" "$(date +"%Y-%m-%d %H:%M:%S")" "$*"
}

fail() {
  printf "ERROR: %s\n" "$*" >&2
  exit 1
}

os_type() {
  case "$(uname -s)" in
    Linux) echo "linux" ;;
    Darwin) echo "macos" ;;
    *) fail "Unsupported OS: $(uname -s)" ;;
  esac
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || fail "Missing required command: $1"
}

# Simple sudo wrapper for root deployment
run_root() {
  local as_user=""
  if [[ "${1:-}" == "-u" ]]; then
    as_user="${2:-}"
    shift 2
  fi

  if [[ -n "${as_user}" ]]; then
    if [[ "${EUID}" -eq 0 ]]; then
      if command -v runuser >/dev/null 2>&1; then
        runuser -u "${as_user}" -- "$@"
      else
        su -s /bin/bash -c "$(printf '%q ' "$@")" "${as_user}"
      fi
    else
      sudo -u "${as_user}" "$@"
    fi
  else
    if [[ "${EUID}" -eq 0 ]]; then
      "$@"
    else
      sudo "$@"
    fi
  fi
}

load_config() {
  local cfg="${INSTALL_CONFIG:-${INSTALL_DIR}/config.env}"
  [[ -f "${cfg}" ]] || fail "Missing config at ${cfg}. Copy installation/config.env.example to installation/config.env first."

  # Use native bash source for .env files
  set -a
  # shellcheck disable=SC1090
  source "${cfg}"
  set +a

  local detected_repo_root
  detected_repo_root="$(cd "${INSTALL_DIR}/.." && pwd)"
  SOURCE_REPO_ROOT="${detected_repo_root}"
  REPO_ROOT="${REPO_ROOT:-/opt/coziyoo}"
  if [[ "${REPO_ROOT}" != /* ]]; then
    REPO_ROOT="$(cd "${INSTALL_DIR}/${REPO_ROOT}" 2>/dev/null && pwd)" || fail "Invalid REPO_ROOT path '${REPO_ROOT}' in ${cfg}"
  fi
  if [[ ! -d "${REPO_ROOT}" ]]; then
    run_root mkdir -p "${REPO_ROOT}"
  fi

  API_RUN_USER="${API_RUN_USER:-root}"
  API_RUN_GROUP="${API_RUN_GROUP:-root}"
  export SOURCE_REPO_ROOT REPO_ROOT API_RUN_USER API_RUN_GROUP
}

export_env_file_kv() {
  local env_file="$1"
  [[ -f "${env_file}" ]] || fail "Env file not found: ${env_file}"

  set -a
  # shellcheck disable=SC1090
  source "${env_file}"
  set +a
}

resolve_path() {
  local p="$1"
  if [[ "${p}" = /* ]]; then
    echo "${p}"
  else
    echo "${REPO_ROOT}/${p}"
  fi
}

maybe_git_update() {
  local repo="$1"
  if [[ "${GIT_UPDATE:-false}" != "true" ]]; then
    return
  fi
  if [[ ! -d "${repo}/.git" ]]; then
    log "Skipping git update in ${repo} (no .git directory)"
    return
  fi

  local branch="${DEPLOY_BRANCH:-main}"
  local preserve_paths_csv="${DEPLOY_GIT_PRESERVE_PATHS:-installation/config.env,.env}"
  local -a preserve_paths=()
  local -a dirty_preserve_paths=()
  local stashed="false"
  local stash_name=""
  local p=""

  IFS=',' read -r -a preserve_paths <<< "${preserve_paths_csv}"
  for p in "${preserve_paths[@]}"; do
    p="$(printf "%s" "${p}" | xargs)"
    [[ -z "${p}" ]] && continue
    if git -C "${repo}" ls-files --error-unmatch "${p}" >/dev/null 2>&1; then
      if ! git -C "${repo}" diff --quiet -- "${p}"; then
        dirty_preserve_paths+=("${p}")
      fi
    fi
  done

  if [[ "${#dirty_preserve_paths[@]}" -gt 0 ]]; then
    stash_name="deploy-preserve-$(date +%s)"
    log "Stashing local changes before git update: ${dirty_preserve_paths[*]}"
    (
      cd "${repo}"
      git stash push --quiet --message "${stash_name}" -- "${dirty_preserve_paths[@]}" || true
    )
    stashed="true"
  fi

  log "Updating repo at ${repo} on branch ${branch}"

  # Add safe directory unconditionally
  git config --global --add safe.directory "${repo}" 2>/dev/null || true

  (
    cd "${repo}"
    git fetch --quiet origin
    git checkout -q "${branch}"
    git pull --quiet --ff-only origin "${branch}"
  )

  if [[ "${stashed}" == "true" ]]; then
    log "Restoring stashed local config changes"
    (
      cd "${repo}"
      if ! git stash pop --quiet; then
        fail "Failed to restore stashed local changes after pull. Resolve conflicts in ${repo} and retry."
      fi
    )
  fi
}

sync_repo_to_root() {
  local source="${SOURCE_REPO_ROOT:-$(cd "${INSTALL_DIR}/.." && pwd)}"
  local target="${REPO_ROOT}"

  [[ -d "${source}" ]] || fail "Source repo directory not found: ${source}"
  if [[ "${source}" == "${target}" ]]; then
    return
  fi

  run_root mkdir -p "${target}"
  log "Syncing repository from ${source} to ${target}"
  if command -v rsync >/dev/null 2>&1; then
    run_root rsync -a --delete \
      --exclude '.deploy-lock' \
      --exclude 'node_modules' \
      "${source}/" "${target}/"
  else
    log "rsync not found, using fallback copy mode"
    run_root find "${target}" -mindepth 1 -maxdepth 1 ! -name '.git' -exec rm -rf {} +
    run_root bash -lc "shopt -s dotglob; cp -a \"${source}\"/* \"${target}\"/"
    run_root rm -rf "${target}/node_modules" "${target}/.deploy-lock"
  fi
}

install_python_project() {
  local app_dir="$1"
  local venv_dir="${app_dir}/.venv"

  require_cmd python3
  log "Installing Python dependencies in ${app_dir}"
  python3 -m venv "${venv_dir}"

  # shellcheck disable=SC1091
  source "${venv_dir}/bin/activate"
  python -m pip install --quiet --upgrade pip

  if [[ -f "${app_dir}/requirements.txt" ]]; then
    pip install --quiet -r "${app_dir}/requirements.txt"
  elif [[ -f "${app_dir}/pyproject.toml" ]]; then
    pip install --quiet "${app_dir}"
  else
    fail "No requirements.txt or pyproject.toml found in ${app_dir}"
  fi
}

service_action() {
  local action="$1"
  local service="$2"
  run_root systemctl "${action}" "${service}"
}

acquire_update_lock() {
  local lock_dir="${REPO_ROOT}/.deploy-lock"
  if mkdir "${lock_dir}" 2>/dev/null; then
    trap "rm -rf '${lock_dir}'" EXIT
  else
    fail "Another deployment appears to be running (lock: ${lock_dir})"
  fi
}

# Shared function for ensuring API env defaults
ensure_api_env_defaults() {
  local env_file="$1"
  local pg_db_default="${PG_DB:-coziyoo}"
  local pg_user_default="${PG_USER:-coziyoo}"
  local pg_password_default="${PG_PASSWORD:-coziyoo}"
  local admin_domain="${ADMIN_DOMAIN:-admin.YOURDOMAIN.com}"
  local cors_default="${API_CORS_ALLOWED_ORIGINS:-https://${admin_domain},http://${admin_domain},http://localhost:8081,http://localhost:5173,http://localhost:19006}"
  local defaults=(
    "APP_JWT_SECRET=coziyoo_app_jwt_secret_change_me_1234567890"
    "ADMIN_JWT_SECRET=coziyoo_admin_jwt_secret_change_me_1234567890"
    "PAYMENT_WEBHOOK_SECRET=coziyoo_webhook_secret_1234"
    "AI_SERVER_SHARED_SECRET=coziyoo_ai_shared_secret_dummy_123456"
    "SPEECH_TO_TEXT_API_KEY=coziyoo_stt_api_key_dummy"
    "TTS_API_KEY=coziyoo_tts_api_key_dummy"
    "N8N_API_KEY=coziyoo_n8n_api_key_dummy"
    "PGHOST=127.0.0.1"
    "PGPORT=5432"
    "PGUSER=${pg_user_default}"
    "PGPASSWORD=${pg_password_default}"
    "PGDATABASE=${pg_db_default}"
    "CORS_ALLOWED_ORIGINS=${cors_default}"
  )

  if [[ ! -f "${env_file}" ]]; then
    log "Creating API env file at ${env_file}"
    mkdir -p "$(dirname "${env_file}")"
    printf "%s\n" "${defaults[@]}" > "${env_file}"
    return
  fi

  local entry key
  for entry in "${defaults[@]}"; do
    key="${entry%%=*}"
    if ! grep -q "^${key}=" "${env_file}"; then
      echo "${entry}" >> "${env_file}"
    fi
  done
}
