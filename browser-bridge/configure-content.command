#!/bin/bash
set -euo pipefail

FRONT_DATA_DIR="${FRONT_BRIDGE_DATA:-$HOME/.front-browser-bridge}"
ENV_FILE="$FRONT_DATA_DIR/content.env"
mkdir -p "$FRONT_DATA_DIR"

echo "Front v17 video understanding setup"
echo "1) OpenAI multimodal model"
echo "2) Local Ollama vision model"
echo "3) Disable semantic video understanding"
printf "Choose 1, 2, or 3: "
read -r choice

write_common() {
  printf 'FRONT_CONTENT_DEEP_VIDEOS=4\n'
  printf 'FRONT_CONTENT_SCOUT_VIDEOS=2\n'
  printf 'FRONT_CONTENT_BACKGROUND_VIDEOS=2\n'
}

case "$choice" in
  1)
    printf "Paste your OpenAI API key (input hidden): "
    read -rs api_key
    echo
    if [ -z "$api_key" ]; then
      echo "No key entered. Nothing changed."
      exit 1
    fi
    printf "Model [gpt-5.6-luna]: "
    read -r model
    model="${model:-gpt-5.6-luna}"
    {
      printf 'FRONT_CONTENT_PROVIDER=openai\n'
      printf 'FRONT_CONTENT_API_KEY=%q\n' "$api_key"
      printf 'FRONT_CONTENT_MODEL=%q\n' "$model"
      write_common
    } > "$ENV_FILE"
    ;;
  2)
    printf "Installed Ollama vision model name: "
    read -r model
    if [ -z "$model" ]; then
      echo "A local vision model name is required. Nothing changed."
      exit 1
    fi
    printf "Ollama endpoint [http://127.0.0.1:11434/api/chat]: "
    read -r endpoint
    endpoint="${endpoint:-http://127.0.0.1:11434/api/chat}"
    {
      printf 'FRONT_CONTENT_PROVIDER=ollama\n'
      printf 'FRONT_OLLAMA_MODEL=%q\n' "$model"
      printf 'FRONT_OLLAMA_ENDPOINT=%q\n' "$endpoint"
      write_common
    } > "$ENV_FILE"
    ;;
  3)
    {
      printf 'FRONT_CONTENT_PROVIDER=off\n'
      write_common
    } > "$ENV_FILE"
    ;;
  *)
    echo "Invalid choice. Nothing changed."
    exit 1
    ;;
esac

chmod 600 "$ENV_FILE"
echo "Saved private configuration to $ENV_FILE"
echo "No API key was printed. Restart browser-bridge/start.command to apply it."
