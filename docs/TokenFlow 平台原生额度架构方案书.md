# TokenFlow 平台原生额度架构方案书

## 1. 文档目标
这份方案书用于明确 TokenFlow 当前阶段的产品边界、平台接入策略、数据结构和后续开发顺序。

当前总原则只有一句话：

**尽量对齐 Quotio 的成熟接入方式，但不照搬其代码形状。**

## 2. 当前产品结论

### 2.1 首版范围已经正式收敛
TokenFlow 不再继续做泛平台铺量，而是收敛到 Quotio 对齐集合。

当前首版范围：

- Codex
- Claude
- Qwen
- Gemini
- Copilot
- Cursor
- Trae
- Antigravity
- Kiro
- iFlow
- Vertex AI
- Warp

当前 backlog：

- GLM

### 2.2 不再强做统一 quota 模型
TokenFlow 统一的是账号和控制台能力，不是所有平台的额度语义。

正确做法：

- 统一账号身份、凭据引用、连接状态、刷新、告警、历史、导出
- 不统一 OpenAI / Copilot / Cursor / Claude / Vertex / iFlow 的官方窗口语义

错误做法：

- 把所有平台压成一套“统一 quota list”
- 为了前端简单而伪造平台并不存在的窗口

## 3. Quotio 对齐方法论

### 3.1 Quotio 的 OAuth 不是一种技术实现
Quotio 文案里很多平台都写成 OAuth，但在工程上至少分成五类：

1. Browser OAuth
2. Device Flow
3. CLI OAuth / CLI 已登录导入
4. IDE Monitor Only
5. Service Credential Import

TokenFlow 现在采用同样的分型，而不是尝试用一个“万能登录弹窗”覆盖所有平台。

### 3.2 当前接入分型

#### Browser OAuth
- OpenAI Codex
- Antigravity
- iFlow

#### Device Flow
- GitHub Copilot

#### CLI OAuth / CLI 登录态导入
- Claude
- Gemini
- Qwen
- Kiro

#### IDE Monitor Only
- Cursor
- Trae

#### Service Credential Import
- Vertex AI Service Account JSON（后续补强）

## 4. 当前架构

### 4.1 统一层
统一层只保留两部分：

#### AccountRecord
负责：

- providerId
- accountId
- authKind
- label / email / username
- secretRef
- default
- sessionHealth
- lastFetchedAt

#### Control Layer
负责：

- refresh
- pulse
- command center
- mission control
- tray
- history
- diagnostics

### 4.2 平台原生层
每个平台返回自己的 ProviderUsageSnapshot。

```ts
type ProviderUsageSnapshot = {
  windows: ProviderUsageWindow[];
  headlineWindowId?: string;
}
```

这里的 `windows` 只是展示外壳，不代表所有平台被统一解释。

### 4.3 当前真实策略

- 有官方额度窗口：按官方窗口展示
- 没有官方额度窗口但能确认账号：显示已连接状态，不伪造额度
- 不能确认账号：明确显示错误或未连接

## 5. 当前代码结构

### 5.1 Rust 侧

关键文件：

- `E:\code\TokenFlow\src-tauri\src\core\provider.rs`
- `E:\code\TokenFlow\src-tauri\src\core\accounts.rs`
- `E:\code\TokenFlow\src-tauri\src\providers\mod.rs`
- `E:\code\TokenFlow\src-tauri\src\providers\iflow\mod.rs`
- `E:\code\TokenFlow\src-tauri\src\providers\trae\mod.rs`

当前状态：

- `ProviderId` 已扩展到 `iflow`
- `iFlow` 已成为一等 provider
- `iFlow` 账号能力已纳入 provider capability 列表
- `iFlow` 走 OAuth source，不再只是孤立命令
- `Trae` 已成为一等 provider
- `Trae` 走本地桌面会话 monitor-only，不伪装成网页登录
- `UsageSnapshot` 已支持 provider-native extra windows，避免把 Trae 这类多额度项平台压扁

### 5.2 前端侧

关键文件：

