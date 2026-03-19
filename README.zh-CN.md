[English](./README.md) | [简体中文](./README.zh-CN.md)

# TokenFlow

![Platform](https://img.shields.io/badge/Platform-Windows-0078D6?style=flat-square)
![Desktop](https://img.shields.io/badge/Desktop-Tauri%202-24C8DB?style=flat-square)
![Frontend](https://img.shields.io/badge/Frontend-React%2019-61DAFB?style=flat-square)
![License](https://img.shields.io/badge/License-MIT-black?style=flat-square)

TokenFlow 是一个面向 Windows 的 AI 编码账号与额度管理桌面应用，用来统一查看多家服务商账号、本地请求活动和各平台原生 quota 窗口。

它不会把所有服务商硬压成一个假的统一额度模型，而是尽量保留每个平台自己的额度语义。你可以在一个本地工作区里连接账号、查看配额窗口、检查请求日志、导出调试日志，并通过 GitHub Releases 获取签名更新。

![TokenFlow Dashboard](./screenshots/dashboard.png)

## 功能特性

- 在 Windows 上统一管理多个 AI 编码服务商账号
- 保留 provider-native quota 语义，而不是伪造统一额度模型
- Dashboard 展示 token 使用量、请求量、服务商覆盖和账号健康状态
- Provider 页面按账号查看额度窗口、状态和近期活动
- 请求日志和应用日志分离，方便定位问题
- 本地优先存储，敏感凭据保存在系统凭据存储中
- 内置检查更新和自动更新能力，更新来源为 GitHub Releases

## 支持的工作流

### 账号与额度管理

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

### 本地会话与用量监控

- Cursor
- Trae

不同服务商的接入方式不完全一样。有些走 OAuth，有些导入 CLI 或本地凭据，有些仅用于本地监控，这取决于服务商实际暴露的能力。

## 安装

### 下载安装

从 [Releases](https://github.com/howarddong711/TokenFlow/releases/latest) 页面下载最新的 Windows 安装包。

当前发布产物包括：

- 带版本号的 NSIS `.exe` 安装包
- 带版本号的 `.msi` 安装包
- 用于应用内更新的签名元数据

### 从源码构建

1. 克隆仓库：

```bash
git clone https://github.com/howarddong711/TokenFlow.git
cd TokenFlow
```

2. 安装依赖：

```bash
npm install
```

3. 启动桌面开发环境：

```bash
npm run tauri -- dev
```

4. 构建前端：

```bash
npm run build
```

5. 构建 Windows 发布包：

```bash
npm run tauri -- build
```

## OAuth 环境变量

部分 provider 的 OAuth 登录需要私有凭据，这些凭据不会存放在仓库里。

```bash
TOKENFLOW_ANTIGRAVITY_CLIENT_ID=
TOKENFLOW_ANTIGRAVITY_CLIENT_SECRET=
TOKENFLOW_IFLOW_CLIENT_ID=
TOKENFLOW_IFLOW_CLIENT_SECRET=
```

## 截图

| Dashboard | Providers |
| --- | --- |
| ![Dashboard](./screenshots/dashboard.png) | ![Providers](./screenshots/providers.png) |

| Logs | Settings |
| --- | --- |
| ![Logs](./screenshots/logs.png) | ![Settings](./screenshots/settings.png) |

| About |
| --- |
| ![About](./screenshots/about.png) |

## 发版流程

TokenFlow 现在已经接通了基于 GitHub Releases 的应用更新链路。日常发版流程可以按下面来：

1. 先同步所有版本号：

```powershell
.\release.bat 0.1.2
```

2. 验证构建与测试：

```powershell
npm run build
cargo test --manifest-path src-tauri\Cargo.toml
```

3. 提交、推送并打 tag：

```powershell
git add .
git commit -m "Release v0.1.2"
git push origin main
git tag v0.1.2
git push origin v0.1.2
```

GitHub Actions 的 release workflow 会自动构建 Windows 安装包、上传签名产物，并发布应用内更新所需的 updater 元数据。
