#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"

FRONT_DATA_DIR="${FRONT_BRIDGE_DATA:-$HOME/.front-browser-bridge}"
CLOUD_URL="${FRONT_CLOUD_URL:-https://believable-inspiration-production-a68b.up.railway.app}"
mkdir -p "$FRONT_DATA_DIR"

printf "Front bridge pairing code: "
read -r PAIRING_CODE
PAIRING_CODE="$(printf '%s' "$PAIRING_CODE" | tr -d '[:space:]' | tr '[:lower:]' '[:upper:]')"
if [ -z "$PAIRING_CODE" ]; then
  echo "Pairing code is required."
  exit 1
fi

RESPONSE="$(curl -fsS --max-time 20 -X POST "$CLOUD_URL/api/agent/bridge/pair"   -H 'content-type: application/json'   --data-binary "$(node -e 'process.stdout.write(JSON.stringify({pairingCode:process.argv[1]}))' "$PAIRING_CODE")")"

BRIDGE_KEY="$(printf '%s' "$RESPONSE" | node -e '
let text="";process.stdin.on("data",c=>text+=c);process.stdin.on("end",()=>{
  try{const body=JSON.parse(text);if(!body.bridgeKey)process.exit(2);process.stdout.write(String(body.bridgeKey));}
  catch{process.exit(2);}
});')"
PAIRED_CLOUD="$(printf '%s' "$RESPONSE" | node -e '
let text="";process.stdin.on("data",c=>text+=c);process.stdin.on("end",()=>{
  try{const body=JSON.parse(text);process.stdout.write(String(body.cloudUrl||""));}
  catch{}
});')"

umask 077
cat > "$FRONT_DATA_DIR/cloud.env" <<EOF
FRONT_CLOUD_URL="${PAIRED_CLOUD:-$CLOUD_URL}"
FRONT_BRIDGE_API_KEY="$BRIDGE_KEY"
EOF
chmod 600 "$FRONT_DATA_DIR/cloud.env"
unset BRIDGE_KEY
echo "Front remote scrolling bridge paired successfully."
echo "Credential stored locally at $FRONT_DATA_DIR/cloud.env"
echo "Restart start.command to enable cloud-controlled X/TikTok/Instagram scrolling."
