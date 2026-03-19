[English](./README.md) | [简体中文](./README.zh-CN.md)

# TokenFlow

![Platform](https://img.shields.io/badge/Platform-Windows-0078D6?style=flat-square)
![Desktop](https://img.shields.io/badge/Desktop-Tauri%202-24C8DB?style=flat-square)
![Frontend](https://img.shields.io/badge/Frontend-React%2019-61DAFB?style=flat-square)
![License](https://img.shields.io/badge/License-MIT-black?style=flat-square)

TokenFlow is a Windows desktop command center for AI coding accounts, local request visibility, and provider-native quota windows.

It keeps multiple providers in one workspace without flattening them into a fake shared quota model. You can connect accounts, inspect quota windows, review local request activity, export logs, and ship signed desktop updates through GitHub Releases.

![TokenFlow Dashboard](./screenshots/dashboard.png)

## Features

- Multi-provider workspace for AI coding accounts on Windows
- Provider-native quota windows instead of a synthetic unified quota model
- Dashboard for token usage, request volume, provider coverage, and account health
- Provider views for per-account status, quota windows, and recent activity
- Request logs and local app logs for debugging
- Local-first storage with secrets kept in the system credential store
- Built-in update checks and automatic update support via GitHub Releases

## Supported Workflow

### Account and quota management

- OpenAI Codex
- GitHub Copilot
- Claude
- Gemini
- Qwen
- Vertex AI
- iFlow
- Antigravity
- Kiro
- OpenCode
- Warp

### Local session and usage monitoring

- Cursor
- Trae

Support varies by provider. Some flows use OAuth, some import CLI or local credentials, and some are monitor-only depending on what the provider actually exposes.

## Installation

### Download

Download the latest Windows installer from the [Releases](https://github.com/howarddong711/TokenFlow/releases/latest) page.

Available release assets include:

- a versioned NSIS `.exe` installer
- a versioned `.msi` installer
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

5. Build Windows release bundles:

```bash
npm run tauri -- build
```

## OAuth Environment Variables

Some provider flows require private OAuth credentials that are intentionally not stored in this repository.

```bash
TOKENFLOW_ANTIGRAVITY_CLIENT_ID=
TOKENFLOW_ANTIGRAVITY_CLIENT_SECRET=
TOKENFLOW_IFLOW_CLIENT_ID=
TOKENFLOW_IFLOW_CLIENT_SECRET=
```

## Screenshots

| Dashboard | Providers |
| --- | --- |
| ![Dashboard](./screenshots/dashboard.png) | ![Providers](./screenshots/providers.png) |

| Logs | Settings |
| --- | --- |
| ![Logs](./screenshots/logs.png) | ![Settings](./screenshots/settings.png) |

| About |
| --- |
| ![About](./screenshots/about.png) |

## Release Flow

TokenFlow ships with a GitHub Releases based updater. A normal release flow is:

1. Sync the version everywhere:

```powershell
.\release.bat 0.1.2
```

2. Verify the build:

```powershell
npm run build
cargo test --manifest-path src-tauri\Cargo.toml
```

3. Commit, push, and tag:

```powershell
git add .
git commit -m "Release v0.1.2"
git push origin main
git tag v0.1.2
git push origin v0.1.2
```

The GitHub Actions release workflow builds the Windows installers, uploads signed artifacts, and publishes the updater metadata used by the in-app update flow.
