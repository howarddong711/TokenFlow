#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
KEY_DIR="${TOKENFLOW_UPDATER_KEY_DIR:-$HOME/.tokenflow/updater}"
KEY_PATH="${TOKENFLOW_UPDATER_KEY_PATH:-$KEY_DIR/tokenflow-updater.key}"
KEY_PASSWORD="${TOKENFLOW_UPDATER_KEY_PASSWORD:-}"

mkdir -p "$KEY_DIR"

if [[ -f "$KEY_PATH" ]]; then
  echo "[TokenFlow] Updater private key already exists: $KEY_PATH"
else
  if [[ -z "$KEY_PASSWORD" ]]; then
    read -r -s -p "Enter a password for the updater private key: " KEY_PASSWORD
    echo
  fi

  if [[ -z "$KEY_PASSWORD" ]]; then
    echo "[TokenFlow] A non-empty password is required."
    exit 1
  fi

  echo "[TokenFlow] Generating updater signing key..."
  (
    cd "$ROOT_DIR"
    npm run tauri -- signer generate --ci --write-keys "$KEY_PATH" --password "$KEY_PASSWORD"
  )
fi

if [[ ! -f "${KEY_PATH}.pub" ]]; then
  echo "[TokenFlow] Warning: public key file not found at ${KEY_PATH}.pub"
fi

CONFIG_PUBKEY="$(
  node -e 'const fs=require("fs");const c=JSON.parse(fs.readFileSync("src-tauri/tauri.conf.json","utf8"));const encoded=c?.plugins?.updater?.pubkey||"";if(encoded){process.stdout.write(Buffer.from(encoded,"base64").toString("utf8"));}' \
  2>/dev/null || true
)"
LOCAL_PUBKEY="$(cat "${KEY_PATH}.pub" 2>/dev/null || true)"
if [[ -n "$CONFIG_PUBKEY" && -n "$LOCAL_PUBKEY" && "$CONFIG_PUBKEY" != "$LOCAL_PUBKEY" ]]; then
  echo "[TokenFlow] Warning: local private key does not match src-tauri/tauri.conf.json updater pubkey."
  echo "[TokenFlow] Keep the existing private key if you want seamless updater continuity."
  echo "[TokenFlow] Rotate only if you intentionally plan a key migration."
fi

cat <<EOF

[TokenFlow] Local signing key is ready.
[TokenFlow] Export these variables in your shell before building release artifacts:

export TAURI_SIGNING_PRIVATE_KEY_PATH="$KEY_PATH"
export TAURI_SIGNING_PRIVATE_KEY="\$(cat \"$KEY_PATH\")"
export TAURI_SIGNING_PRIVATE_KEY_PASSWORD="<your-key-password>"

EOF
