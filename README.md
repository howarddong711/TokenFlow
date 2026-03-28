[English](./README.md) | [简体中文](./README.zh-CN.md)

# TokenFlow

![Platform](https://img.shields.io/badge/Platform-Windows-0078D6?style=flat-square)
![Desktop](https://img.shields.io/badge/Desktop-Tauri%202-24C8DB?style=flat-square)
![Frontend](https://img.shields.io/badge/Frontend-React%2019-61DAFB?style=flat-square)
![License](https://img.shields.io/badge/License-MIT-black?style=flat-square)

TokenFlow is a Windows desktop app for managing AI coding accounts and their real provider-native quota windows in one place.

Instead of flattening every provider into a fake shared quota model, TokenFlow keeps each platform's own semantics intact. You can connect accounts, compare quota windows, inspect request activity, review logs, and keep your local AI tooling workspace organized.

![TokenFlow Dashboard](./screenshots/dashboard.png)

## Why TokenFlow

- One desktop workspace for your main AI coding accounts
- Provider-native quota windows instead of guessed unified percentages
- Fast account overview for plan, health, reset windows, and recent updates
- Local logs and request visibility for troubleshooting
- Local-first storage with secrets kept in the system credential store
- Windows installers and GitHub Release-based update flow

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

Download the latest Windows build from the [Releases](https://github.com/howarddong711/TokenFlow/releases/latest) page.

Release assets include:

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

Some provider login flows require private OAuth credentials that are intentionally not stored in this repository.

```bash
TOKENFLOW_ANTIGRAVITY_CLIENT_ID=
TOKENFLOW_ANTIGRAVITY_CLIENT_SECRET=
TOKENFLOW_IFLOW_CLIENT_ID=
TOKENFLOW_IFLOW_CLIENT_SECRET=
```
