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

ensure_node20_linux() {
  local major=""
  if command -v node >/dev/null 2>&1; then
    major="$(node -v | sed -E 's/^v([0-9]+).*/\1/')"
  fi

  if [[ -n "${major}" && "${major}" -ge 20 ]]; then
    log "Node.js version is suitable (v${major})"
    return
  fi

  log "Installing/upgrading Node.js to 20.x"
  run_root apt-get update
  run_root apt-get install -y ca-certificates gnupg
  run_root mkdir -p /etc/apt/keyrings
  run_root bash -lc "curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor > /etc/apt/keyrings/nodesource.gpg"
  run_root tee /etc/apt/sources.list.d/nodesource.list >/dev/null <<EOF
deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_20.x nodistro main
EOF
  run_root apt-get update
  run_root apt-get install -y nodejs
  log "Installed Node.js $(node -v), npm $(npm -v)"
}

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
    npm

  ensure_node20_linux

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
