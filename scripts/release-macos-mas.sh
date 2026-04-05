#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if [[ $# -lt 1 ]]; then
  echo "Usage: scripts/release-macos-mas.sh <version>"
  echo "Example: scripts/release-macos-mas.sh 0.1.4"
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

export TOKENFLOW_RELEASE_CHANNEL=mac_app_store

echo "[TokenFlow] Syncing version to ${VERSION}..."
node scripts/sync-version.mjs "${VERSION}"

echo "[TokenFlow] Building frontend bundle..."
npm run build

echo "[TokenFlow] Running Rust validation..."
cargo check --manifest-path src-tauri/Cargo.toml

echo "[TokenFlow] Building macOS App Store candidate bundle..."
npm run tauri -- build --config src-tauri/tauri.mas.conf.json

echo "[TokenFlow] macOS App Store bundle build completed for v${VERSION}."
echo "[TokenFlow] Artifacts: src-tauri/target/release/bundle/macos/"
echo "[TokenFlow] Next: codesign/notarize/app-store packaging in Apple workflow."
