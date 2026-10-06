#!/bin/bash
set -euo pipefail
if [ "$(uname -s)" != "Darwin" ]; then echo "macOS only."; exit 1; fi
PLIST="$HOME/Library/LaunchAgents/com.front.browser-bridge.plist"
launchctl bootout "gui/$UID" "$PLIST" 2>/dev/null || true
rm -f "$PLIST"
echo "Front browser bridge autostart removed. Local profile, logins, and ~/.front-browser-bridge data were left untouched."
