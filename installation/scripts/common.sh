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
  if [[ "${EUID}" -eq 0 ]]; then
    "$@"
  else
    sudo "$@"
  fi
}

load_config() {
  local cfg="${INSTALL_CONFIG:-${INSTALL_DIR}/config.env}"
  [[ -f "${cfg}" ]] || fail "Missing config at ${cfg}. Copy installation/config.env.example to installation/config.env first."

  # shellcheck disable=SC1090
  source "${cfg}"

  REPO_ROOT="${REPO_ROOT:-$(cd "${INSTALL_DIR}/.." && pwd)}"
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
  (
    cd "${repo}"
    git fetch origin
    git checkout "${branch}"
    git pull --ff-only origin "${branch}"
  )
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
