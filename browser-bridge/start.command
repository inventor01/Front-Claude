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

PLAYWRIGHT_EXECUTABLE="$(node --input-type=module -e "import { chromium } from 'playwright'; process.stdout.write(chromium.executablePath())")"
if [ ! -x "$PLAYWRIGHT_EXECUTABLE" ]; then
  echo "Installing the Chromium revision required by Front..."
  npx playwright install chromium
  PLAYWRIGHT_EXECUTABLE="$(node --input-type=module -e "import { chromium } from 'playwright'; process.stdout.write(chromium.executablePath())")"
fi

if [ ! -x "$PLAYWRIGHT_EXECUTABLE" ]; then
  echo "Front could not find a runnable Playwright Chromium executable after installation."
  echo "Expected: $PLAYWRIGHT_EXECUTABLE"
  echo "Run: cd \"$(pwd)\" && npx playwright install chromium"
  exit 1
fi

FRONT_DATA_DIR="${FRONT_BRIDGE_DATA:-$HOME/.front-browser-bridge}"
mkdir -p "$FRONT_DATA_DIR"

QUALITY_MARKER="$FRONT_DATA_DIR/.quality-reset-v13.done"
if [ ! -f "$QUALITY_MARKER" ]; then
  ARCHIVE_DIR="$FRONT_DATA_DIR/archive/v13-quality-reset-$(date +%Y%m%d-%H%M%S)"
  mkdir -p "$ARCHIVE_DIR"
  for file in pending-evidence.json topic-history.json feed-seen-v10.json feed-penetration-v10.json sentinel-rotation-v10.json auto-deep-v11.json; do
    if [ -f "$FRONT_DATA_DIR/$file" ]; then
      mv "$FRONT_DATA_DIR/$file" "$ARCHIVE_DIR/$file"
    fi
  done
  printf 'v13 quality reset completed at %s\narchive=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$ARCHIVE_DIR" > "$QUALITY_MARKER"
  echo "Front v13: archived old active scanner state and started with a clean feed."
fi

CONTENT_ENV="$FRONT_DATA_DIR/content.env"
if [ -f "$CONTENT_ENV" ]; then
  set -a
  # shellcheck disable=SC1090
  source "$CONTENT_ENV"
  set +a
fi

export FRONT_BRIDGE_HEADLESS="${FRONT_BRIDGE_HEADLESS:-1}"

echo "Starting Front browser bridge v25 on http://127.0.0.1:43981"
echo "Keep this Terminal window open while you want browser intelligence running."
echo "v25 uses one scanner process, one scan state, one ledger, one X collector, and one isolated TikTok collector."
echo "Chrome CDP stays on http://127.0.0.1:43982 and must remain running."
echo "Browser scans and video-frame analysis run in the background; login still opens regular Chrome."
if [ -n "${FRONT_CONTENT_API_KEY:-${OPENAI_API_KEY:-}}" ]; then
  echo "Video understanding: OpenAI provider configured."
elif [ -n "${FRONT_OLLAMA_MODEL:-}" ]; then
  echo "Video understanding: local Ollama provider configured."
else
  echo "Video understanding: frame capture ready; semantic model inactive until content.env is configured."
fi
npm start
