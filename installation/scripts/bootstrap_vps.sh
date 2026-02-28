#!/usr/bin/env bash
set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run as root: sudo bash $0"
  exit 1
fi

apt update
apt install -y \
  git \
  nginx \
  python3 \
  python3-venv \
  python3-pip \
  curl \
  rsync \
  ufw

ufw allow OpenSSH || true
ufw allow 'Nginx Full' || true
ufw --force enable || true

systemctl enable nginx
systemctl start nginx

echo "Bootstrap complete. Next: configure PostgreSQL, systemd services, and Nginx site config."
