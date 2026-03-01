#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/common.sh"
load_config

# This script now only sets up local nginx for admin static files
# External ingress is handled by Nginx Proxy Manager

if [[ "${INSTALL_NGINX:-true}" != "true" ]]; then
  log "INSTALL_NGINX=false, skipping"
  exit 0
fi

log "Verifying nginx is installed and running"
run_root systemctl enable nginx
run_root systemctl start nginx

log "Nginx setup finished"
