#!/usr/bin/env bash
set -euo pipefail

# Customize these variables for your VPS layout.
REPO_DIR="/opt/coziyoo"
ADMIN_DIR="$REPO_DIR/admin-panel"
PUBLISH_DIR="/var/www/coziyoo-admin"

cd "$REPO_DIR"
git fetch origin
git checkout main
git pull --ff-only origin main

cd "$ADMIN_DIR"
if [[ -f package-lock.json ]]; then
  npm ci
else
  npm install
fi
npm run build

mkdir -p "$PUBLISH_DIR"
rsync -av --delete dist/ "$PUBLISH_DIR"/

nginx -t
systemctl reload nginx

echo "Admin deployed to $PUBLISH_DIR"
