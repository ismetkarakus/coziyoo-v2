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
  run_root apt-get update
  run_root apt-get install -y \
    git \
    curl \
    rsync \
    nginx \
    postgresql \
    postgresql-contrib \
    python3 \
    python3-venv \
    python3-pip \
    nodejs \
    npm

  run_root systemctl enable nginx
  run_root systemctl start nginx
else
  require_cmd brew
  brew update
  brew install git curl rsync nginx postgresql@16 python@3.11 node
  brew services start nginx
  brew services start postgresql@16
fi

log "Prerequisites installed"
