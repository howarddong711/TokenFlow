[English](./README.md) | [简体中文](./README.zh-CN.md)

# TokenFlow

![Platform](https://img.shields.io/badge/Platform-Windows%20%7C%20macOS-0078D6?style=flat-square)
![Desktop](https://img.shields.io/badge/Desktop-Tauri%202-24C8DB?style=flat-square)
![Frontend](https://img.shields.io/badge/Frontend-React%2019-61DAFB?style=flat-square)
![License](https://img.shields.io/badge/License-MIT-black?style=flat-square)

TokenFlow is a Windows and macOS desktop app for managing AI coding accounts and their provider-native quota windows in one place.

It brings account connections, quota windows, request activity, local logs, and workspace organization into a single desktop workflow for AI coding.

![TokenFlow Dashboard](./screenshots/dashboard.png)

## Why TokenFlow

- One desktop workspace for your main AI coding accounts
- Provider-native quota windows with each provider's own semantics
- Fast account overview for plan, health, reset windows, and recent updates
- Local logs and request visibility for troubleshooting
- Local-first storage with secrets kept in the system credential store
- Windows and macOS desktop bundles with channel-aware update flow

## Supported Providers

TokenFlow currently focuses on these providers:

- OpenAI Codex
- Cursor
- Trae
- Anti-Gravity
- GitHub Copilot

Support differs by provider. Some providers use OAuth, some read local sessions, and some expose richer quota windows than others.

## Screenshots

| Dashboard | Providers |
| --- | --- |
| ![Dashboard](./screenshots/dashboard.png) | ![Providers](./screenshots/providers.png) |

| Logs | API Keys |
| --- | --- |
| ![Logs](./screenshots/logs.png) | ![API Keys](./screenshots/api_key.png) |

| Settings | About |
| --- | --- |
| ![Settings](./screenshots/settings.png) | ![About](./screenshots/about.png) |

## Installation

### Download

Download the latest build from the [Releases](https://github.com/howarddong711/TokenFlow/releases/latest) page.

Release assets include:

- a versioned NSIS `.exe` installer
- a versioned `.msi` installer
- a versioned macOS `.dmg` bundle
- signed updater metadata for in-app updates

### Build from source

1. Clone the repository:

```bash
git clone https://github.com/howarddong711/TokenFlow.git
cd TokenFlow
```

2. Install dependencies:

```bash
npm install
```

3. Start the desktop app in development mode:

```bash
npm run tauri -- dev
```

4. Build the frontend:

```bash
npm run build
```

5. Build release bundles for your current OS target:

```bash
npm run tauri -- build
```

### macOS channel builds

TokenFlow supports both macOS GitHub distribution and Mac App Store channel policy.

- Initialize local updater signing key once:

```bash
npm run setup:updater-signing
```

Then export signing vars in your shell (especially `TAURI_SIGNING_PRIVATE_KEY`):

```bash
export TAURI_SIGNING_PRIVATE_KEY_PATH="$HOME/.tokenflow/updater/tokenflow-updater.key"
export TAURI_SIGNING_PRIVATE_KEY="$(cat "$TAURI_SIGNING_PRIVATE_KEY_PATH")"
export TAURI_SIGNING_PRIVATE_KEY_PASSWORD="<your-key-password>"
```

- Build macOS GitHub channel artifacts (in-app updater enabled):

```bash
npm run release:mac:github -- 0.1.4
```

- Build macOS App Store channel artifacts (in-app updater disabled):

```bash
npm run release:mac:mas -- 0.1.4
```
