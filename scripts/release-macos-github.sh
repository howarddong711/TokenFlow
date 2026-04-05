#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if [[ $# -lt 1 ]]; then
  echo "Usage: scripts/release-macos-github.sh <version>"
  echo "Example: scripts/release-macos-github.sh 0.1.4"
  exit 1
fi

RAW_VERSION="$1"
VERSION="${RAW_VERSION#v}"

if [[ -z "${TOKENFLOW_ANTIGRAVITY_CLIENT_ID:-}" ]]; then
  echo "[TokenFlow] Missing TOKENFLOW_ANTIGRAVITY_CLIENT_ID."
  exit 1
fi

if [[ -z "${TOKENFLOW_ANTIGRAVITY_CLIENT_SECRET:-}" ]]; then
  echo "[TokenFlow] Missing TOKENFLOW_ANTIGRAVITY_CLIENT_SECRET."
  exit 1
fi

if [[ -z "${TAURI_SIGNING_PRIVATE_KEY:-}" && -z "${TAURI_SIGNING_PRIVATE_KEY_PATH:-}" ]]; then
  echo "[TokenFlow] Missing TAURI_SIGNING_PRIVATE_KEY or TAURI_SIGNING_PRIVATE_KEY_PATH."
  echo "[TokenFlow] Run scripts/setup-updater-signing.sh first or export signing env vars."
  exit 1
fi

if [[ -z "${TAURI_SIGNING_PRIVATE_KEY:-}" ]]; then
  if [[ -z "${TAURI_SIGNING_PRIVATE_KEY_PATH:-}" || ! -f "${TAURI_SIGNING_PRIVATE_KEY_PATH}" ]]; then
    echo "[TokenFlow] TAURI_SIGNING_PRIVATE_KEY is empty and TAURI_SIGNING_PRIVATE_KEY_PATH is invalid."
    exit 1
  fi
  export TAURI_SIGNING_PRIVATE_KEY
  TAURI_SIGNING_PRIVATE_KEY="$(cat "${TAURI_SIGNING_PRIVATE_KEY_PATH}")"
fi

export TOKENFLOW_RELEASE_CHANNEL=github

echo "[TokenFlow] Syncing version to ${VERSION}..."
node scripts/sync-version.mjs "${VERSION}"

echo "[TokenFlow] Building frontend bundle..."
npm run build

echo "[TokenFlow] Running Rust validation..."
cargo check --manifest-path src-tauri/Cargo.toml

echo "[TokenFlow] Building macOS GitHub release artifacts..."
npm run tauri -- build --config src-tauri/tauri.github.conf.json

echo "[TokenFlow] macOS GitHub release build completed for v${VERSION}."
echo "[TokenFlow] Artifacts: src-tauri/target/release/bundle/"
