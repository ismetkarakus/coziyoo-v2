#!/usr/bin/env bash
set -euo pipefail

# Customize these variables.
REPO_DIR="/opt/coziyoo"
AGENT_DIR="$REPO_DIR/agent-python"
VENV_DIR="$AGENT_DIR/.venv"
SERVICE_NAME="coziyoo-agent"

cd "$REPO_DIR"
git fetch origin
git checkout main
git pull --ff-only origin main

cd "$AGENT_DIR"
python3 -m venv "$VENV_DIR"
source "$VENV_DIR/bin/activate"
pip install --upgrade pip

if [[ -f requirements.txt ]]; then
  pip install -r requirements.txt
elif [[ -f pyproject.toml ]]; then
  pip install .
else
  echo "No requirements.txt or pyproject.toml found in $AGENT_DIR"
  exit 1
fi

systemctl restart "$SERVICE_NAME"
systemctl status "$SERVICE_NAME" --no-pager -l
