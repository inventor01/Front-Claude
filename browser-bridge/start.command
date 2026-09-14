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

EXPLICIT_PROVIDER="${FRONT_CONTENT_PROVIDER-}"
EXPLICIT_MODEL="${FRONT_OLLAMA_MODEL-}"
EXPLICIT_ENDPOINT="${FRONT_OLLAMA_ENDPOINT-}"
EXPLICIT_OLLAMA_KEEP_ALIVE="${FRONT_OLLAMA_KEEP_ALIVE-}"
EXPLICIT_OLLAMA_PREWARM="${FRONT_OLLAMA_PREWARM-}"
EXPLICIT_OLLAMA_WARM_TIMEOUT="${FRONT_OLLAMA_WARM_TIMEOUT_MS-}"
EXPLICIT_MODEL_FRAMES="${FRONT_CONTENT_MODEL_FRAMES-}"
EXPLICIT_CONTENT_TIMEOUT="${FRONT_CONTENT_TIMEOUT_MS-}"
EXPLICIT_SCOUT_TIMEOUT="${FRONT_CONTENT_SCOUT_TIMEOUT_MS-}"
EXPLICIT_CONTENT_NUM_PREDICT="${FRONT_CONTENT_NUM_PREDICT-}"
EXPLICIT_DEEP="${FRONT_CONTENT_DEEP_VIDEOS-}"
EXPLICIT_SCOUT="${FRONT_CONTENT_SCOUT_VIDEOS-}"
EXPLICIT_BACKGROUND="${FRONT_CONTENT_BACKGROUND_VIDEOS-}"
EXPLICIT_CONTEXT_PROVIDER="${FRONT_CONTEXT_PROVIDER-}"
EXPLICIT_CONTEXT_MODEL="${FRONT_CONTEXT_OLLAMA_MODEL-}"
EXPLICIT_CONTEXT_ENDPOINT="${FRONT_CONTEXT_OLLAMA_ENDPOINT-}"
EXPLICIT_CONTEXT_MAX="${FRONT_CONTEXT_MAX_POSTS-}"
EXPLICIT_CONTEXT_BATCH="${FRONT_CONTEXT_BATCH_SIZE-}"
EXPLICIT_CONTEXT_TIMEOUT="${FRONT_CONTEXT_TIMEOUT_MS-}"
EXPLICIT_CONTEXT_NUM_PREDICT="${FRONT_CONTEXT_NUM_PREDICT-}"
EXPLICIT_TIKTOK_OBSERVER="${FRONT_TIKTOK_OBSERVER_MS-}"

DEFAULT_CONTENT_ENV="$(pwd)/content.env"
CONTENT_ENV="$FRONT_DATA_DIR/content.env"
for env_file in "$DEFAULT_CONTENT_ENV" "$CONTENT_ENV"; do
  if [ -f "$env_file" ]; then
    set -a
    source "$env_file"
    set +a
  fi
done

[ -n "$EXPLICIT_PROVIDER" ] && export FRONT_CONTENT_PROVIDER="$EXPLICIT_PROVIDER"
[ -n "$EXPLICIT_MODEL" ] && export FRONT_OLLAMA_MODEL="$EXPLICIT_MODEL"
[ -n "$EXPLICIT_ENDPOINT" ] && export FRONT_OLLAMA_ENDPOINT="$EXPLICIT_ENDPOINT"
[ -n "$EXPLICIT_OLLAMA_KEEP_ALIVE" ] && export FRONT_OLLAMA_KEEP_ALIVE="$EXPLICIT_OLLAMA_KEEP_ALIVE"
[ -n "$EXPLICIT_OLLAMA_PREWARM" ] && export FRONT_OLLAMA_PREWARM="$EXPLICIT_OLLAMA_PREWARM"
[ -n "$EXPLICIT_OLLAMA_WARM_TIMEOUT" ] && export FRONT_OLLAMA_WARM_TIMEOUT_MS="$EXPLICIT_OLLAMA_WARM_TIMEOUT"
[ -n "$EXPLICIT_MODEL_FRAMES" ] && export FRONT_CONTENT_MODEL_FRAMES="$EXPLICIT_MODEL_FRAMES"
[ -n "$EXPLICIT_CONTENT_TIMEOUT" ] && export FRONT_CONTENT_TIMEOUT_MS="$EXPLICIT_CONTENT_TIMEOUT"
[ -n "$EXPLICIT_SCOUT_TIMEOUT" ] && export FRONT_CONTENT_SCOUT_TIMEOUT_MS="$EXPLICIT_SCOUT_TIMEOUT"
[ -n "$EXPLICIT_CONTENT_NUM_PREDICT" ] && export FRONT_CONTENT_NUM_PREDICT="$EXPLICIT_CONTENT_NUM_PREDICT"
[ -n "$EXPLICIT_DEEP" ] && export FRONT_CONTENT_DEEP_VIDEOS="$EXPLICIT_DEEP"
[ -n "$EXPLICIT_SCOUT" ] && export FRONT_CONTENT_SCOUT_VIDEOS="$EXPLICIT_SCOUT"
[ -n "$EXPLICIT_BACKGROUND" ] && export FRONT_CONTENT_BACKGROUND_VIDEOS="$EXPLICIT_BACKGROUND"
[ -n "$EXPLICIT_CONTEXT_PROVIDER" ] && export FRONT_CONTEXT_PROVIDER="$EXPLICIT_CONTEXT_PROVIDER"
[ -n "$EXPLICIT_CONTEXT_MODEL" ] && export FRONT_CONTEXT_OLLAMA_MODEL="$EXPLICIT_CONTEXT_MODEL"
[ -n "$EXPLICIT_CONTEXT_ENDPOINT" ] && export FRONT_CONTEXT_OLLAMA_ENDPOINT="$EXPLICIT_CONTEXT_ENDPOINT"
[ -n "$EXPLICIT_CONTEXT_MAX" ] && export FRONT_CONTEXT_MAX_POSTS="$EXPLICIT_CONTEXT_MAX"
[ -n "$EXPLICIT_CONTEXT_BATCH" ] && export FRONT_CONTEXT_BATCH_SIZE="$EXPLICIT_CONTEXT_BATCH"
[ -n "$EXPLICIT_CONTEXT_TIMEOUT" ] && export FRONT_CONTEXT_TIMEOUT_MS="$EXPLICIT_CONTEXT_TIMEOUT"
[ -n "$EXPLICIT_CONTEXT_NUM_PREDICT" ] && export FRONT_CONTEXT_NUM_PREDICT="$EXPLICIT_CONTEXT_NUM_PREDICT"
[ -n "$EXPLICIT_TIKTOK_OBSERVER" ] && export FRONT_TIKTOK_OBSERVER_MS="$EXPLICIT_TIKTOK_OBSERVER"

