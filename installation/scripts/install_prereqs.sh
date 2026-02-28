#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/common.sh"
load_config

if [[ "${INSTALL_PREREQS:-true}" != "true" ]]; then
  log "INSTALL_PREREQS=false, skipping"
  exit 0
fi

OS="$(os_type)"
log "Installing prerequisites for ${OS}"

if [[ "${OS}" == "linux" ]]; then
  log "Ensuring application user/group exist: ${APP_USER}:${APP_GROUP}"
  if ! getent group "${APP_GROUP}" >/dev/null 2>&1; then
    run_root groupadd "${APP_GROUP}"
  fi
  if ! id -u "${APP_USER}" >/dev/null 2>&1; then
    run_root useradd -m -s /bin/bash -g "${APP_GROUP}" "${APP_USER}"
  else
    run_root usermod -g "${APP_GROUP}" "${APP_USER}"
  fi
  run_root bash -lc "echo '${APP_USER}:${APP_PASSWORD}' | chpasswd"

  NGINX_PACKAGES=()
  if [[ "${INGRESS_MODE:-nginx}" != "npm" ]]; then
    NGINX_PACKAGES=(nginx)
  fi

  run_root apt-get update
  run_root apt-get install -y \
    git \
    curl \
    rsync \
    postgresql \
    postgresql-contrib \
    python3 \
    python3-venv \
    python3-pip \
    nodejs \
    npm \
    "${NGINX_PACKAGES[@]}"

  if [[ "${INGRESS_MODE:-nginx}" != "npm" ]]; then
    run_root systemctl enable nginx
    run_root systemctl start nginx
  else
    log "INGRESS_MODE=npm, skipping local nginx service install/start"
  fi

  if [[ -d "${REPO_ROOT}" ]]; then
    log "Setting ownership for repo path ${REPO_ROOT} to ${APP_USER}:${APP_GROUP}"
    run_root chown -R "${APP_USER}:${APP_GROUP}" "${REPO_ROOT}"
  fi
else
  require_cmd brew
  brew update
  if [[ "${INGRESS_MODE:-nginx}" != "npm" ]]; then
    brew install git curl rsync nginx postgresql@16 python@3.11 node
    brew services start nginx
  else
    brew install git curl rsync postgresql@16 python@3.11 node
    log "INGRESS_MODE=npm, skipping local nginx service install/start"
  fi
  brew services start postgresql@16
fi

log "Prerequisites installed"
