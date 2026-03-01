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

log "Installing prerequisites for Linux"

apt_install_with_repair() {
  if run_root apt-get -y -qq install "$@"; then
    return 0
  fi

  log "apt install failed, attempting repair (fix-broken + configure -a) and retry"
  run_root dpkg --configure -a || true
  run_root apt-get -y -qq --fix-broken install || true
  run_root apt-get -qq update || true

  if run_root apt-get -y -qq install "$@"; then
    return 0
  fi

  log "apt install still failing. Held packages:"
  run_root apt-mark showhold || true
  return 1
}

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
  run_root apt-get -qq update
  apt_install_with_repair ca-certificates gnupg
  run_root mkdir -p /etc/apt/keyrings
  run_root bash -lc "curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor > /etc/apt/keyrings/nodesource.gpg"
  run_root tee /etc/apt/sources.list.d/nodesource.list >/dev/null <<EOF
deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_20.x nodistro main
EOF
  run_root apt-get -qq update
  if ! apt_install_with_repair nodejs; then
    log "Unable to install Node.js 20 automatically due to apt issues; continuing with current Node.js $(node -v 2>/dev/null || echo 'missing')"
    return
  fi
  log "Installed Node.js $(node -v), npm $(npm -v)"
}

REQUIRED_CMDS=(git curl rsync nginx psql python3 npm)
MISSING_CMDS=()
for cmd in "${REQUIRED_CMDS[@]}"; do
  if ! command -v "${cmd}" >/dev/null 2>&1; then
    MISSING_CMDS+=("${cmd}")
  fi
done

if [[ "${#MISSING_CMDS[@]}" -gt 0 ]]; then
  run_root apt-get -qq update
  if ! apt_install_with_repair \
    git \
    curl \
    rsync \
    nginx \
    postgresql \
    postgresql-contrib \
    python3 \
    python3-venv \
    python3-pip \
    npm; then
    STILL_MISSING=()
    for cmd in "${REQUIRED_CMDS[@]}"; do
      if ! command -v "${cmd}" >/dev/null 2>&1; then
        STILL_MISSING+=("${cmd}")
      fi
    done
    if [[ "${#STILL_MISSING[@]}" -gt 0 ]]; then
      fail "Unable to install required packages due to apt issues. Missing commands: ${STILL_MISSING[*]}"
    fi
    log "apt reported issues but required commands are present; continuing"
  fi
else
  log "Required system packages already present; skipping apt package installation"
fi

ensure_node20_linux

# Enable nginx for local static file serving (admin panel)
run_root systemctl enable nginx
run_root systemctl start nginx

log "Prerequisites installed"