export FRONT_CONTENT_PROVIDER="${FRONT_CONTENT_PROVIDER:-ollama}"
export FRONT_OLLAMA_MODEL="${FRONT_OLLAMA_MODEL:-qwen3-vl:4b-instruct}"
export FRONT_OLLAMA_ENDPOINT="${FRONT_OLLAMA_ENDPOINT:-http://127.0.0.1:11434/api/chat}"
export FRONT_OLLAMA_KEEP_ALIVE="${FRONT_OLLAMA_KEEP_ALIVE:-30m}"
export FRONT_OLLAMA_PREWARM="${FRONT_OLLAMA_PREWARM:-1}"
export FRONT_OLLAMA_WARM_TIMEOUT_MS="${FRONT_OLLAMA_WARM_TIMEOUT_MS:-75000}"
export FRONT_CONTENT_MODEL_FRAMES="${FRONT_CONTENT_MODEL_FRAMES:-8}"
export FRONT_CONTENT_TIMEOUT_MS="${FRONT_CONTENT_TIMEOUT_MS:-60000}"
export FRONT_CONTENT_SCOUT_TIMEOUT_MS="${FRONT_CONTENT_SCOUT_TIMEOUT_MS:-45000}"
export FRONT_CONTENT_NUM_PREDICT="${FRONT_CONTENT_NUM_PREDICT:-420}"
export FRONT_CONTENT_DEEP_VIDEOS="${FRONT_CONTENT_DEEP_VIDEOS:-4}"
export FRONT_CONTENT_SCOUT_VIDEOS="${FRONT_CONTENT_SCOUT_VIDEOS:-2}"
export FRONT_CONTENT_BACKGROUND_VIDEOS="${FRONT_CONTENT_BACKGROUND_VIDEOS:-1}"
export FRONT_CONTEXT_MAX_POSTS="${FRONT_CONTEXT_MAX_POSTS:-12}"
export FRONT_CONTEXT_BATCH_SIZE="${FRONT_CONTEXT_BATCH_SIZE:-4}"
export FRONT_CONTEXT_TIMEOUT_MS="${FRONT_CONTEXT_TIMEOUT_MS:-60000}"
export FRONT_CONTEXT_NUM_PREDICT="${FRONT_CONTEXT_NUM_PREDICT:-900}"
export FRONT_TIKTOK_OBSERVER_MS="${FRONT_TIKTOK_OBSERVER_MS:-850}"
export FRONT_BRIDGE_HEADLESS="${FRONT_BRIDGE_HEADLESS:-1}"

if [ -z "$EXPLICIT_MODEL" ] && [ "$FRONT_OLLAMA_MODEL" = "qwen3-vl:8b" ]; then
  echo "Front v26: replacing stale qwen3-vl:8b local default with verified qwen3-vl:4b-instruct."
  export FRONT_OLLAMA_MODEL="qwen3-vl:4b-instruct"