- `E:\code\TokenFlow\src\types\providers.ts`
- `E:\code\TokenFlow\src\components\AddAccountDialog.tsx`
- `E:\code\TokenFlow\src\components\Sidebar.tsx`
- `E:\code\TokenFlow\src\lib\provider-focus.ts`
- `E:\code\TokenFlow\src\lib\provider-native.ts`
- `E:\code\TokenFlow\src\i18n\productCopy.ts`

当前状态：

- `iflow` 已进入前端 provider 类型与元数据
- 新增账号弹窗已支持 iFlow 官方 OAuth
- 侧边栏已纳入 iFlow
- 焦点 provider 集合已包含 iFlow
- iFlow 当前按“已连接但无官方额度窗口”展示，不造假窗口
- `trae` 已进入前端 provider 类型与元数据
- 新增账号弹窗已支持 Trae 本地桌面会话导入
- 焦点 provider 集合已包含 Trae
- 前端原生窗口层已支持 extra windows，用于承接 Trae 多额度项

## 6. 已完成的 Quotio 对齐结果

### 6.1 已跑通

#### OpenAI Codex
- 浏览器 OAuth 回跳已跑通
- Windows 凭据存储、长 token、浏览器打开、回跳保存都已处理

#### GitHub Copilot
- Device Flow 已跑通
- 账号创建、凭据保存、额度抓取已稳定

#### Cursor
- 本地桌面会话检测已接入
- 浏览器资料扫描与 Cookie 兜底已存在
- 当前更接近 Quotio 的 IDE monitor-only 思路

#### Trae
- 本地桌面会话检测已接入
- 通过本地 storage.json 读取登录态
- 调用 Trae entitlement API 获取原生额度窗口
- 当前对齐 Quotio 的 IDE monitor-only 形态

#### Antigravity
- 浏览器 OAuth 已接进新增账号流程

#### Kiro
- 本地已登录环境接入已接进新增账号流程

#### iFlow
- 浏览器 OAuth 已接进新增账号流程
- provider 能识别 OAuth 账号并返回已连接状态
- 当前不伪造额度窗口

### 6.2 已部分具备但尚未补完

#### Vertex AI
- Service Account JSON 导入已接入新增账号流程
- 项目身份校验已经走真实 provider 路径
- 当前按“已连接但暂无官方额度窗口”展示，不伪造窗口

#### Qwen
- 本地 OAuth 凭据导入已接入新增账号流程
- 当前按“账号已连接但无官方额度窗口”展示
- 这更接近 Quotio 的首版心智，而不是继续保留 API key 占位

## 7. iFlow 当前实现说明

### 7.1 为什么先做 iFlow
原因很直接：

- 仓库里已经有完整的 iFlow OAuth 命令
- 它最适合继续按 Quotio 分型往前推进
- 相比 Qwen / Vertex，它落地阻力最小

### 7.2 当前 iFlow 体验
现在用户可以：

1. 在新增账号里点击 iFlow
2. 拉起 iFlow 官方授权页
3. 完成本地回调
4. 交换 access token / refresh token
5. 创建 iFlow 监控账号

### 7.3 当前 iFlow 展示策略
iFlow 当前实现的是“账号连接确认”，不是完整 quota tracking。

这意味着：

- 会显示账号已连接
- 会保留邮箱与连接方式
- 不会伪造月度或窗口额度
- UI 会表现为“Connected but no quota windows are currently available”

这和 Quotio PRD 里 `iFlow | OAuth | Quota Tracking: No` 的定位是一致的。

## 8. Qwen 当前实现说明

### 8.1 为什么先用本地 OAuth 导入
原因很直接：

- Quotio 产品层把 Qwen 归为 OAuth provider
- 但当前在 Windows 侧，最稳的真实落地是导入本地已保存的 OAuth 文件
- 这样比伪造一个未经验证的网页回跳更可靠，也更适合 TokenFlow 首版

### 8.2 当前 Qwen 体验
现在用户可以：

1. 在新增账号里点击 Qwen
2. 直接导入本地已有的 Qwen OAuth 凭据
3. 或先扫描本地 Qwen OAuth 文件列表，再指定导入某一个账号
4. 让 TokenFlow 保存并接入这个账号
5. 在工作台里看到账号已连接状态

