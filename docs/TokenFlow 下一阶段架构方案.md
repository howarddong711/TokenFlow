# TokenFlow 下一阶段架构方案

## 1. 目标

TokenFlow 下一阶段不改成“统一代理中台”，而是在保留当前产品定位的前提下，把请求追踪能力升级为“多来源、分层可信度”的架构。

这一阶段要完成 4 件事：

1. 保留现有账号工作台、平台原生额度语义和 Windows 桌面体验。
2. 让“真实请求追踪”成为可选增强能力，而不是产品前提。
3. 明确区分不同数据来源的可信度，不再把本地推断包装成全量真实数据。
4. 在功能上逐步达到并超过 Quotio，但不把 TokenFlow 变成 CLIProxyAPI 的壳。

## 2. 产品定位不变

TokenFlow 继续保持以下定位：

- 这是一个多平台 AI Coding 账号与额度监控工作台。
- 核心能力是统一账号管理、平台原生额度展示、活动与风险感知。
- 请求日志是重要能力，但不是产品唯一入口。
- TokenFlow 不默认承担“统一代理路由中心”的产品角色。

这意味着：

- 不要求所有供应商、所有客户端都必须改走 TokenFlow。
- 没有接入流量网关的场景，也必须能继续提供账号、额度和状态监控。
- UI 必须诚实表达“已观测流量”和“未观测流量”的边界。

## 3. 架构原则

下一阶段按这 5 条原则推进：

1. 账号层、额度层、请求层分离。
2. 数据来源分层，可信度显式化。
3. 请求追踪能力可选接入，不绑定产品核心路径。
4. 先统一展示协议，不先统一采集方式。
5. 任何新能力都不能破坏当前已稳定的登录、额度抓取和桌面工作流。

## 4. 三层架构

### 4.1 账号与连接层

负责：

- provider 能力声明
- 多账号登录与恢复
- OAuth / API Key / Service Account / Cookie / 本地探测
- 账号去重、备份、恢复、凭据存储

当前状态：

- 已具备基础能力
- 继续作为 TokenFlow 的稳定底座

这一层不依赖请求追踪网关。

### 4.2 平台原生额度层

负责：

- 调 provider 官方接口、Cookie 会话、本地 CLI 状态
- 拉取 session / weekly / credits / usage windows
- 保留 provider-native 额度结构
- 输出统一展示模型给前端

当前状态：

- 已有较完整实现
- 继续按 provider-native 语义扩展

这是 TokenFlow 的主能力，不应该被代理架构替代。

### 4.3 请求活动层

这是下一阶段重点新增的能力层。

它不再只依赖单一本地日志扫描，而是允许同时接入 3 类来源：

1. `gateway_observed`
   - 高置信度
   - 请求真实经过 TokenFlow 本地网关或转发层
   - 可记录 provider、model、状态码、耗时、token、账号归因

2. `provider_reported`
   - 中高置信度
   - 来自 provider 官方 usage / analytics / export 接口
   - 更适合聚合统计，不一定有逐请求明细

3. `local_inferred`
   - 中低置信度
   - 来自本地 CLI / IDE / 会话日志扫描
   - 适合补齐未接入网关的场景，但天然不是全量观测

## 5. 数据可信度与 UI 语义

后续所有请求活动数据，都必须带上来源语义。

### 5.1 数据来源标签

前端统一使用这 3 个来源标签：

- `Observed traffic`
- `Provider-reported usage`
- `Local inferred activity`

### 5.2 覆盖范围

前端统一使用这 4 个覆盖语义：

- `none`
- `partial`
- `full`
- `mixed`

解释：

- `none`：当前没有可用追踪来源
- `partial`：只有部分客户端或部分 provider 被观测
- `full`：当前接入范围内已全量经过观测入口
- `mixed`：同时存在多种来源，且覆盖能力不同

### 5.3 UI 必须表达的事实

日志页和总览页都必须让用户一眼看懂：

- 这些请求记录是怎么来的
- 是否只覆盖部分工具
- 当前 token / request 是真实观测、官方汇总还是本地推断

## 6. 为什么不整体切到 CLIProxyAPI

不采用“整体重建成 CLIProxyAPI 后端”的原因：

