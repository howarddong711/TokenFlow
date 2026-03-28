[English](./README.md) | [简体中文](./README.zh-CN.md)

# TokenFlow

![Platform](https://img.shields.io/badge/Platform-Windows-0078D6?style=flat-square)
![Desktop](https://img.shields.io/badge/Desktop-Tauri%202-24C8DB?style=flat-square)
![Frontend](https://img.shields.io/badge/Frontend-React%2019-61DAFB?style=flat-square)
![License](https://img.shields.io/badge/License-MIT-black?style=flat-square)

TokenFlow 是一个面向 Windows 的 AI 编码账号与额度管理桌面应用，用来把多个主力 provider 的额度窗口放到同一个本地工作台里查看。

它把账号连接、额度窗口、请求活动、本地日志和工作区整理能力整合进同一个 Windows 桌面工作流，方便持续管理日常 AI 编码环境。

![TokenFlow Dashboard](./screenshots/dashboard.png)

## 为什么用 TokenFlow

- 一个桌面工作区统一管理主要 AI 编码账号
- 以 provider-native quota 语义展示各平台额度窗口
- 快速查看账号 plan、健康状态、重置时间和最近更新时间
- 提供本地日志和请求可见性，方便排查问题
- 本地优先存储，敏感凭据保存在系统凭据存储中
- 提供 Windows 安装包和基于 GitHub Releases 的更新能力

## 当前支持的 Providers

当前 README 重点展示这 5 个 provider：

- OpenAI Codex
- Cursor
- Trae
- Anti-Gravity
- GitHub Copilot

不同 provider 的接入方式并不完全相同。有些走 OAuth，有些读取本地会话，有些能提供更完整的额度窗口信息。

## 截图

| Dashboard | Providers |
| --- | --- |
| ![Dashboard](./screenshots/dashboard.png) | ![Providers](./screenshots/providers.png) |

| Logs | API Keys |
| --- | --- |
| ![Logs](./screenshots/logs.png) | ![API Keys](./screenshots/api_key.png) |

| Settings | About |
| --- | --- |
| ![Settings](./screenshots/settings.png) | ![About](./screenshots/about.png) |

## 安装

### 下载安装

从 [Releases](https://github.com/howarddong711/TokenFlow/releases/latest) 页面下载最新的 Windows 安装包。

当前发布资产包括：

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
