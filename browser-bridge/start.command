#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js 22+ is required. Install Node, then run this file again."
  exit 1
fi

NODE_MAJOR="$(node -p "process.versions.node.split('.')[0]")"
if [ "$NODE_MAJOR" -lt 22 ]; then
  echo "Node.js 22+ is required. Current: $(node -v)"
  exit 1
fi

if [ ! -d node_modules/playwright ]; then
  echo "Installing Front browser bridge dependencies..."
  npm install --no-audit --no-fund
fi

if [ ! -d "$HOME/Library/Caches/ms-playwright" ]; then
  echo "Installing Chromium for the Front browser bridge..."
  npx playwright install chromium
fi

echo "Starting Front browser bridge on http://127.0.0.1:43981"
echo "Keep this Terminal window open while you want browser intelligence running."
npm start
