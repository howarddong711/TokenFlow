# TokenFlow

TokenFlow is a Windows desktop dashboard for AI coding accounts, token usage, and provider-native quota windows.

Tagline: Make every token spend traceable.

## What It Does

- Connect multiple AI coding providers and accounts in one desktop workspace
- Preserve provider-native quota semantics instead of flattening everything into a fake unified model
- Track local request activity from supported tools such as Codex and OpenCode
- Show token usage, request volume, and provider-level balance windows in a compact dashboard
- Export and inspect local application logs for debugging

## Current Provider Coverage

The app is focused on providers and environments that are common in real AI coding workflows, including:

- OpenAI Codex
- GitHub Copilot
- Claude
- Gemini
- Qwen
- Cursor
- Trae
- Kiro
- Anti-Gravity
- OpenCode
- Vertex AI
- Warp
- iFlow

Some providers are connected via OAuth, some via CLI-imported credentials, and some via local environment monitoring depending on what the provider actually supports.

## Product Direction

TokenFlow is not a proxy platform and not a generic “AI toolbox”.

The product direction is:

- one local Windows workspace
- multiple providers and accounts
- provider-native quota views
- practical request visibility from real local sources

## Tech Stack

- Tauri v2
- React 19
- TypeScript
- Vite
- Tailwind CSS 4

## Development

Install dependencies:

```bash
npm install
```

Run the desktop app in development mode:

```bash
npm run tauri -- dev
```

Build the frontend:

```bash
npm run build
```

Build Windows release bundles:

```bash
npm run tauri -- build
```

## OAuth Environment Variables

Some providers require private OAuth credentials that are intentionally not stored in this repository.

Set these before using the corresponding login flow:

```bash
TOKENFLOW_ANTIGRAVITY_CLIENT_ID=
TOKENFLOW_ANTIGRAVITY_CLIENT_SECRET=
TOKENFLOW_IFLOW_CLIENT_ID=
TOKENFLOW_IFLOW_CLIENT_SECRET=
```

## Release Artifacts

Windows release output is generated under:

- `src-tauri/target/release/bundle/nsis/`
- `src-tauri/target/release/bundle/msi/`

## Repository Notes

- Local build output is ignored from Git
- Provider colors, language choice, and workspace preferences are stored locally
- Secrets stay out of the repository and are kept in the local system credential store

## Links

- GitHub profile: [https://github.com/howarddong711](https://github.com/howarddong711)