1. 那会改变 TokenFlow 的产品定位，把产品推向代理中台。
2. 代理只能看到“经过它的流量”，不是天然全覆盖。
3. 现有账号、额度、工作台和安装链路会被大面积重做。
4. 这会把 TokenFlow 的核心竞争力从“多来源原生监控”改成“流量路由”。

可以借鉴 CLIProxyAPI 的地方：

- 本地可选网关
- 请求观测回调
- 统一的请求事件模型

不借鉴的地方：

- 用代理替代整个产品架构
- 把所有供应商能力都强行收口成路由问题

## 7. 推荐路线：2.5 路线

推荐路线不是完全选 1，也不是保持现状不动，而是：

`保留 TokenFlow 主架构 + 新增可选 tracking gateway + 保留多来源补充`

即：

- 账号与额度继续按现在的 provider-native 路线做
- 请求追踪新增一个可选本地 gateway 模块
- 没接入 gateway 的 provider 继续使用 provider_reported 或 local_inferred
- 前端统一展示来源和覆盖范围

## 8. 模块拆分建议

### 8.1 Rust 侧新增模块

建议新增：

- `src-tauri/src/tracking/mod.rs`
- `src-tauri/src/tracking/types.rs`
- `src-tauri/src/tracking/local_logs.rs`
- `src-tauri/src/tracking/provider_reports.rs`
- `src-tauri/src/tracking/status.rs`

后续如果接入网关，再增加：

- `src-tauri/src/tracking/gateway.rs`

### 8.2 统一请求事件模型

统一输出结构建议包含：

- `id`
- `timestamp`
- `provider_id`
- `account_hint`
- `model`
- `status`
- `input_tokens`
- `output_tokens`
- `duration_ms`
- `source_type`
- `coverage`
- `confidence`

### 8.3 前端统一模型

前端不直接假设“所有请求都同一种来源”，而是围绕以下信息设计界面：

- 请求记录列表
- 请求摘要
- 当前追踪状态
- 来源分布

## 9. UI 改造方向

### 9.1 Dashboard

新增一个轻量级 Tracking Status 区域，用于表达：

- 当前主来源
- 覆盖范围
- 是否为部分观测

### 9.2 Logs

这是第一优先级页面。

必须新增：

- 当前追踪来源说明
- 来源标签
- 覆盖范围说明
- 空态下的来源提示

### 9.3 Settings

新增 Request Tracking 设置卡片，展示：

- 当前请求追踪模式
- 已接入来源
- 覆盖说明
- 后续网关入口预留位

## 10. 迭代顺序

### Phase 1：来源可视化

- 为现有请求日志补充 `source_type`
- 新增 `request tracking status`
- 在 Logs / Settings 中展示来源与覆盖

### Phase 2：本地扫描体系整理

- 把当前 Codex 本地日志扫描从命令层抽到 tracking 模块
- 增加更多可稳定支持的本地日志来源
- 区分“真实 token”和“推断请求边界”

### Phase 3：官方 usage 汇总接入

- 对支持的 provider 增加 provider-reported usage 通道
- 让总览页支持混合来源汇总

### Phase 4：可选 gateway

- 引入 TokenFlow 本地转发层
- 仅对愿意接入的客户端记录真实请求流量
- 在 UI 中把这部分标记为高置信度观测数据

### Phase 5：账号归因与实时活动

- 请求归因到具体账号
- 实时最近活动
- provider / account 级活动流

## 11. 验收标准

下一阶段完成时，至少满足：

1. 用户能看懂当前请求统计来自哪里。
2. 用户能区分“真实观测”和“本地推断”。
3. 没接入网关时，TokenFlow 仍然是可用产品。
4. 接入网关后，请求统计能自然升级，而不是推翻现有 UI。
5. 产品整体仍然是 TokenFlow，而不是 Windows 版 Quotio。

## 12. 当前落地决策

基于现阶段代码与产品方向，当前决定如下：

- 不重建仓库到 CLIProxyAPI 架构
- 继续保留 TokenFlow 当前代码基线
- 先实现请求追踪来源分层与 UI 可视化
- 后续按可选 gateway 方向扩展

这就是 TokenFlow 下一阶段的正式架构方向。