fi
if [ -z "$EXPLICIT_DEEP" ] && [ "$FRONT_CONTENT_DEEP_VIDEOS" = "8" ]; then
  echo "Front v26: replacing stale deep visual budget 8 with balanced budget 4."
  export FRONT_CONTENT_DEEP_VIDEOS="4"
fi
if [ -z "$EXPLICIT_SCOUT" ] && [ "$FRONT_CONTENT_SCOUT_VIDEOS" = "4" ]; then
  echo "Front v26: replacing stale scout visual budget 4 with balanced budget 2."
  export FRONT_CONTENT_SCOUT_VIDEOS="2"
fi
if [ -z "$EXPLICIT_BACKGROUND" ] && [ "$FRONT_CONTENT_BACKGROUND_VIDEOS" = "2" ]; then
  echo "Front v26: replacing stale background visual budget 2 with balanced budget 1."
  export FRONT_CONTENT_BACKGROUND_VIDEOS="1"
fi
if [ -z "$EXPLICIT_CONTEXT_MAX" ] && { [ "$FRONT_CONTEXT_MAX_POSTS" = "90" ] || [ "$FRONT_CONTEXT_MAX_POSTS" = "36" ]; }; then
  echo "Front v26: replacing stale contextual post budget $FRONT_CONTEXT_MAX_POSTS with balanced budget 12."
  export FRONT_CONTEXT_MAX_POSTS="12"
fi
if [ -z "$EXPLICIT_CONTEXT_BATCH" ] && [ "$FRONT_CONTEXT_BATCH_SIZE" = "8" ]; then
  echo "Front v26: replacing stale context batch size 8 with balanced batch size 4."
  export FRONT_CONTEXT_BATCH_SIZE="4"
fi
if [ -z "$EXPLICIT_CONTEXT_TIMEOUT" ] && [ "$FRONT_CONTEXT_TIMEOUT_MS" = "45000" ]; then
  echo "Front v26: replacing stale context timeout 45000ms with validated 60000ms."
  export FRONT_CONTEXT_TIMEOUT_MS="60000"
fi

export FRONT_CONTEXT_PROVIDER="${FRONT_CONTEXT_PROVIDER:-$FRONT_CONTENT_PROVIDER}"
export FRONT_CONTEXT_OLLAMA_MODEL="${FRONT_CONTEXT_OLLAMA_MODEL:-$FRONT_OLLAMA_MODEL}"
export FRONT_CONTEXT_OLLAMA_ENDPOINT="${FRONT_CONTEXT_OLLAMA_ENDPOINT:-$FRONT_OLLAMA_ENDPOINT}"
if [ -z "$EXPLICIT_CONTEXT_MODEL" ] && [ "$FRONT_CONTEXT_OLLAMA_MODEL" = "qwen3-vl:8b" ]; then
  echo "Front v26: replacing stale 8B context model with current local model $FRONT_OLLAMA_MODEL."
  export FRONT_CONTEXT_OLLAMA_MODEL="$FRONT_OLLAMA_MODEL"
fi

echo "Starting Front browser bridge v26 on http://127.0.0.1:43981"
echo "Keep this Terminal window open while you want browser intelligence running."
echo "v26 preserves the v25 single-process collectors and adds contextual post understanding plus semantic narrative clustering."
echo "Chrome CDP stays on http://127.0.0.1:43982 and must remain running."
echo "Balanced profile: vision=${FRONT_OLLAMA_MODEL:-none}, context=${FRONT_CONTEXT_OLLAMA_MODEL:-none}, deep=$FRONT_CONTENT_DEEP_VIDEOS, scout=$FRONT_CONTENT_SCOUT_VIDEOS, background=$FRONT_CONTENT_BACKGROUND_VIDEOS, model-frames=$FRONT_CONTENT_MODEL_FRAMES, vision-timeout=${FRONT_CONTENT_TIMEOUT_MS}ms, contextual=$FRONT_CONTEXT_MAX_POSTS, context-batch=$FRONT_CONTEXT_BATCH_SIZE, context-timeout=${FRONT_CONTEXT_TIMEOUT_MS}ms, keep-alive=${FRONT_OLLAMA_KEEP_ALIVE}, TikTok poll=${FRONT_TIKTOK_OBSERVER_MS}ms."
if [ -n "${FRONT_CONTENT_API_KEY:-${OPENAI_API_KEY:-}}" ]; then
  echo "Content/context understanding: OpenAI provider configured."
elif [ -n "${FRONT_OLLAMA_MODEL:-}" ]; then
  echo "Content/context understanding: local Ollama provider configured."
  if [ "$FRONT_OLLAMA_PREWARM" != "0" ]; then
    echo "Prewarming local Ollama model before the first scan..."
    if ! node ./scripts/warm-ollama.mjs; then
      echo "Warning: Ollama prewarm failed. Front will still start, but local model stages may time out until Ollama is ready."
    fi
  fi
else
  echo "Content/context understanding: deterministic fallback active; semantic model inactive until content.env is configured."
fi
npm start