#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"

DATA_DIR="${FRONT_BRIDGE_DATA:-$HOME/.front-browser-bridge}"
MODEL_DIR="$DATA_DIR/models"
MODEL_PATH="$MODEL_DIR/ggml-base.bin"
ENV_FILE="$DATA_DIR/content.env"
MODEL_URL="https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin"
mkdir -p "$MODEL_DIR"

if ! command -v brew >/dev/null 2>&1; then
  echo "Homebrew is required for the one-time local transcription setup."
  echo "Install Homebrew from https://brew.sh, then run this script again."
  exit 1
fi

if ! command -v ffmpeg >/dev/null 2>&1; then
  echo "Installing ffmpeg..."
  brew install ffmpeg
fi

if ! command -v whisper-cli >/dev/null 2>&1; then
  echo "Installing whisper.cpp..."
  if ! brew install whisper.cpp; then
    echo "Primary Homebrew formula failed; trying whisper-cpp compatibility formula..."
    brew install whisper-cpp
  fi
fi

if ! command -v ffmpeg >/dev/null 2>&1 || ! command -v whisper-cli >/dev/null 2>&1; then
  echo "Front could not verify ffmpeg + whisper-cli after installation."
  echo "Fix the Homebrew installation, then run this setup again."
  exit 1
fi

if [ ! -s "$MODEL_PATH" ]; then
  echo "Downloading the multilingual Whisper base model..."
  TMP="$MODEL_PATH.part"
  rm -f "$TMP"
  curl --fail --location --retry 3 --progress-bar "$MODEL_URL" -o "$TMP"
  if [ ! -s "$TMP" ]; then
    echo "Whisper model download failed."
    exit 1
  fi
  mv "$TMP" "$MODEL_PATH"
fi

WHISPER_BIN="$(command -v whisper-cli)"
FFMPEG_BIN="$(command -v ffmpeg)"
TMP_ENV="$ENV_FILE.v27.tmp"
if [ -f "$ENV_FILE" ]; then
  grep -vE '^FRONT_(TRANSCRIPT_|WHISPER_|FFMPEG_|VIDEO_MEANING_)' "$ENV_FILE" > "$TMP_ENV" || true
else
  : > "$TMP_ENV"
fi
cat >> "$TMP_ENV" <<EOF
FRONT_TRANSCRIPT_PROVIDER=whisper
FRONT_WHISPER_BIN=$WHISPER_BIN
FRONT_FFMPEG_BIN=$FFMPEG_BIN
FRONT_WHISPER_MODEL=$MODEL_PATH
FRONT_TRANSCRIPT_CONCURRENCY=2
FRONT_TRANSCRIPT_TIMEOUT_MS=180000
FRONT_VIDEO_MEANING_BATCH_SIZE=4
FRONT_VIDEO_MEANING_TIMEOUT_MS=60000
EOF
mv "$TMP_ENV" "$ENV_FILE"
chmod 600 "$ENV_FILE"

printf '\nFront v27 transcription setup complete.\n'
printf '  whisper-cli: %s\n' "$WHISPER_BIN"
printf '  ffmpeg:      %s\n' "$FFMPEG_BIN"
printf '  model:       %s\n' "$MODEL_PATH"
printf '  settings:    %s\n\n' "$ENV_FILE"
echo "Restart browser-bridge/start.command so the new transcription settings take effect."
