#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

cd "$SCRIPT_DIR"

bash "$SCRIPT_DIR/scripts/deploy-server.sh"

echo
echo "Done. Press Enter to close..."
read
