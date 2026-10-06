#!/bin/bash
set -euo pipefail

if [ "$(uname -s)" != "Darwin" ]; then
  echo "This helper installs a macOS LaunchAgent and only runs on macOS."
  exit 1
fi

BRIDGE_DIR="$(cd "$(dirname "$0")" && pwd)"
START_COMMAND="$BRIDGE_DIR/start.command"
DATA_DIR="${FRONT_BRIDGE_DATA:-$HOME/.front-browser-bridge}"
LAUNCH_DIR="$HOME/Library/LaunchAgents"
PLIST="$LAUNCH_DIR/com.front.browser-bridge.plist"
LOG_OUT="$DATA_DIR/launchd.stdout.log"
LOG_ERR="$DATA_DIR/launchd.stderr.log"

mkdir -p "$DATA_DIR" "$LAUNCH_DIR"
chmod +x "$START_COMMAND"

xml_escape() {
  printf '%s' "$1" | sed -e 's/&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g'
}

START_XML="$(xml_escape "$START_COMMAND")"
BRIDGE_XML="$(xml_escape "$BRIDGE_DIR")"
OUT_XML="$(xml_escape "$LOG_OUT")"
ERR_XML="$(xml_escape "$LOG_ERR")"

cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.front.browser-bridge</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>$START_XML</string>
  </array>
  <key>WorkingDirectory</key>
  <string>$BRIDGE_XML</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ThrottleInterval</key>
  <integer>10</integer>
  <key>ProcessType</key>
  <string>Background</string>
  <key>StandardOutPath</key>
  <string>$OUT_XML</string>
  <key>StandardErrorPath</key>
  <string>$ERR_XML</string>
</dict>
</plist>
PLIST

plutil -lint "$PLIST" >/dev/null
chmod 600 "$PLIST"

launchctl bootout "gui/$UID" "$PLIST" 2>/dev/null || true
launchctl bootstrap "gui/$UID" "$PLIST"
launchctl enable "gui/$UID/com.front.browser-bridge"
launchctl kickstart -k "gui/$UID/com.front.browser-bridge"

echo "Front browser bridge LaunchAgent installed and started."
echo "It will restart after crashes and start automatically when you sign in to this Mac."
echo "Logs: $LOG_OUT and $LOG_ERR"
if ! grep -Eq '^[[:space:]]*FRONT_BRIDGE_API_KEY=' "$DATA_DIR/cloud.env" 2>/dev/null; then
  echo "WARNING: $DATA_DIR/cloud.env does not appear to contain FRONT_BRIDGE_API_KEY, so Railway polling will remain disabled until that local config is present."
fi
echo "To remove autostart later: bash \"$BRIDGE_DIR/uninstall-autostart.command\""
