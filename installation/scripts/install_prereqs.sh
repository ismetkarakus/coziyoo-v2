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
