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

# Playwright's cache directory can exist even when the exact Chromium revision
# required by this Node Playwright package is missing (for example when another
# Python/Node Playwright install created the cache first). Check the executable
# Playwright actually expects instead of checking the cache directory itself.
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

# v13 changes the definition of a promotable narrative. On the first v13 start,
# remove stale v10/v11 active scan state so junk topics cannot be reintroduced
# from the local queue/history after the server has been cleared. Preserve the
# files in a private local archive and leave login/profile, config, source
# reputation, creator stats and visual caches untouched.
FRONT_DATA_DIR="${FRONT_BRIDGE_DATA:-$HOME/.front-browser-bridge}"
QUALITY_MARKER="$FRONT_DATA_DIR/.quality-reset-v13.done"
if [ ! -f "$QUALITY_MARKER" ]; then
  ARCHIVE_DIR="$FRONT_DATA_DIR/archive/v13-quality-reset-$(date +%Y%m%d-%H%M%S)"
  mkdir -p "$ARCHIVE_DIR"
  for file in pending-evidence.json topic-history.json feed-seen-v10.json feed-penetration-v10.json sentinel-rotation-v10.json auto-deep-v11.json; do
    if [ -f "$FRONT_DATA_DIR/$file" ]; then
      mv "$FRONT_DATA_DIR/$file" "$ARCHIVE_DIR/$file"
    fi
  done
  mkdir -p "$FRONT_DATA_DIR"
  printf 'v13 quality reset completed at %s\narchive=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$ARCHIVE_DIR" > "$QUALITY_MARKER"
  echo "Front v13: archived old active scanner state and started with a clean feed."
fi

# Login happens in regular visible Chrome. Collection should be invisible by
# default so clicking Run browser scan does not pop up a disposable blank/search
# window. Set FRONT_BRIDGE_HEADLESS=0 before launching only when debugging.
export FRONT_BRIDGE_HEADLESS="${FRONT_BRIDGE_HEADLESS:-1}"

echo "Starting Front browser bridge on http://127.0.0.1:43981"
echo "Keep this Terminal window open while you want browser intelligence running."
echo "Browser scans run in the background; login still opens regular Chrome."
npm start