### 8.3 当前 Qwen 展示策略
Qwen 当前不伪造额度窗口：

- 会显示账号已连接
- 会保留 OAuth 连接方式
- 会保留本地来源标识，方便区分多账号导入
- 不会凭空生成月度或请求额度卡

这和“平台原生优先，不强造统一额度”的当前架构方向一致。

## 9. Trae 当前实现说明

### 9.1 为什么先补 Trae
原因很直接：

- 它和 Cursor 一样属于 Quotio 的 monitor-only 路线
- Windows 本地会话读取更适合 TokenFlow 的 Tauri/Rust 内核
- Trae 有多种 entitlement 窗口，正好推动我们把“平台原生额度窗口”结构做真

### 9.2 当前 Trae 体验
现在用户可以：

1. 在新增账号里点击 Trae
2. 直接导入本地已登录的 Trae 桌面会话
3. 由 TokenFlow 调用 Trae 官方 entitlement API
4. 把 advanced model / auto-completion / premium fast / premium slow 等窗口带回桌面工作台

### 9.3 当前 Trae 展示策略
Trae 当前不是被压成一张假月卡，而是保留 provider-native 窗口：

- Advanced model usage
- Auto-completion usage
- Premium fast usage
- Premium slow usage

这比旧的 primary / secondary / model_specific 三栏更接近 Quotio 设计目标。

## 10. 为什么 TokenFlow 不能直接照抄参考项目

### 10.1 参考项目给的是地图，不是现成底盘
Quotio、Win-CodexBar、CLIProxyAPI 都是在各自前提下成立的完整闭环，但这些闭环并不天然可抽出来复用。

### 10.2 本机环境差异非常大
这次真实踩到的问题包括：

- Windows Credential Manager 限制
- keyring 后端特性
- Tauri 浏览器打开方式
- 本地代理与证书链
- 桌面端与浏览器端认证来源不同

### 10.3 多平台控制台比单平台工具更难抽象
单项目“能跑通”不等于多平台“能抽象”。  
TokenFlow 还要同时处理：

- 多 provider
- 多账号
- 多认证通道
- 多种额度窗口
- 统一诊断与告警

所以参考项目更多提供的是接入思路，而不是可以直接复制的工程结构。

## 9. 接下来推荐开发顺序

### P0

#### 1. 做 Vertex AI Service Account JSON 导入
目标：

- 新增专用导入入口
- 导入并验证 service account JSON
- 明确区分 OAuth / API key / service credential

#### 2. 继续细化 Codex / Copilot / Cursor 的原生视图
目标：

- 更接近官方命名
- 更好的窗口标签
- 更明确的 plan / spend / reset 展示

#### 3. 打磨 iFlow 连接后的账号状态卡
目标：

- 显示更清楚的“已连接但无官方额度窗口”
- 避免用户误以为接入失败

### P1

#### 1. 研究并接入 Qwen OAuth
目标：

- 明确其真实授权形态
- 决定是否是 Browser OAuth 还是别的变体

#### 2. 做 Trae IDE monitor-only
目标：

- 读取本地登录态
- 与 Cursor 一样走显式扫描
- 不纳入自动后台轮询

#### 3. 完成 Vertex AI 项目级额度展示
目标：

- 在完成 JSON 导入后，再补项目预算和配额展示

### P2

#### 1. GLM 接入
#### 2. 更多 provider-native detail 页面
#### 3. 更强的历史回放与对比

## 10. 当前验证结果
本轮代码修改已通过：

- `npm run build`
- `cargo check`

## 11. 当前落地判断
现在的 TokenFlow 已经明显更接近 Quotio 的成熟形态：

- 不再强行统一所有平台额度
- 登录入口按平台分型
- IDE 平台开始走 monitor-only 思路
- iFlow 从 backlog 命令升级成了一等 provider

下一步最值得做的不是继续加平台名字，而是把 `Vertex JSON` 和 `Trae monitor-only` 这两条真正补起来。这样 TokenFlow 的首版骨架就会更像一个成熟、可信的 Quotio 对齐版 Windows 产品。
