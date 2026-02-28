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

run_root() {
  local run_user=""
  if [[ "${1:-}" == "-u" ]]; then
    run_user="${2:-}"
    [[ -n "${run_user}" ]] || fail "run_root: missing username after -u"
    shift 2
  fi
  [[ "${#}" -gt 0 ]] || fail "run_root: missing command"

  if [[ "${EUID}" -eq 0 ]]; then
    if [[ -n "${run_user}" ]]; then
      if command -v runuser >/dev/null 2>&1; then
        runuser -u "${run_user}" -- "$@"
      else
        local cmd
        printf -v cmd '%q ' "$@"
        su -s /bin/bash "${run_user}" -c "${cmd}"
      fi
    else
      "$@"
    fi
  else
    if [[ -n "${run_user}" ]]; then
      sudo -u "${run_user}" "$@"
    else
      sudo "$@"
    fi
  fi
}

load_config() {
  local cfg="${INSTALL_CONFIG:-${INSTALL_DIR}/config.env}"
  [[ -f "${cfg}" ]] || fail "Missing config at ${cfg}. Copy installation/config.env.example to installation/config.env first."

  # Parse KEY=VALUE pairs without requiring strict shell syntax.
  # This keeps command-style values (for example: node dist/src/server.js) usable.
  local line key value
  while IFS= read -r line || [[ -n "${line}" ]]; do
    line="${line%$'\r'}"
    [[ "${line}" =~ ^[[:space:]]*$ ]] && continue
    [[ "${line}" =~ ^[[:space:]]*# ]] && continue
    [[ "${line}" == *"="* ]] || fail "Invalid config line in ${cfg}: ${line}"

    key="${line%%=*}"
    value="${line#*=}"

    key="$(printf '%s' "${key}" | sed -E 's/^[[:space:]]+//; s/[[:space:]]+$//')"
    value="$(printf '%s' "${value}" | sed -E 's/^[[:space:]]+//; s/[[:space:]]+$//')"
    [[ "${key}" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || fail "Invalid config key '${key}' in ${cfg}"

    # Support optional surrounding quotes for compatibility with shell-style .env.
    if [[ "${value}" == \"*\" && "${value}" == *\" && "${#value}" -ge 2 ]]; then
      value="${value:1:${#value}-2}"
    elif [[ "${value}" == \'*\' && "${value}" == *\' && "${#value}" -ge 2 ]]; then
      value="${value:1:${#value}-2}"
    fi

    printf -v "${key}" "%s" "${value}"
    export "${key}"
  done < "${cfg}"

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
  AGENT_RUN_USER="${AGENT_RUN_USER:-root}"
  AGENT_RUN_GROUP="${AGENT_RUN_GROUP:-root}"

  export SOURCE_REPO_ROOT REPO_ROOT API_RUN_USER API_RUN_GROUP AGENT_RUN_USER AGENT_RUN_GROUP
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
  log "Updating repo at ${repo} on branch ${branch}"

  local probe_err=""
  if ! probe_err="$(git -C "${repo}" rev-parse --is-inside-work-tree 2>&1)"; then
    if printf '%s' "${probe_err}" | grep -qi "dubious ownership"; then
      log "Git safe.directory issue detected for ${repo}; adding it to global safe directories"
      git config --global --add safe.directory "${repo}"
    else
      fail "Git repository check failed in ${repo}: ${probe_err}"
    fi
  fi

  (
    cd "${repo}"
    git fetch origin
    git checkout "${branch}"
    git pull --ff-only origin "${branch}"
  )
}

sync_repo_to_root() {
  local source="${SOURCE_REPO_ROOT:-$(cd "${INSTALL_DIR}/.." && pwd)}"
  local target="${REPO_ROOT}"

  [[ -d "${source}" ]] || fail "Source repo directory not found: ${source}"
  if [[ "${source}" == "${target}" ]]; then
    return
  fi

  require_cmd rsync
  run_root mkdir -p "${target}"
  log "Syncing repository from ${source} to ${target}"
  run_root rsync -a --delete \
    --exclude '.deploy-lock' \
    --exclude 'node_modules' \
    --exclude 'agent-python/.venv' \
    "${source}/" "${target}/"
}

install_python_project() {
  local app_dir="$1"
  local venv_dir="${app_dir}/.venv"

  require_cmd python3
  log "Installing Python dependencies in ${app_dir}"
  python3 -m venv "${venv_dir}"

  # shellcheck disable=SC1091
  source "${venv_dir}/bin/activate"
  python -m pip install --upgrade pip

  if [[ -f "${app_dir}/requirements.txt" ]]; then
    pip install -r "${app_dir}/requirements.txt"
  elif [[ -f "${app_dir}/pyproject.toml" ]]; then
    pip install "${app_dir}"
  else
    fail "No requirements.txt or pyproject.toml found in ${app_dir}"
  fi
}

service_action() {
  local action="$1"
  local service="$2"
  local os
  os="$(os_type)"

  if [[ "${os}" == "linux" ]]; then
    run_root systemctl "${action}" "${service}"
  else
    local plist="${HOME}/Library/LaunchAgents/${service}.plist"
    case "${action}" in
      start)
        launchctl load "${plist}" >/dev/null 2>&1 || true
        ;;
      stop)
        launchctl unload "${plist}" >/dev/null 2>&1 || true
        ;;
      restart)
        launchctl unload "${plist}" >/dev/null 2>&1 || true
        launchctl load "${plist}"
        ;;
      status)
        launchctl list | grep -F "${service}" || true
        ;;
      *)
        fail "Unsupported service action: ${action}"
        ;;
    esac
  fi
}

acquire_update_lock() {
  local lock_dir="${REPO_ROOT}/.deploy-lock"
  if mkdir "${lock_dir}" 2>/dev/null; then
    trap 'rm -rf "${lock_dir}"' EXIT
  else
    fail "Another deployment appears to be running (lock: ${lock_dir})"
  fi
}
