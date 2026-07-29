# GSP 面板 `/admin/` 页面调研分析报告

> 调研对象：`https://gsp.ecsrz.com:3001/admin/` 全部子页面
> 调研时间：2026-07-29
> 线上版本：v4.29.7（footer BUILD 序列）
> 调研方法：浏览器实地访问 + 前端源码深度分析（React 19 + Vite + TS）
> 覆盖范围：27 个活跃 admin 页面 + 共享外壳架构

---

## 目录

- [一、总体概览](#一总体概览)
- [二、共享外壳架构（AdminLayout + Layout）](#二共享外壳架构adminlayout--layout)
- [三、页面详细分析](#三页面详细分析)
  - [A. 仪表盘与监控组](#a-仪表盘与监控组)
    - [1. 平台大盘 `/admin`](#1-平台大盘-admin)
    - [2. 全平台总览 `/admin/platform`](#2-全平台总览-adminplatform)
    - [3. 系统监控 `/admin/system-health`](#3-系统监控-adminsystem-health)
    - [4. 审计日志 `/admin/audit-logs`](#4-审计日志-adminaudit-logs)
    - [5. 运维清理 `/admin/maintenance`](#5-运维清理-adminmaintenance)
  - [B. 用户与权限组](#b-用户与权限组)
    - [6. 权限管理 `/admin/users`](#6-权限管理-adminusers)
    - [7. 玩家绑定 `/admin/player-bindings`](#7-玩家绑定-adminplayer-bindings)
    - [8. 提现审批 `/admin/withdraws`](#8-提现审批-adminwithdraws)
    - [9. API Keys `/admin/api-keys`](#9-api-keys-adminapi-keys)
    - [10. Webhooks `/admin/webhooks`](#10-webhooks-adminwebhooks)
  - [C. 实例与节点组](#c-实例与节点组)
    - [11. 实例列表 `/admin/servers`](#11-实例列表-adminservers)
    - [12. 实例详情 `/admin/servers/:id`](#12-实例详情-adminserversid)
    - [13. 部署节点 `/admin/nodes`](#13-部署节点-adminnodes)
    - [14. 实例清理 `/admin/cleanup`](#14-实例清理-admincleanup)
    - [15. 配额管理 `/admin/quotas`](#15-配额管理-adminquotas)
  - [D. 配置与 Pack 组](#d-配置与-pack-组)
    - [16. 底座配置 `/admin/system-config`](#16-底座配置-adminsystem-config)
    - [17. 面板设置 `/admin/settings`](#17-面板设置-adminsettings)
    - [18. Pack 管理 `/admin/packs`](#18-pack-管理-adminpacks)
    - [19. SSL 证书 `/admin/ssl`](#19-ssl-证书-adminssl)
    - [20. 隧道管理 `/admin/tunnel`](#20-隧道管理-admintunnel)
  - [E. 个人中心与消息组](#e-个人中心与消息组)
    - [21. 站内消息 `/admin/notifications`](#21-站内消息-adminnotifications)
    - [22. 个人设置 `/admin/profile`](#22-个人设置-adminprofile)
    - [23. 实名认证 `/admin/profile/verify`](#23-实名认证-adminprofileverify)
    - [24. 告警配置 `/admin/profile/alerts`](#24-告警配置-adminprofilealerts)
    - [25. 个人中心 `/admin/center`](#25-个人中心-admincenter)
    - [26. 交易记录 `/admin/center/transactions`](#26-交易记录-admincentertransactions)
    - [27. 消费统计 `/admin/center/stats`](#27-消费统计-admincenterstats)
- [四、跨页面横向对比](#四跨页面横向对比)
- [五、关键发现与风险点](#五关键发现与风险点)
- [六、调研方法说明与局限](#六调研方法说明与局限)

---

## 一、总体概览

### 1.1 访问与版本信息

| 项 | 值 |
|---|---|
| 入口地址 | `https://gsp.ecsrz.com:3001/admin/` |
| 线上版本 | v4.29.7 |
| 页面标题基线 | `XXX - GameServer Panel` |
| 登录状态 | 当前会话已登录（系统管理员 admin） |
| 部署架构 | nginx 3001 (HTTPS) → 反代 127.0.0.1:3002 (Panel) |

### 1.2 页面清单与分组

`/admin/` 基座下共 27 个活跃页面，按侧边栏 9 大分组归类：

| 侧边栏分组 | 页面 |
|---|---|
| 全平台总览 | 平台大盘、全平台总览 |
| 用户与权限 | 权限管理、API Keys |
| 系统监控 | 系统监控、部署节点 |
| 配置管理 | 底座配置、面板设置、Pack 管理、SSL 证书、隧道管理 |
| 审计与日志 | 审计日志、Webhooks |
| 运维清理 | 实例清理、运维清理 |
| 业务运营 | 玩家绑定、提现审批 |
| 运营与配额 | 配额管理 |
| 个人 | 个人中心、个人设置（含实名认证、告警配置、交易记录、消费统计子页） |

另有 14 个已废弃的旧 `/admin/*` 路由（vip-permissions、item-sync、shop-items、cdk-codes、chat-settings 等）已重定向到 `/instances?uiTab=xxx` 并显示一次性 Toast 引导；3 个商业化路由（instance-vip、operations、commercial）重定向到 `/store` 基座。

### 1.3 角色门控体系

`/admin` 基座采用双层角色门控：

- **外层**：`RequireRole allow={['server_admin', 'system_admin', 'admin']}` —— 整个 `/admin` 基座入口
- **内层**：部分页面（users、system-config、settings、system-health、packs、player-bindings、withdraws、audit-logs、webhooks、notifications、cleanup、maintenance、quotas、platform、ssl、tunnel、api-keys、profile、center）再包一层相同守卫
- **例外**：`/admin/nodes` 在 v4.28.0 迁出 `/admin` 基座，独立挂载，门控放宽至 `instance_admin+`（允许实例管理员访问部署节点）

页面内角色检查存在两种风格：
- 显式 `Navigate to="/forbidden"`：SystemHealth、AuditLogs、Users、PlayerBindings、ApiKeys、Webhooks、SystemConfig、Settings、Packs、SslManagement、TunnelManagement、Nodes
- 仅依赖路由守卫，无页面内检查：AdminDashboard、PlatformDashboard、Maintenance、CleanupPage、Quotas

---

## 二、共享外壳架构（AdminLayout + Layout）

所有 `/admin/*` 页面均通过 [AdminLayout](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/layouts/AdminLayout.tsx) 挂载，后者是 `Layout variant="admin"` 的薄封装，提供统一 chrome。

### 2.1 侧边栏

- **品牌**：`variant="admin"` 时显示「Platform Dashboard」
- **分组渲染规则**：
  - `server_admin`（`isAdminRole`）→ 渲染完整 `ADMIN_GROUPS`（9 组，见上表）
  - `instance_admin`（非 server_admin）→ 仅渲染 `INSTANCE_ADMIN_LINKS`（我的实例/商城管理/VIP管理/运营仪表盘/部署节点），不暴露越权入口
- **折叠能力**：分组标题可点击折叠（`collapsedGroups` Set）；整个侧边栏可折叠，状态持久化到 `localStorage(sidebarCollapsed)`，跨标签 `storage` 事件同步
- **激活态**：用显式映射表 `PATH_ACTIVE_MAP`（非 startsWith），支持动态路由 `:id`

### 2.2 顶部与面包屑

- 面包屑由 `getBreadcrumbs(pathname, 'admin')` 计算，首页 label「平台大盘」→ `/admin`，第二段通过 `adminLabelMap` 映射中文
- 移动端（<768px）顶部显示汉堡按钮触发侧边栏抽屉

### 2.3 移动端底部 nav（admin variant）

4 项固定 tab：

| Tab | 路径 | 图标 | 备注 |
|---|---|---|---|
| 大盘 | `/admin` | Home | — |
| 用户 | `/admin/users` | Users | — |
| 消息 | `/admin/notifications` | Bell | 含未读数 badge |
| 我的 | `/admin/center` | Settings | — |

### 2.4 共享 chrome 组件

- **命令面板**：`Ctrl/Cmd+K` 触发 `CommandPalette`
- **快捷键帮助**：`?` 触发 `ShortcutsHelp`
- **帮助中心** `HelpModal`
- **版本信息** `VersionInfoModal`（检查更新/回退）
- **角色切换** `RoleSwitcherModal`（多角色用户一键免切）
- **节点状态** `NodeStatusWidget` 悬浮组件
- **通知未读数**：`notificationStore` WebSocket 实时推送，断线降级 30s 轮询 `api.listNotifications()`

### 2.5 用户菜单

侧边栏左下角显示用户名 + 角色中文（如 `server_admin → 服务器管理员`），下拉项：
- 用户管理（仅 server_admin）
- 角色切换（showQuickSwitch 一键免切 / canOpenRoleSwitcher 弹窗）
- 退出登录

---

## 三、页面详细分析

### A. 仪表盘与监控组

#### 1. 平台大盘 `/admin`

**文件**：[AdminDashboard.tsx](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/admin/AdminDashboard.tsx)

**用途**：系统管理员视角的全局视图与资源调度大盘，`/admin` 基座首页，聚合 KPI、实例分布、磁盘用量与快捷入口。

**布局结构**：
- 标题区：左 `h2`「平台大盘」+ 副标题「系统管理员视角的全局视图与资源调度」；右「刷新」按钮
- 资产模板失败提示条（条件渲染，amber 边框）
- KPI 卡片网格：`grid gap-4 sm:grid-cols-2 lg:grid-cols-4`，8 张卡片
- 实例状态分布 + 资源用量：`grid gap-4 lg:grid-cols-2` 两栏
- 系统管理快捷入口：`grid sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5`，10 个按钮
- 无 Tab、无折叠分区

**主要模块**：
- **KpiCard ×8**：总用户数、实例总数、节点数、资产模板数、今日收入、30 天收入、24h 告警数、磁盘使用率
- **StatusBar**：实例状态分布横条图，5 段（运行中/已停止/启动中/停止中/错误）
- **DiskUsageBar**：磁盘用量进度条（>85% rose、>60% amber、其他 emerald）
- **节点健康度**：`{healthy_nodes} / {total_nodes} 节点健康`
- **QuickEntry ×10**：权限管理、部署节点、配额管理、资产模板、审计日志、全平台总览、SSL 证书、隧道管理、API Keys、Pack 管理

**操作入口**：
- 「刷新」按钮（`btn-ghost`，`disabled={loading}`，`RefreshCw` 旋转动画）
- 资产模板失败提示条「重试」按钮
- KPI 卡片点击穿透（`role="button"` + `tabIndex={0}`，键盘 Enter/Space 可触发）：总用户数→`/admin/users`、实例总数→`/instances`、节点数→`/admin/nodes`、资产模板数→`/store/commercial`、24h 告警数→`/admin/platform`、磁盘使用率→`/admin/platform`
- 「查看详情 →」链接 ×2（实例状态分布、资源用量）→`/admin/platform`
- 10 个快捷入口按钮

**数据展示**：统计卡片（label + 2xl 数值 + hint + 10×10 彩色图标徽章，6 种 accent）；横条图（`h-3` 圆角分段，5 色）；进度条（`h-2.5` 圆角，颜色随阈值）

**筛选/搜索/分页**：无

**角色**：页面内无显式 role 检查，依赖路由守卫

**API**：`api.getPlatformOverview()` + `api.listGlobalAssets()`，`Promise.allSettled` 并行，资产模板失败非阻断

**移动端**：KPI 网格 `sm:grid-cols-2 lg:grid-cols-4`、快捷入口 `sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5` 响应式；依赖外壳

**空状态/错误**：加载态 `<ListSkeleton rows={4} />`；错误态 `<EmptyState title="加载失败" />` + 重试；资产模板失败 amber 提示条；实例为空 `<EmptyState title="暂无实例" />`

---

#### 2. 全平台总览 `/admin/platform`

**文件**：[PlatformDashboard.tsx](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/admin/PlatformDashboard.tsx)

**用途**：平台级统计总览，AdminDashboard 的详细数据版，覆盖用户/实例/节点/收入/磁盘/告警六大维度。

**布局结构**：
- page-header：标题「全平台总览」+ 副标题 + 刷新按钮
- error-banner（条件）
- KPI 卡片网格：`grid auto-fit minmax(180px, 1fr)`，6 张
- 用户分析卡片（info-card）：3 行 stats-grid chips
- 告警条 + 实例状态分布：`grid auto-fit minmax(320px, 1fr)`
- 用户活跃度曲线卡片：标题 + 24h/30d 切换 + LineChart
- 收入趋势曲线卡片：LineChart
- 磁盘用量 Top 10 表格：data-table
- 无 Tab，纵向堆叠

**主要模块**：
- **KpiCard ×6**：总用户数、24h 活跃用户、实例数（运行/总）、节点数（健康/总）、今日收入、30 天收入
- **用户分析**（v4.25.0 从 `/admin/users` 迁入）：状态分组（总/活跃/禁用/已删除）、角色分组（系统/实例/普通管理员）、时间窗口（近 7/30 天注册、近 7/30 天活跃、系统内置）
- **告警条**：`alerts_24h > 0` 时显示「近 24h 告警：N 条」
- **StatusBar**：实例状态分布（running/stopped/error 3 段）
- **LineChart ×2**：用户活跃度曲线（绿色 `#16a34a`）+ 收入趋势曲线（蓝色 `#2563eb`），SVG 折线 + 渐变填充
- **磁盘用量 Top 10 表格**：4 列（实例 ID / 名称 / 归属者 / 用量 MB）

**操作入口**：「刷新」按钮；error-banner「重试」；KPI 卡片点击穿透（总用户数/24h 活跃→`/admin/users`、实例数→`/instances`、节点数→`/admin/nodes`）；用户活跃度切换「24 小时」/「30 天」；各模块独立「重试」按钮（4 处）

**数据展示**：KPI 卡片（数值 + tone + `ArrowUpRight` 穿透图标）；stats-chip 标签；SVG 折线图（viewBox 600×160，渐变填充 area，数据点 circle，x 轴每 6 个显示日期）；横条图（3 段）；数据表格（mono 字体）

**筛选/搜索/分页**：用户活跃度时间窗口切换；磁盘 Top 固定 10 条；收入固定 30 天；无分页搜索

**角色**：文件头注释「仅 server_admin 可见」；页面内无显式检查

**API**：5 接口 `Promise.allSettled` 并行各自独立降级 —— `getPlatformOverview` / `getPlatformUsersTrend(userRange)` / `getPlatformRevenueTrend(30)` / `getDiskUsageTop(10)` / `getUserStats()`

**移动端**：所有 grid 用 `auto-fit minmax` 响应式；依赖外壳

**空状态/错误**：加载态 `<ListSkeleton />`；5 个独立 `*Error` 状态位，每区块单独「加载失败」+ 重试；空数据 `<EmptyState title="暂无实例" />` 等

---

#### 3. 系统监控 `/admin/system-health`

**文件**：[SystemHealth.tsx](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/admin/SystemHealth.tsx)

**用途**：系统健康状态仪表盘，4 Tab 结构：实时指标 / 实时监控曲线 / 一键诊断 / 磁盘概览。

**布局结构**：
- page-header：标题「系统监控」+ page-actions（仅 metrics tab 显示刷新按钮）
- business-sub-tabs：4 个 tab 按钮（`role="tablist"`）
- Tab 内容区：
  - Tab 1 metrics：3 张 MetricCard 网格 + 服务状态表格 + 实例概览 info-card
  - Tab 2 realtime：RealtimeMonitorPanel（连接状态卡片 + 3 条 Sparkline + 进程指标 info-card）
  - Tab 3 diagnostics：`<Diagnostics embedded />`
  - Tab 4 disk：节点磁盘总览（grid 卡片）

**主要模块**：
- **MetricCard ×3**：CPU 使用率（含负载 1/5/15 分钟）、内存使用率（含总量）、磁盘使用率（含总量）
- **服务状态表格**：服务 / 状态 / 延迟 / 备注，`ServiceStatusBadge` 三态（正常 CheckCircle2 / 降级 AlertTriangle / 异常 XCircle）
- **实例概览**：在线实例 / 总实例数 / 系统运行时长（`formatUptime`）
- **RealtimeMonitorPanel**：WebSocket 连接状态徽章 + 采样信息「采样间隔 2 秒 · 历史保留 1 小时（N/1800 条）」+ Sparkline ×3（CPU 蓝/内存 绿/磁盘 橙）+ Panel 进程指标（RSS/CPU/WS 连接数/最后更新）
- **节点磁盘总览**：每节点卡片（节点 ID + 百分比 + 进度条 + 已用/总量 + 挂载点/文件系统 + >80% 警告 alert）

**操作入口**：「刷新」按钮（仅 metrics tab，文案「刷新中…」）；4 个 Tab 切换按钮；节点磁盘 >80% 时 `alert alert-error`

**数据展示**：进度条（颜色 green/yellow/red/unknown，阈值 70/90）；数据表格；SVG Sparkline 折线图（viewBox 600×80，含 Y 轴刻度/网格线/渐变填充）；节点磁盘卡片网格（`auto-fit minmax(280px, 1fr)`）

**筛选/搜索/分页**：Tab 切换同步 URL（`?tab=metrics|realtime|diagnostics|disk`，`replace:true`），浏览器前进/后退同步；无分页搜索

**角色**：页面内显式 `isAdminRole` 检查 → `Navigate to="/forbidden"`

**API**：`getSystemMetrics` / `getSystemHealth` / `listServers` / `listNodes` + `getNodeDiskUsage(n.id)`（并行）；`systemMonitorStore.subscribe()` WebSocket 实时监控（订阅 `PanelSystemMonitorEvent`）

**移动端**：MetricCard `auto-fit minmax(240px, 1fr)`、Sparkline `auto-fit minmax(360px, 1fr)`、节点磁盘 `auto-fit minmax(280px, 1fr)`；依赖外壳

**空状态/错误**：刷新按钮文案「刷新中…」；端点不可用降级（`isEndpointUnavailable` 判断 404/NETWORK_ERROR）→「系统监控接口暂未开放」；暂无数据/服务状态/节点磁盘各自空态；Sparkline 数据不足（<2 点）提示

---

#### 4. 审计日志 `/admin/audit-logs`

**文件**：[AuditLogs.tsx](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/admin/AuditLogs.tsx)

**用途**：审计日志管理，支持多条件过滤、关键词本地搜索、CSV 导出、详情弹窗（含 before/after 对比），千行级虚拟化表格。

**布局结构**：
- page-header：标题「审计日志」+ page-actions（导出 CSV / 刷新）
- 过滤条件表单（`form-card`）：3 行 form-row + form-actions
- 错误 alert（条件）
- 桌面端：`VirtualTable`（`desktop-only`）
- 移动端：`mobile-card-list mobile-only`（mc-item 卡片）
- 详情 Modal

**主要模块**：
- **过滤条件表单**：7 字段 + 关键词（服务器下拉 / 用户 ID / 动作 / 目标类型 / 起止时间 / 条数 / 关键词搜索）
- **VirtualTable 虚拟化表格**（9 列，`estimateRowHeight={44}` `maxHeight={640}`）：ID / 时间 / 服务器 / 用户 / 动作 / 目标类型 / 目标 ID / IP / 详情（含详情/展开按钮 + JSON）
- **移动端卡片列表**：mc-item-header（action + target_type badge）+ mc-row + mc-actions
- **详情 Modal**：完整字段 + before/after `<pre>` 对比（红底/绿底）+ 完整 JSON
- **CSV 导出**：UTF-8 BOM，文件名 `audit-logs-YYYY-MM-DD.csv`

**操作入口**：「导出 CSV」按钮（`Download` 图标）；「刷新」按钮；「查询」按钮（submit，文案「查询中…」）；表格行「详情」按钮（`Eye` 图标）；表格行「展开」/「收起」按钮；移动端卡片「详情」按钮；Modal「关闭」

**筛选/搜索/分页**：服务器下拉、用户 ID、动作、目标类型、起止时间、条数（1-1000 默认 100）、关键词本地过滤（details JSON）；**URL 同步**（`searchParams`，支持分享/书签）；行展开（`expandedIds` Set）；无分页控件（靠 `limit` 限制）

**角色**：页面内显式 `isAdminRole` 检查 → `Navigate to="/forbidden"`

**API**：`api.listServers()`（初始化加载下拉）；`api.listAuditLogs(query)`（主查询）

**移动端**：双布局 `desktop-only`（VirtualTable）/ `mobile-only`（mobile-card-list）；依赖外壳

**空状态/错误**：加载态「加载中…」/「查询中…」；空状态区分 keyword 是否存在（「没有匹配关键词的日志。」/「暂无审计日志。」）；错误 `alert-error`；导出空 `toast.info`；导出成功 `toast.success`；导出失败 `toast.error`

---

#### 5. 运维清理 `/admin/maintenance`

**文件**：[Maintenance.tsx](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/admin/Maintenance.tsx)

**用途**：运维清理聚合页，管理 audit_logs / user_notifications / item_sync_log / chat_logs 四张表的 retention 与手动清理，含定时 scheduler 状态。

**布局结构**：
- page-header：标题「运维清理」+ 副标题 + 刷新按钮 + 一键清理全部按钮
- scheduler 状态徽章（条件）
- 四张表概览表格（data-table，5 列）
- 上次清理结果详情表格（条件渲染）
- 说明区（info-block，4 条 ul 说明）

**主要模块**：
- **scheduler 状态徽章**：`scheduler_enabled ? 「定时清理已启用（每 24h 自动执行）」(CheckCircle2) : 「定时清理未启用」(AlertCircle)`
- **四张表概览表格**：表名（中文 + 英文 mono）/ 行数（>10000 加粗）/ retention（天，含编辑）/ 上次清理时间 / 操作
- **retention inline 编辑**：input number（min=1 max=365）+ 保存/取消
- **上次清理结果表格**：表名 / 删除行数
- **说明区**：retention_days / chat_logs / 定时清理 / 手动清理 4 条说明

**操作入口**：「刷新」按钮；「一键清理全部」按钮（`btn-danger`，`Trash2` 图标）；每行「清理」按钮（`useConfirm` danger 弹窗）；每行「修改 retention」按钮（仅 `RETENTION_EDITABLE` 表显示）；编辑模式「保存」/「取消」

**数据展示**：徽章（`badge-success`/`badge-warning`）；数据表格；inline 编辑输入框；说明列表

**筛选/搜索/分页**：无

**角色**：文件头注释「仅 server_admin 可见」；页面内无显式检查；破坏性操作走 `useDestructiveAction` + `useConfirm` 双重确认

**API**：`getMaintenanceOverview` / `triggerCleanup({ table_name })` / `triggerCleanup({})` / `previewCleanupAll()` / `updateRetention({ table_name, retention_days })`

**移动端**：依赖外壳；表格无显式移动端适配，无双布局

**空状态/错误**：加载态 `<ListSkeleton />`；错误态 error-banner + 重试；单表清理 `useConfirm`（danger，标题「清理 {label}」）；一键清理 `useDestructiveAction`（preview → confirm → execute，`formatPreview` 展示每表行数 + 合计 + DB 文件大小）；retention 校验 1-365 整数；Toast 反馈

---

### B. 用户与权限组

#### 6. 权限管理 `/admin/users`

**文件**：[Users.tsx](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/admin/Users.tsx)

**用途**：系统管理员对全平台用户做 CRUD + 批量操作的权限管理页。

**布局结构**：
- page-header：标题「权限管理」+ 右侧操作区（刷新 + 仅 server_admin 显示「新建用户」）
- info-card：「三级权限：权责对齐」表格 + 「角色判断逻辑」说明
- toolbar：搜索 + 清除 + 计数 + 每页条数下拉
- batch-toolbar（选中行 > 0 时显示）
- alert-error（条件）
- 主体：桌面端 `desktop-only` 表格 + 移动端 `mobile-card-list mobile-only` 卡片 + 分页器
- 4 个模态：新建用户、软删除确认、批量改角色、批量删除、批量操作结果

**主要模块**：
- 权限说明卡片（静态表格 + 角色判断逻辑）
- 用户列表表格（8 列）
- 批量操作工具栏（v4.24.0）
- 新建用户模态（email/username/password/role/display_name）
- 软删除确认模态
- 批量改角色模态
- 批量删除确认模态（最多 5 个预览）
- 批量操作结果模态（成功/失败统计 + 失败明细）

**操作入口**：「刷新」；「新建用户」（仅 `isServerAdmin`）；搜索框 + 「搜索」+ 「清除」；每页条数下拉（10/20/50/100）；全选 + 行内 checkbox；5 个批量按钮（启用/禁用/改角色/删除/取消选择）；行内「编辑」→ 行内编辑（select 角色/select 状态/input 显示名）；行内「保存」/「取消」；行内「删除」（仅 `isServerAdmin` && 非自己 && 非已删除）；各模态按钮

**数据展示**：桌面表格 8 列（checkbox / Email+内置 badge / 用户名 / 角色 badge / 状态 badge / 显示名 / 创建时间 / 操作）；移动卡片（用户名+内置/邮箱/状态/显示名/注册时间/最后登录+编辑删除）；无图表

**筛选/搜索/分页**：服务端搜索（keyword，回车或按钮触发）；服务端分页（`Pagination` + pageSize 下拉，默认 20）；搜索/翻页/改 pageSize 时清空已选；无列排序

**角色**：路由守卫 + 页面内 `isAdminRole` → `Navigate to="/forbidden"`；页面内进一步区分 `isServerAdmin` 控制新建/删除/批量按钮；`isSelectable` 排除已删除/系统内置/自己

**API**：`listUsers` / `updateUser` / `createUser` / `deleteUser` / `batchOperateUsers`（action: enable/disable/delete/set_role）

**移动端**：双布局 desktop-only 表格 + mobile-only 卡片；共享外壳底部 4 tab

**空状态/错误**：加载态 `<ListSkeleton rows={6} columns={6} />`；空状态「没有匹配的用户。」；错误 `alert-error`；模态内错误 `createError`；错误码细分（PANEL_FORBIDDEN/USER_ALREADY_EXISTS/PANEL_VALIDATION_ERROR/USER_NOT_FOUND）

---

#### 7. 玩家绑定 `/admin/player-bindings`

**文件**：[PlayerBindings.tsx](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/admin/PlayerBindings.tsx)

**用途**：管理员按服务器维度查看/解绑玩家绑定记录的运维页。

**布局结构**：
- page-header：标题「玩家绑定管理」+ 右侧「刷新」
- 服务器选择 form-row（单 select）
- alert-error（条件）
- 主体：4 种状态分支（未选服务器 / 加载中 / 空列表 / 数据表格）

**主要模块**：服务器选择下拉（默认选第一个）；绑定列表表格（7 列）；解绑操作（行内按钮触发确认对话框）

**操作入口**：「刷新」按钮（disabled 当 loading 或无 serverId）；服务器 select 切换；行内「解绑」按钮（`useConfirm` 确认框，danger，确认按钮「解绑」，执行中「解绑中…」）→ `api.deleteServerPlayerBinding`

**数据展示**：表格 7 列（ID / 游戏玩家名 / 用户名 / 游戏类型 / 状态 badge + STATUS_LABEL 中文 / 绑定时间 mono / 操作）；无图表

**筛选/搜索/分页**：仅服务器维度筛选；无搜索；无分页（一次性返回全部）；无排序

**角色**：页面内 `isAdminRole` → `Navigate to="/forbidden"`；侧边栏入口仅 server_admin 可见

**API**：`listServers()` / `listServerPlayerBindings(serverId)` / `deleteServerPlayerBinding(serverId, id)`

**移动端**：无显式响应式 class，依赖全局 CSS；无移动端卡片降级

**空状态/错误**：未选服务器详细引导文案；加载中「加载中…」；该服务器无数据详细引导文案；错误 `alert-error`；卸载用 `cancelled` flag 防 setState after unmount

---

#### 8. 提现审批 `/admin/withdraws`

**文件**：[WithdrawApprovals.tsx](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/admin/WithdrawApprovals.tsx)

**用途**：server_admin+ 审批用户中心经济系统提现申请（核销=已线下打款 / 拒绝=解冻退回余额）。

**布局结构**：
- page-header：标题「提现审批」+ 副标题描述 + 右侧「刷新」按钮（`RotateCcw` 图标）
- alert-error（条件）
- 单 info-card：表格 + 分页器

**主要模块**：提现码列表表格（8 列）；行内操作（复制/核销/拒绝）；分页器

**操作入口**：「刷新」按钮；行内「复制」按钮（`navigator.clipboard`，1.5s 内变「已复制」）；行内「核销」按钮（`btn-primary`）→ `useConfirm`（标题「核销提现码」，确认「确认核销」）→ POST `/admin/withdraw/${code}/approve`；行内「拒绝」按钮（`btn-danger`）→ `useConfirm`（danger，确认「确认拒绝」）→ POST `/admin/withdraw/${code}/reject`；分页「上一页」/「下一页」

**数据展示**：表格 8 列（提现码 code + 复制按钮 / 用户 username+email+user_id / 申请金额 ¥ / 实际到账 ¥ / 比例 % / 申请时间 / 有效期 / 操作）；无图表

**筛选/搜索/分页**：无筛选搜索排序；服务端分页 `PAGE_SIZE = 20` 固定；范围统计「共 N 条，第 X - Y 条」

**角色**：**不使用** `<Navigate to="/forbidden">`，而是直接渲染告警条「仅管理员可访问此页面」——风格与其他页面不一致

**API**：**不使用** `api` 客户端，走 `userCenterRequest` —— `GET /admin/withdraw/pending` / `POST /admin/withdraw/${code}/approve` / `POST /admin/withdraw/${code}/reject`

**移动端**：无显式响应式 class；8 列表格窄屏体验较差，无移动端卡片降级

**空状态/错误**：加载中「加载中…」；空列表「暂无待审批的提现申请」；错误 `alert-error`；行级错误 `toast.error`；成功 `toast.success`；复制失败 `toast.error`；行级防重复 `actingCode` 状态锁

---

#### 9. API Keys `/admin/api-keys`

**文件**：[ApiKeys.tsx](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/admin/ApiKeys.tsx)

**用途**：管理 API Key 旁路认证（用于 CI/CD、自动化脚本，通过 `x-api-key` header 鉴权）。

**布局结构**：
- page-header：标题（`KeyRound` 图标 + 「API Keys」）+ 副标题 + 右侧「刷新」+「创建 API Key」
- alert-error（条件）
- 「API Key 列表」分区
- 3 个模态：创建、明文一次性显示、撤销确认

**主要模块**：
- API Key 列表表格（9 列）
- 创建表单模态（name + user 选择器 + expires_at；v4.30.1 已移除 role 选择器，服务端硬编码 `instance_admin`）
- 明文一次性显示模态（`SensitiveInput` + 强警告 + 复制）
- 撤销确认模态

**操作入口**：「刷新」按钮（`RefreshCw`，并行加载 keys + users）；「创建 API Key」按钮（`Plus`）；创建模态字段（name maxLength=100 / 关联用户 select 仅 active / 过期时间 datetime-local 可选）；明文模态「我已保存」按钮（`Check` 图标）；行内「撤销」按钮（`Trash2`，红色）；撤销模态「取消」/「确认撤销」

**数据展示**：表格 9 列（名称 / Key 前缀 mono + … / 关联用户 / 角色 badge v4.30.1 后恒为「实例管理员」 / 创建时间 / 过期时间或「永不过期」 / 最后使用或「从未使用」 / 状态 badge 已撤销红/已过期橙/活跃绿 / 操作）；前端排序（已撤销排最后，活跃按创建时间倒序）

**筛选/搜索/分页**：无；仅前端排序

**角色**：页面内 `isAdminRole` → `Navigate to="/forbidden"`

**API**：`listApiKeys` / `listUsers`（并行 Promise.all）/ `createApiKey({ name, user_id, expires_at })` / `revokeApiKey(id)`

**移动端**：无显式响应式 class；9 列表格窄屏体验较差，无移动端卡片降级；模态用通用 `Modal` 自带响应式

**空状态/错误**：加载中「加载中…」；空列表「暂无 API Key——点击「创建 API Key」开始」；错误 `alert-error`；表单校验（name 必填/user_id 必选/expires_at 未来时间）；明文 Key 通过 `SensitiveInput`（copyable + revealable）

---

#### 10. Webhooks `/admin/webhooks`

**文件**：[Webhooks.tsx](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/admin/Webhooks.tsx)

**用途**：按服务器维度管理 Webhook（创建/启用停用/测试/删除）。

**布局结构**：
- page-header：标题「Webhook 管理」+ 右侧「刷新」
- 服务器选择 form-row（单 select）
- alert-error（条件）
- 创建表单 form-card（URL + 事件类型 + Secret + 启用 checkbox + 清空/创建按钮）
- 测试表单 form-card（条件渲染，点击「测试」后展开）
- Webhook 表格（4 种状态分支）

**主要模块**：服务器选择下拉；创建 Webhook 表单；测试 Webhook 表单（同页内联展开，非模态，同一时间只能测一个）；Webhook 列表表格（7 列）

**操作入口**：「刷新」按钮；服务器 select 切换；创建表单「清空」/「创建」按钮（保存中「保存中…」）；行内「测试」按钮（`disabled={testState !== null}`）；测试表单「关闭」/「发送测试」按钮；行内启用 checkbox（乐观更新 + 失败回滚）；行内「删除」按钮（`useConfirm` danger，确认「删除」）

**数据展示**：表格 7 列（ID / URL mono / 事件类型 badge 空时「全部」 / 启用 checkbox+badge / 创建时间 / 更新时间 / 操作）；无图表

**筛选/搜索/分页**：仅服务器维度筛选；无搜索分页排序（一次性返回全部，按 created_at 倒序插入新项）

**角色**：页面内 `isAdminRole` → `Navigate to="/forbidden"`

**API**：`listServers` / `listWebhooks(serverId)` / `createWebhook(serverId, req)` / `updateWebhook(serverId, id, { enabled })` / `deleteWebhook(serverId, id)` / `triggerWebhookTest(serverId, webhookId, req)`

**移动端**：无显式响应式 class；7 列表格相对友好；表单用通用样式自带响应式

**空状态/错误**：未选服务器「请先选择服务器。」；加载中「加载中…」；空列表「暂无 Webhook。」；错误 `alert-error`；表单校验（URL 必填/event_type 必填/payload 合法 JSON）；测试结果 `alert-info` 展示 delivered/status_code/error；启用 toggle 失败回滚；卸载 `cancelled` flag；行级防重复 `togglingId`/`deletingId`/`testing`

---

### C. 实例与节点组

#### 11. 实例列表 `/admin/servers`

**文件**：[Servers.tsx](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/Servers.tsx)（在 `/admin/servers` 路由下复用，三角色差异化视图）

**用途**：展示当前用户可见的实例列表，支持搜索/筛选/排序/分页/批量操作/CSV 导出。

**布局结构**：
- page-header：标题「服务器列表」+ 操作区（刷新 + 创建服务器）
- alert-error（条件）
- toolbar：搜索框 + 状态筛选 select + 计数 + 导出 CSV
- 配额进度条 quota-bar（仅 `!isServerAdmin && quota` 时显示）
- 批量操作栏 batch-bar（选中 1+ 项且 `!isUser` 时显示）
- 桌面端表格 `desktop-only`
- 移动端卡片列表 `mobile-only server-card-list`
- 分页 Pagination
- 删除确认 ConfirmDialog + 撤销 Toast

**主要模块**：
- 工具栏（搜索 + 状态筛选 + 计数 + CSV 导出）
- 配额进度条（instance_admin / user）：实例配额 + 磁盘配额，`can_create_instance === false` 时显示「配额已满」徽章 + 进度条变红
- 批量操作栏（6 个批量按钮）
- 桌面表格（10 列）
- 移动卡片
- 删除确认（需输入实例名）

**操作入口**：「刷新」；「+ 创建服务器」；「导出 CSV」；表头排序按钮（名称/状态/创建时间 3 字段，点击切换升降序，`↕`/`↑`/`↓`）；全选 checkbox（含半选态）；行 checkbox；名称 Link（`to={/instances/${s.id}}`）；行操作按钮（详情/启动 `btn-success`/停止 `btn-warning`/删除 `btn-danger`）；6 个批量按钮（启动/停止/重启/备份/删除/取消选择）

**数据展示**：桌面表格 10 列（checkbox / 名称 Link / 游戏 / 状态 badge / 游戏端口 / RCON 端口 / 归属者 `!isUser` / 磁盘占用 mono `>10GB` 加粗 / 创建时间 / 操作）；移动卡片；配额进度条 200px×8px

**筛选/搜索/分页**：搜索 `q`（前端过滤 name/id，重置页码）；状态筛选 4 选项；排序 3 字段 × 2 方向（默认 `created_at desc`）；分页 `PAGE_SIZE = 20` 前端切片；**URL 状态化**（q/status/sort/order/page 全同步 searchParams，replace 模式）；`/` 快捷键聚焦搜索框

**角色**：路由层 `server_admin+`；页面内三角色差异化 —— `isUser` 隐藏复选框/归属/批量操作；`isServerAdmin` 不加载配额；`isInstanceAdminOrHigher` 显示完整功能 + 配额进度条

**API**：`useServers()`（TanStack Query）；`useStartServer`/`useStopServer`/`useDeleteServer`（mutation 乐观更新）；`batchStart`/`batchStop`/`batchRestart`/`batchBackup`；`getMyQuota()`（仅 `!isServerAdmin`）

**移动端**：双布局 desktop-only / mobile-only server-card-list；移动端操作按钮常驻可见

**空状态/错误**：加载中 `<ListSkeleton rows={6} columns={4} />`；空列表 `<EmptyState title="还没有服务器" />`；筛选无结果 `<EmptyState title="没有匹配的结果" />`；错误 `alert-error`；删除二次确认（需输入名称）；删除成功撤销 Toast（`useUndoToast`，"已删除实例「{name}」"，撤销回调检查是否仍存在）；批量结果汇总（全成功 `toast.success` / 部分失败 `toast.error` 含明细）；`INVALID_SERVER_STATE` 错误码映射

---

#### 12. 实例详情 `/admin/servers/:id`

**文件**：[ServerDetailAdmin.tsx](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/admin/ServerDetailAdmin.tsx)（薄封装）+ [ServerDetail.tsx](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/ServerDetail.tsx)（实际实现）

**用途**：系统管理员查看单个实例的运行时控制台、配置、运维与业务运营入口的统一详情页。

**布局结构**：
- page-header：左「← 返回列表」+ 实例名标题；右操作按钮组
- 异常状态横幅 instance-error-banner（仅 error 状态）
- 可折叠信息卡 info-card-collapsible：默认折叠为一行摘要（状态徽章 + 游戏 + 版本 + 端口 + 磁盘），展开后 9 行 2 列
- Tab 警告条 tab-warning-bar（基于 tab + 实例状态动态）
- Tab 分组导航 tab-groups（桌面 4 组：运行时/配置/运维/业务运营）或 mobile-tab-scroller（移动横向滚动）
- Tab 内容区（TabPanel keep-alive，`display:none` 隐藏而非卸载）
- 删除确认 ConfirmDialog + 启动引导 StartupGuideWizard 模态

**主要模块**：
- 信息卡摘要行 + 展开详情（9 行：状态/游戏/Pack/游戏版本/游戏端口/RCON 端口/节点/归属者/创建时间/磁盘占用 + 子目录清理 5 按钮）
- RCON 控制台 Tab（`RconConsole` 单一 WS 连接）
- Pack 动态 Tab（`api.listPacks()` 获取 `ui_tabs`，与底座 BASE_USER_TAB_OBJECTS 合并去重，按 group+order 排序）
- 业务运营 pseudo-tab（仅 `isAdminRole` 可见，点击 navigate 到 `/instances/:id/business`）
- 启动引导向导（Pack 声明 `startup_guide` 且未完成时拦截启动）

**操作入口**：「← 返回列表」；「启动」按钮（`btn-success`，仅 canStart）；「停止」按钮（`btn-warning`）；「刷新」图标按钮；「业务运营」按钮（仅 `isAdminRole`）；「删除」按钮（`btn-danger`，需输入实例名确认）；「重置状态」按钮（仅 error + admin，强制回退 error→stopped）；磁盘「刷新」按钮；子目录清理 5 按钮（备份/存档/Mod/日志/缓存，运行中禁用）；Tab 按钮；移动端左右滑动切换 Tab（`useSwipe`）

**数据展示**：状态徽章（`stopped→已停止`/`starting→启动中`/`running→运行中`/`stopping→停止中`/`error→错误`）；信息卡 info-row（mono 字体）；磁盘占用 `>10GB` 加粗警示；Tab 分组标签；TAB_LABELS 映射 16 个 tab

**筛选/搜索/分页**：Tab 状态同步 URL `?tab=`（replace）；Tab 按 `require_state` 过滤（world-gen/update/saves/mods 仅 stopped/error 可用）；当前 activeTab 被移除时回落到 console

**角色**：路由层 `server_admin+`；页面内 admins tab 仅 `isAdminRole`；roles tab 仅 `isInstanceAdminOrAbove`；业务运营 pseudo-tab + 「业务运营」按钮 + 「重置状态」按钮仅 `isAdminRole`

**API**：`getServer(serverId)` / `listPacks()` / `getStartupGuide(server.id)` / `startServer` / `stopServer` / `resetServerState`（admin）/ `getServerDiskUsage` / `cleanupSubdir(server.id, subdir)` / `deleteServer`；RconConsole 内部 WS `/ws`

**移动端**：`useMediaQuery('(max-width: 768px)')` 切换 Tab 导航（桌面 tab-groups / 移动 mobile-tab-scroller）；`useSwipe` 左右滑动切换；信息卡默认折叠（移动端首屏直接看 Tab），桌面端记忆 localStorage

**空状态/错误**：加载中 Skeleton；加载失败/不存在 ErrorState + 「返回列表」；操作错误 ErrorState 内联 + `toast.error`；删除二次确认（需输入实例名）；`cancelledRef` 守卫切换实例/卸载时丢弃未完成请求；WS 重连成功自动 `refresh()`

---

#### 13. 部署节点 `/admin/nodes`

**文件**：[Nodes.tsx](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/admin/Nodes.tsx)

**用途**：管理部署节点（master/slave），查看节点状态、扫描 Java 环境、生成 slave 节点邀请密钥与部署引导、删除从节点。v4.28.0 起对 `instance_admin+` 开放。

**布局结构**：
- page-header：标题「部署节点」+ 操作区（刷新 + 添加节点）
- alert-info（`NODE_DEPLOYMENT_ENABLED=false` 时显示「节点部署暂未启用」）
- alert-error（条件）
- 节点表格 data-table（空态 EmptyState）
- 展开行：JavaInstallationsPanel
- 添加节点 Modal（`size="lg"`，三 Tab 部署引导）

**主要模块**：
- 节点列表表格（7 列）
- NodeStatusBadge（4 状态：online/offline/pending/degraded）
- NodeTypeBadge（master 主节点 badge-info / slave 从节点 badge-default）
- JavaInstallationsPanel（展开行内嵌 Java 扫描结果面板）
- 添加节点 Modal（表单 → 结果视图 3 Tab）
- 部署引导 3 Tab（复制命令 / 下载脚本 / 手动步骤 7 步）

**操作入口**：「刷新」按钮（loading 时「刷新中…」）；「添加节点」按钮（`Plus`）；行展开/折叠按钮；「Java」按钮（`Coffee` 图标，扫描 Java，loading 时「扫描中…」）；「重新邀请」按钮（仅 slave+pending，title="重新生成邀请密钥（原密钥将立即失效）"）；「删除」按钮（仅 slave，`Trash2` 红色，loading 时「删除中…」）；Modal 内复制按钮（link_key / slave_command）；Modal 内「下载 slave-bootstrap.sh」按钮；Modal 内「取消」/「创建邀请」/「完成」

**数据展示**：表格 7 列（展开按钮 / 类型徽章 / 名称 / 状态徽章 / Daemon 地址 mono wordBreak / 注册时间·邀请过期 pending 显示 `⏰`+过期时间否则 linked_at / 操作）；部署引导 Tab 1（link_key 只读 input + slave_command 只读 textarea mono）；Tab 2（代码块 chmod +x / sudo bash）；Tab 3（7 步有序列表每步 `<pre>` 代码块）

**筛选/搜索/分页**：无；WS 事件驱动自动刷新（`nodeStatusStore.subscribe`，节点上线/离线时自动 `refreshNodes`）

**角色**：路由层 `/admin/nodes` 独立路由组 `RequireRole allow={['instance_admin', 'server_admin', 'system_admin', 'admin']}`（v4.28.0 从 `/admin` 基座迁出）；页面内 `isInstanceAdminOrAbove` → `Navigate to="/forbidden"`；主节点不可删除

**API**：`listNodes` / `scanNodeJavas(nodeId)` / `createNodeInvite({ name, display_fqdn? })`（`NODE_DEPLOYMENT_ENABLED=false` 时用 `DEPLOYMENT_PREVIEW_RESULT` 占位）/ `downloadNodeBootstrapScript(linkKey)` / `regenerateInvite(node.id)` / `deleteNode(nodeId)`；`nodeStatusStore` 订阅 WS `node.status` 事件

**移动端**：表格 table-wrap 横向滚动；Modal `size="lg"` 适配长代码；外层 AdminLayout 提供 instance_admin 进入时只渲染 INSTANCE_ADMIN_LINKS（含「部署节点」入口）

**空状态/错误**：空列表 `<EmptyState title="暂无部署节点" />`；Java 扫描错误展开行内 `alert-error`（404/网络错误「Java 扫描接口暂未开放」）；列表加载失败 `alert-error` + `toast.error`；删除/重新邀请 `useConfirm`（danger）；复制失败 `toast.error`；`deletingIds` Set 防重复

**注意**：当前线上 `NODE_DEPLOYMENT_ENABLED = false`（v4.28.0 未开源），「添加节点」可查看部署引导预览但不实际创建邀请

---

#### 14. 实例清理 `/admin/cleanup`

**文件**：[CleanupPage.tsx](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/CleanupPage.tsx)

**用途**：系统管理员查看标记为待清理的实例与全部实例概览，对待清理实例执行确认删除（含 dry-run 预览）或忽略。

**布局结构**：
- page-header：标题「实例清理」+ 操作区（刷新）
- alert-error（条件）
- 待清理实例卡片 info-card（标题 + 数量徽章 + 表格/空态）
- 全部实例概览卡片 info-card（标题 + 表格/空态）
- 删除走 `useDestructiveAction` 弹窗（preview → confirm → execute）

**主要模块**：
- 待清理实例表格（8 列）
- 全部实例概览表格（6 列）
- 破坏性操作 hook `useDestructiveAction`（统一 preview → confirm → execute）
- 待清理计数徽章（`badge badge-error`）

**操作入口**：「刷新」按钮；「确认删除」按钮（`btn-danger btn-sm`，仅 stopped 状态可用）；「忽略」按钮（`btn-ghost btn-sm`）；删除确认弹窗（`requireText: true` + `requireTextMatch: id`，需输入实例 ID 匹配，`confirmText: '确认删除'`）

**数据展示**：待清理表格 8 列（实例名 / Pack / 游戏 / 当前版本 mono / 归属者 / 闲置天数 / 更新版本数 / 操作）；全部实例表格 6 列（实例名 / 状态 badge / 归属者 / 闲置天数 / 更新版本数 / 标记 badge-error 待清理/badge-stopped 正常）；删除预览 `formatPreview`（实例根目录 / 目录大小 MB / 文件数 / 预览失败提示）

**筛选/搜索/分页**：无（前端按 `marked_for_deletion` 字段分组为两个表格）

**角色**：路由层 `server_admin+`（双层门控）；文件头注释「仅 server_admin 可见」

**API**：`listCleanupInstances` / `previewCleanupInstance(id)` / `confirmCleanupDelete(id)` / `ignoreCleanup(id)`

**移动端**：表格 table-wrap 横向滚动；卡片垂直堆叠；**无移动端专用布局**（与 Servers.tsx 双套布局相比未做 mobile-only 适配，移动端体验较弱）

**空状态/错误**：待清理空态「暂无待清理实例」；全部实例空态「暂无实例」；加载中「加载中…」（两卡片独立 loading）；错误 `alert-error`；删除成功 `toast.success` + refresh；忽略成功 `toast.success` + refresh；删除按钮 disabled 当 `actioning === inst.id`；删除预览失败不阻断（提示"仍可继续删除，但磁盘清理可能不会执行"）；删除需输入实例 ID 文本匹配确认

---

#### 15. 配额管理 `/admin/quotas`

**文件**：[Quotas.tsx](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/admin/Quotas.tsx)

**用途**：系统管理员管理角色默认磁盘配额与用户个性化磁盘配额。v4.29.13 起 `max_instances` / `max_players_total` 已禁用，仅保留 `max_disk_mb`。

**布局结构**：
- page-header：标题「配额管理」+ 副标题 + 右侧「刷新」
- 角色配额区域：h3「角色配额」+ 3 列网格
- 用户配额区域：h3「用户配额」+ 工具栏（搜索 + 计数）+ 表格 + 分页
- 编辑 Modal

**主要模块**：
- 角色配额卡片（3 个：服务器管理员/实例管理员/普通用户，每卡含「编辑」按钮 + 磁盘配额行；`max_instances`/`max_players_total` 行已注释禁用）
- 用户配额表格（4 列）
- 编辑 Modal（`最大磁盘 (MB)` 数字输入框；`最大实例数`/`最大玩家总数` 已注释禁用）
- 错误横幅 error-banner（带 AlertCircle + 重试）

**操作入口**：「刷新」按钮（同时刷新角色配额 + 用户列表）；角色「编辑」按钮；用户「编辑配额」按钮；Modal「取消」/「保存」按钮（保存中「保存中…」）；错误横幅「重试」按钮

**数据展示**：角色配额卡片 info-row（`formatQuotaValue`：`null→不限` / `${value} MB`）；用户表格 4 列（用户名 cell-name / 邮箱 mono 12px / 角色 badge / 操作）；Modal form-hint「留空表示不限（NULL）。输入 0 表示禁止。」+ 数字输入框（min=0，placeholder="留空 = 不限"）；搜索框 `Search` 图标

**筛选/搜索/分页**：用户搜索（前端 useMemo 过滤 username/id/email，重置页码）；用户分页 `USER_PAGE_SIZE = 20` 前端切片 + `Pagination`（`safeUserPage` 防越界）；计数「共 {filteredUsers.length} 条」

**角色**：路由层 `server_admin+`（双层门控）；文件头注释「仅 server_admin 可见」

**API**：`getRoleQuota('server_admin'|'instance_admin'|'user')`（Promise.all 并行）/ `listUsers` / `getUserQuota(user.id)`（打开 Modal 时异步加载，失败静默）/ `updateRoleQuota` / `updateUserQuota`（保存请求体 `{ max_instances: null, max_disk_mb, max_players_total: null }`，v4.29.13 禁用项固定传 null 保持后端契约兼容）

**移动端**：角色配额网格 `repeat(auto-fit, minmax(240px, 1fr))`；搜索框 `maxWidth:400` + `flex:1`；分页居中

**空状态/错误**：角色配额加载 `<ListSkeleton rows={1} columns={3} />`；用户列表加载 `<ListSkeleton rows={6} columns={4} />`；角色/用户错误 error-banner + 重试；用户空态 EmptyState（`users.length === 0 ? '暂无用户' : '没有匹配的用户'`）；保存失败 `toast.error`；输入校验 `parseNum` 无效时 `toast.error('请输入有效的非负整数，或留空表示不限')`；Modal `disableClose={saving}` 防保存中关闭

---

### D. 配置与 Pack 组

#### 16. 底座配置 `/admin/system-config`

**文件**：[SystemConfig.tsx](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/admin/SystemConfig.tsx)

**用途**：管理面板的全局 KV 配置项（key-value 形式），支持行内编辑、新建、删除、恢复默认值与变更预览。

**布局结构**：
- page-header：标题「系统配置」+ 操作区（刷新 / + 新建配置）
- info-card：引导说明 + 预定义 Key 参考表
- alert-error（条件）
- form-card：新建配置表单（toggle 展开/收起）
- tabs：配置分类 Tab（带计数）
- table-wrap：配置列表 data-table
- Modal：配置变更预览弹窗

**主要模块**：
- 预定义 Key 参考表（7 项：shop.currency_name/shop.enabled/chat.enabled/vote.enabled/welcome.gift_item/backup.max_count/monitor.retention_days）
- 配置分类 Tab（6 个：全部/基础设置 site.*/welcome.*/general.* / 安全设置 security.*/auth.* / 邮件设置 mail.*/email.*/smtp.* / 存储设置 backup.*/monitor.*/storage.* / 功能开关 shop.*/chat.*/vote.*/*.enabled）
- 配置表格（行内编辑模式，敏感 key 用 SensitiveInput 隐藏）
- 受保护 key 集合（withdraw.ratio/consumption.daily_max/recharge.max 禁止删除，删除按钮 disabled + tooltip）
- 配置变更预览 Modal（字段级 diff，ConfigDiff 组件）

**操作入口**：「刷新」；「+ 新建配置 / 收起新建」（toggle）；表格行非编辑态「编辑」/「恢复默认」（仅预定义 key 且当前值非默认值，带 RotateCcw + title 提示默认值）/「删除」（受保护 key 禁用）；表格行编辑态「预览变更」/「取消」；新建表单「取消」/「创建 / 创建中…」；变更预览 Modal「取消」/「确认保存 / 保存中…」（无变更时禁用）

**数据展示**：预定义 Key 表 4 列（Key mono / 说明 / 取值范围 / 默认值 mono）；配置列表表 5 列（Key cell-key / Value 敏感值 SensitiveInput 普通值 mono / 描述空显示 — / 更新时间 / 操作）

**筛选/搜索/分页**：6 个分类 Tab（带计数）；无搜索排序分页（一次性加载全部）

**角色**：页面顶部硬守卫 `isAdminRole` → `Navigate to="/forbidden"`

**API**：`listSystemConfigs` / `setSystemConfig(key, { value, description })` / `deleteSystemConfig(key)`

**移动端**：无页面级响应式 class，依赖外壳；表格 table-wrap 横向滚动；按钮 btn-sm 紧凑

**空状态/错误**：加载中「加载中…」；空状态「暂无系统配置。」/「该分类下暂无配置项。」；错误 `alert-error` + Toast；删除二次确认 `useConfirm`（danger）

---

#### 17. 面板设置 `/admin/settings`

**文件**：[Settings.tsx](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/admin/Settings.tsx)

**用途**：v3.8.0 结构化设置面板，按分组表单式管理站点、注册、游戏、VIP、备份、邮件、维护、磁盘、法律等配置，替代纯 KV 编辑器。

**布局结构**：
- page-header：标题「面板设置」（SettingsIcon）+ 描述 + 刷新按钮
- alert-error（条件）
- 主内容：flex column gap:16 的分组卡片栈（settings-group）
- 末尾：PlatformEconomySection（平台经济配置独立卡片）

**主要模块**：
- 分组卡片（10 组，按 GROUP_ORDER 顺序）：site 站点信息 / registration 注册管理 / games 游戏配置 / vip VIP 体系 / admin 管理员配置 / backup 备份策略 / mail 邮件配置 / maintenance 维护模式 / disk 磁盘监控 / legal 法律条款
- 手风琴折叠（`expandedGroup` 状态，同时只展开一组，默认 site）
- 单行设置项 SettingRow（label + 默认/保存按钮 + description + 控件 + key/type/默认值元信息）
- 类型化控件 SettingInput：boolean→iOS 风格 toggle switch；number→number input 含 min/max；enum→选项 ≤4 用 segmented chips、>4 用 select；json→monospace textarea；string→input，sensitive 用 SensitiveInput
- 平台经济配置区 PlatformEconomySection（3 项 KV：recharge.max/consumption.daily_max/withdraw.ratio，独立保存按钮，含正则校验）

**操作入口**：「刷新」按钮（RotateCcw）；每行设置项「默认」（重置为默认值）、「保存 / 保存中…」（isDirty 为 false 时禁用）；平台经济区「保存配置 / 保存中…」；分组 header 点击展开/折叠（`role="button"` `aria-expanded` 键盘 Enter/Space 支持）

**数据展示**：表单式（分组卡片 + 单行设置项，无表格图表统计）；每行展示 label/description/控件/元信息 `{key} · 类型: {type} · 默认: {defaultValue}`

**筛选/搜索/分页**：无（按分组聚合，手风琴折叠代替）；组内按 `item.order` 升序

**角色**：页面顶部硬守卫 `isAdminRole` → `Navigate to="/forbidden"`

**API**：`listSettingsSchema` / `updateSetting(key, value)` / `resetSetting(key)` / `getSystemConfig(key)` ×3（平台经济 Promise.all）/ `setSystemConfig(key, { value, description })` ×3

**移动端**：手风琴分组（同时只展开一组）天然适配移动端，减少滚动距离；控件宽度 100%，flexWrap 兼容窄屏

**空状态/错误**：加载中「加载中…」；空状态「暂无设置项。」；接口不可用降级（404/HTTP_404/NETWORK_ERROR）显示「设置接口暂未开放（v3.8.0+ 后端未启用）。」；错误 `alert-error` + Toast；防御性兜底 `safeGroup` 将未声明 group 归入 admin 避免 `undefined.push` 崩溃

---

#### 18. Pack 管理 `/admin/packs`

**文件**：[Packs.tsx](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/admin/Packs.tsx)

**用途**：管理游戏类型配置包（Pack），支持列表查看、YAML 在线编辑、创建、删除（含 dry-run 预览）与重载。

**布局结构**：
- page-header：标题「Pack 管理」+ 操作区（刷新 / + 新建 Pack / 重载 Pack）
- alert-info（Pack 概念 + 支持的游戏类型列表）
- alert-error / alert-success / alert-warning（错误/成功/重载失败）
- table-wrap：Pack 列表 data-table
- modal-mask ×2：编辑 Pack 弹窗、新建 Pack 弹窗
- 删除确认弹窗（`useDestructiveAction` + 全局 ConfirmDialog）

**主要模块**：
- 信息提示区（解释 Pack 是游戏类型配置包，列出支持游戏：minecraft/factorio/rust/ark/palworld/dst/enshrouded/satisfactory/terraria/valheim/zomboid/custom）
- Pack 列表表格（7 列）
- 编辑 Pack 弹窗（拉取完整 YAML，textarea 编辑 minHeight 420 monospace）
- 新建 Pack 弹窗（Pack ID input + 游戏类型 select + YAML textarea minHeight 360 含示例 placeholder）
- 重载结果区（成功数/失败数，失败列表 alert-warning + ul）

**操作入口**：「刷新」；「+ 新建 Pack」；「重载 Pack / 重载中…」（btn-warning）；表格行「编辑」/「删除」（disabled when deleteAction.loading）；编辑弹窗「取消」/「保存 / 保存中…」（空内容禁用）/「✕」；新建弹窗「取消」/「创建 / 创建中…」（ID 或内容空时禁用）/「✕」；删除确认 `useDestructiveAction`（`requireText: true` + `requireTextMatch: packId`，需输入 packId 确认）

**数据展示**：Pack 列表表 7 列（Pack ID mono / 游戏 / 变体 / 显示名称 / 版本 mono / UI Tabs mono 逗号分隔空显示 — / 操作）；YAML 编辑器 textarea.yaml-editor monospace resize vertical；删除预览 `formatPreview`（pack_dir + 依赖实例列表 name/id/status 或「✓ 无依赖实例，可安全删除」）

**筛选/搜索/分页**：无

**角色**：页面顶部硬守卫 `isAdminRole` → `Navigate to="/forbidden"`；注释「仅 admin/system_admin 可见」

**API**：`listPacks` / `reloadPacks`（返回 { loaded, failed, total }）/ `getPackYaml(id)` / `updatePackYaml(id, { content })` / `createPack({ pack_id, content })` / `previewDeletePack(id)` / `deletePack(id)`

**移动端**：无页面级响应式 class；表格 table-wrap 横向滚动；弹窗 maxWidth:800 移动端可能需横向滚动

**空状态/错误**：加载中「加载中…」；空状态「暂无已加载的 Pack。请新建 Pack 或确保 packs/ 目录下有有效的 pack.yaml 文件后点击「重载 Pack」。」；错误 `alert-error` + 成功 `alert-success` + 重载部分失败 `alert-warning`（列出失败 pack 与 error）；弹窗内错误 `editError`/`createError`；删除二次确认 `useDestructiveAction`（dry-run 预览 + 文本输入匹配 + 失败回滚）

---

#### 19. SSL 证书 `/admin/ssl`

**文件**：[SslManagement.tsx](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/admin/SslManagement.tsx)

**用途**：管理 nginx 使用的 TLS 证书——查看当前证书信息、热重载 nginx、上传新证书、生成自签证书、部署暂存证书。

**布局结构**：
- page-header：标题「SSL 证书管理」（ShieldCheck icon）+ 描述 + 刷新按钮
- alert-error（条件）
- 三大区块：
  1. 当前证书信息卡（独立 div）
  2. 证书操作区（`grid repeat(auto-fit, minmax(360px, 1fr)) gap:16`，三列卡片：热重载 nginx / 上传新证书 / 生成自签证书）
  3. 暂存证书区
- Modal：热重载确认弹窗
- 部署确认弹窗（`useDestructiveAction` + 全局 ConfirmDialog）

**主要模块**：
- 当前证书信息卡（徽章：剩余天数颜色编码 >30 绿/<30 黄/<7 红/已过期红/未知灰 + 自签名徽章；InfoRow 键值对：主题 CN / 签发者 CN / SAN 域名 / 有效期起止 / 指纹 SHA-256 / 证书路径 / 密钥路径）
- 热重载 nginx 卡（说明 + 触发按钮弹确认 Modal）
- 上传新证书卡（PEM 证书内容 fullchain + 私钥内容 KEY，均 SensitiveInput multiline rows:8，暂存按钮）
- 生成自签证书卡（CN + SAN 域名/IP + 有效天数 1-3650 + 组织名 O 可选，生成按钮）
- 暂存证书区（展示 cert_path/key_path + 来源 upload/self-signed，部署 + 丢弃按钮）

**操作入口**：「刷新 / 加载中…」；热重载卡「热重载 nginx」（btn-warning Zap，打开确认 Modal）；上传卡「暂存证书 / 暂存中…」（btn-primary Upload）；自签卡「生成自签证书 / 生成中…」（btn-primary Plus）；暂存区「部署到 nginx / 部署中…」（btn-primary Upload）/「丢弃暂存」（btn-ghost）；热重载 Modal「取消」/「确认重载 / 重载中…」（btn-warning）；部署确认 `useDestructiveAction`（dry-run 预览指纹对比 + nginx -t 校验 + 失败回滚 `rollbackSslCertificate()`）

**数据展示**：InfoRow 键值对（label minWidth 100 灰色 + value mono 时空值显示 —）；徽章（剩余天数颜色编码 + 自签名标记）；表单控件 text/number/SensitiveInput multiline；无表格图表统计

**筛选/搜索/分页**：无

**角色**：页面顶部硬守卫 `isAdminRole` → `Navigate to="/forbidden"`；路由 `/admin/ssl`（注释「I1，v4.4.0-L1」）

**API**：`getSslCertInfo` / `reloadNginx` / `stageCertificate(uploadForm)` / `generateSelfSignedCert(req)` / `previewSslDeploy({ pem_content })` / `deployStagedCertificate(req)` / `rollbackSslCertificate()`

**移动端**：证书操作区 `grid repeat(auto-fit, minmax(360px, 1fr))` 宽屏三列窄屏自动单列；InfoRow flex 布局窄屏可换行

**空状态/错误**：加载中「加载中…」；空状态「暂无证书信息」/「暂无暂存证书——上传或生成后在此展示」；证书不可读 `alert-warning`「证书文件不可读或不存在——请上传证书或生成自签证书」；错误 `alert-error` + Toast；校验 CN 必填/SAN 至少一个/PEM/KEY 非空；热重载二次确认 Modal（不可关闭 during reload）；部署二次确认 + 失败自动回滚

---

#### 20. 隧道管理 `/admin/tunnel`

**文件**：[TunnelManagement.tsx](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/admin/TunnelManagement.tsx)

**用途**：管理 FRP 隧道（frpc）——查看运行状态、编辑配置（server_addr/port/token/enabled/tunnels 数组）、启停进程、查看最近日志。

**布局结构**：
- page-header：标题「隧道管理」（Network icon）+ 描述 +「刷新全部」按钮
- alert-error（条件）
- 三大区块（均 sectionStyle）：
  1. 进程状态卡（Activity icon）
  2. 配置编辑卡（Network icon）
  3. 日志查看卡（ScrollText icon）

**主要模块**：
- 进程状态卡（6 列 grid 指标：状态运行中绿/已停止灰 / PID mono / 运行时长 formatUptime / 配置启用是/否 / 服务器 mono / 隧道数；启停按钮组）
- 配置编辑卡（顶部 4 列 grid：frps 服务器地址 / frps 服务器端口 1-65535 / 认证 token SensitiveInput / 启用隧道 checkbox；隧道映射列表每项一张卡片 `grid repeat(auto-fit, minmax(140px, 1fr))` 含名称/类型 select tcp/udp/http/https/本地 IP/本地端口/远程端口仅 tcp/udp/自定义域名仅 http/https；添加隧道按钮/删除按钮；保存配置按钮）
- 日志查看卡（标题「最近日志（{logs.length} 条）」；日志列表 maxHeight:400 overflowY:auto monospace，error 级别红色；每条 timestamp 灰 + [LEVEL] 粗体 + message）

**操作入口**：「刷新全部 / 加载中…」；状态卡「启动 / 处理中…」（btn-success Play，运行中禁用）/「停止 / 处理中…」（btn-danger Square，未运行禁用）；配置卡「添加隧道」（btn-ghost Plus）/「删除」（btn-ghost btn-sm 红色 Trash2）/「保存配置 / 保存中…」（btn-primary Save）；错误重试「重试」（btn-ghost btn-sm RefreshCw，状态/配置/日志加载失败时显示）

**数据展示**：状态卡 6 列 grid 键值对；配置卡表单控件组；隧道列表卡片式（非表格）；日志区滚动列表 monospace 颜色区分级别；无表格图表统计

**筛选/搜索/分页**：无（日志固定拉取 200 条 `api.getTunnelLogs(200)`）

**角色**：页面顶部硬守卫 `isAdminRole` → `Navigate to="/forbidden"`；路由 `/admin/tunnel`（注释「I2，v4.4.0-O1」）

**API**：`getTunnelStatus` / `getTunnelConfig` / `getTunnelLogs(200)` / `startTunnel` / `stopTunnel` / `updateTunnelConfig(config)`；初始化 `Promise.allSettled([status, config, logs])` 部分失败不阻塞

**移动端**：状态卡 `grid repeat(auto-fit, minmax(160px, 1fr))`；配置卡顶部 `grid repeat(auto-fit, minmax(220px, 1fr))`；隧道卡片 `grid repeat(auto-fit, minmax(140px, 1fr))`；日志区 maxHeight:400 滚动

**空状态/错误**：加载中「加载中…」；空状态「暂无状态数据」/「暂无配置数据」/「暂无隧道映射，点击「添加隧道」开始」/「暂无日志」；错误分区独立（statusError/configError/logsError 三独立状态，每区「加载失败：{msg}」+ 重试按钮，部分失败 toast「部分数据加载失败」仅当全部失败时）；校验 server_addr 非空/server_port 1-65535/tunnel name 非空/tcp/udp 必填 remote_port；保存配置不自动重启（form-hint 提示需手动点击「启动」）

---

### E. 个人中心与消息组

> 说明：本组 7 个页面为「基座无关」共享组件，通过三基座路由（`/admin`、`/store`、`/guild`）统一挂载，组件内通过 `useBaseFallback`/`useBasePath`/`backToCenter` 动态适配返回路径。在 `/admin` 基座下，侧边栏「个人」组包含 `/admin/center`（个人中心）与 `/admin/profile`（个人设置）。

#### 21. 站内消息 `/admin/notifications`

**文件**：[NotificationsPage.tsx](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/NotificationsPage.tsx)

**用途**：站内消息列表页，支持按标题搜索、按类型筛选，并可标记单条/全部已读。

**布局结构**：单列主内容区，无侧边栏/Tab。page-header（左返回按钮 + 标题「站内消息」，右「刷新」/「全部已读」）→ toolbar（搜索框 + 类型下拉 + 右侧计数）→ 消息卡片纵向列表（每条 info-card，间距 8px）。

**主要模块**：搜索/筛选工具栏；消息卡片列表（每条含类型标签/时间/标题/内容/关联实体跳转链接）。

**操作入口**：「← 返回」（goBack 回退到当前基座首页）；「刷新」；「全部已读」（markAll，toast「已全部标记为已读」）；单击未读卡片→标记该条已读；「查看实例」（Link → `/instances/{related_server_id}`）；「查看订单」（Link，仅 related_order_id 存在时）。

**数据展示**：卡片式列表（非表格）。类型标签 TYPE_LABEL：order_delivered=订单已领取、order_expired=订单已过期、cdk_gift=CDK礼包、vip_changed=VIP变更、system_announcement=系统通知。未读卡片左侧 3px 主色边框 + 不透明，已读卡片 opacity 0.6。时间 `toLocaleString('zh-CN')`。

**筛选/搜索/分页**：搜索框 placeholder「搜索标题…」（title 客户端 toLowerCase 包含）；类型下拉（全部类型 + 5 类）；搜索/筛选状态同步 URL query（q、type，replace: true）；右侧实时计数「共 {n} 条」；**无分页**——全量拉取后客户端过滤。

**角色**：页面内无显式角色门控；通过基座路由层进入，所有登录用户可见。`useBaseFallback` 按当前 pathname 前缀决定返回路径。

**API**：`listNotifications` / `markNotificationRead(id)` / `markAllNotificationsRead()`。

**移动端**：通用 page/toolbar/info-card class；有返回按钮；无移动端专用布局（由外层 Layout 提供）。

**空状态/错误**：loading → `Skeleton(lines=4)`；空态 → EmptyState 区分「暂无消息/新的通知会显示在这里」与「没有匹配筛选条件的消息」；错误 → `catch {}` 静默忽略。监听 `focus-search` 自定义事件，按 `/` 键聚焦搜索框。

---

#### 22. 个人设置 `/admin/profile`

**文件**：[Profile.tsx](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/Profile.tsx)

**用途**：个人设置主页——账户信息、编辑资料、修改密码、实例绑定管理、钱包余额一览。

**布局结构**：单列主内容区，多个 info-card 垂直堆叠。page-header（标题「个人设置」+「刷新」）→ 顶部 error/notice alert → 账户信息卡 → 编辑资料卡（条件渲染）→ 修改密码卡 → 我的实例绑定表 → 可绑定实例表 → 我的钱包表。

**主要模块**：
- 账户信息卡（用户名/邮箱/邮箱验证状态/角色徽章）
- 编辑资料表单（条件展开，显示名称输入）
- 修改密码卡（当前密码/新密码/确认新密码三段式）
- 我的实例绑定表（当前生效绑定 unboundAt 为空）
- 可绑定实例表（全量实例列表）
- 我的钱包表（已绑定实例的点券余额与每日领取）

**操作入口**：「刷新」；「编辑资料」（先 getUser 拉取当前 display_name）；「查看我的资产」（navigate `{basePath}/me`）；「重发验证邮件」（requestEmailVerify）；编辑资料「取消」/「保存 / 保存中…」；修改密码「修改密码」/「取消」/「保存新密码」；绑定表「解绑」（红色，useConfirm 确认弹窗）；可绑定实例表「绑定」/「解绑」（按当前绑定状态切换）；钱包表「领取每日点券」/「今日已领取」（can_claim_daily 决定）。

**数据展示**：绑定表列（实例名/VIP 等级 VIP{N} 徽章/绑定时间/操作）；可绑定实例表列（实例名/游戏 game_type/状态中文徽章/绑定状态/操作）；钱包表列（实例名/点券余额/累计获得/累计消费/今日可领/操作）；角色徽章（server_admin/system_admin=服务器管理员，instance_admin/admin=实例管理员，其余=用户）。

**筛选/搜索/分页**：无（全量加载 listMyBindings + listServers）。

**角色**：页面内无角色门控，三基座通用（useBasePath 适配 /admin//store//guild）。Demo 账号限制：admin@local.dev 禁编辑资料；admin/manager/user@local.dev 三个 Demo 账号禁改密。

**API**：`listMyBindings` / `listServers` / `getWallet(serverId)`（并行查询已绑定实例钱包，失败不阻塞）/ `getEmailVerifyStatus` / `requestEmailVerify` / `getUser(user.id)` / `updateUser(user.id, {display_name})` / `changePassword(old, new)` / `bindInstance(serverId)` / `unbindInstance(serverId)` / `claimDailyReward(serverId)` / `refreshUser()`（保存资料后刷新全局 user）。

**移动端**：通用 page/info-card/table-wrap/data-table class；表格靠 table-wrap 横向滚动；无专用移动端布局。

**空状态/错误**：error → alert-error；notice → alert-info；loading → Skeleton；空态 EmptyState（「尚未绑定任何实例」/「暂无可绑定实例」/「暂无已绑定实例的钱包信息」）。改密错误码完整映射：INVALID_CREDENTIAL→旧密码错误、AUTH_PWD_002→新密码强度不足、AUTH_PWD_003→与近期使用过的密码重复、BUILT_IN_ACCOUNT_PASSWORD_READONLY→系统内置账号不可改密。绑定冲突 ALREADY_BOUND→已绑定该实例。改密成功提示 token_version + 1 需重新登录。

---

#### 23. 实名认证 `/admin/profile/verify`

**文件**：[PlayerVerify.tsx](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/PlayerVerify.tsx)

**用途**：生成游戏内绑定验证码（玩家在游戏控制台执行 `!verify {code}` 完成绑定），展示验证码、使用方法及当前有效验证码列表。

**布局结构**：单列主内容区。page-header（标题「游戏内绑定验证码」+「刷新」）→ error/notice alert → 申请表单卡 → 验证码展示卡（条件渲染，card-highlight）→ 有效验证码列表卡（表格）。

**主要模块**：申请新验证码表单（form-row 双列：服务器下拉 + 游戏内玩家名输入）；验证码展示卡片（verify-code-display 大字验证码 + 服务器/玩家名/过期时间含剩余倒计时 + 使用方法说明）；我的有效验证码表（当前用户未使用且未过期的验证码）。

**操作入口**：「刷新」（refreshCodes）；「生成验证码」（disabled 当 generating 或无 serverId 或 gamePlayerName 空，生成中「生成中…」）。

**数据展示**：验证码卡片显示 code（大字）、server_id、game_player_name、expires_at（formatTime + 剩余 `X分XX秒`）。使用方法代码块 `!verify {code}`。列表表列（验证码 mono font-bold / 服务器 / 玩家名 / 过期时间 / 状态已过期/已使用/有效三种徽章）。

**筛选/搜索/分页**：无。

**角色**：页面内无显式角色门控；文件头注释路径 `/profile/verify`；所有登录用户可用。

**API**：`listServers()`（默认选中第一个）/ `listMyVerifyCodes()` / `createVerifyCode({server_id, game_player_name})`。

**移动端**：通用 page/info-card/form-row/data-table class；form-row 双列表单窄屏自适应；无专用布局。

**空状态/错误**：error → alert-error；notice → alert-success（「验证码已生成，请在 5 分钟内于游戏内使用」）；列表加载中「加载中…」；列表空「暂无有效验证码。」；服务器下拉空「暂无服务器」。过期判定通过 now state（effect 内 setNow(Date.now())，避免 render 中调用 impure 的 Date.now()）。

---

#### 24. 告警配置 `/admin/profile/alerts`

**文件**：[AlertSettings.tsx](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/AlertSettings.tsx)

**用途**：告警通知配置页——配置邮箱通道、Webhook 通道与订阅规则，统一保存。

**布局结构**：单列主内容区。page-header（标题「告警设置」+「刷新」）→ error alert（含重试）→ 邮箱通道卡 → Webhook 通道卡 → 订阅规则卡 → 底部 form-actions 保存按钮（含「有未保存的更改」提示）。

**主要模块**：邮箱通道卡（当前邮箱/验证状态徽章/启用邮箱通知复选框，未验证邮箱时禁用）；Webhook 通道卡（启用 Webhook 复选框 + Webhook URL 输入 SensitiveInput 可 reveal + 测试按钮）；订阅规则卡（复选框列表，每条规则一个带边框的 label 卡片）。

**操作入口**：「刷新」；「重试」（错误态）；启用邮箱通知/启用 Webhook 复选框；「测试 Webhook」（disabled 当 !webhookEnabled 或 !webhookUrl 或 testingWebhook，测试中「测试中…」）；各订阅规则复选框；「保存设置」（disabled 当 !dirty 或 saving，保存中「保存中…」）。

**数据展示**：邮箱验证状态徽章（已验证=running/未验证=warning）。订阅规则项展示 type 徽章 + severity 徽章（info=信息/warning=警告/critical=严重，critical/error→badge-error、warning→badge-warning、其余→badge-running）+ name（加粗）+ description（form-hint）。

**筛选/搜索/分页**：无。

**角色**：文件头注释「所有已登录用户可见」，路径 `/profile/alerts`；页面内无角色门控。

**API**（注释明示端点）：`getAlertSettings()` → `GET /api/alert-settings`；`listAlertRules()` → `GET /api/alert-settings/rules`；`updateAlertSettings({email_enabled, webhook_enabled, webhook_url, subscribed_rules})` → `PUT /api/alert-settings`；`testAlertWebhook({webhook_url})` → `POST /api/alert-settings/test-webhook`。

**移动端**：通用 page/info-card class；订阅规则列表纵向堆叠（flexDirection: column, gap: 8）；无专用布局。

**空状态/错误**：首次 loading → `ListSkeleton(rows=4, columns=2)`；首次 error → alert-error + 重试按钮；后续 error 同样；订阅规则空「暂无可用告警规则」；dirty 状态「有未保存的更改」；未验证邮箱启用邮箱通道 → `toast.warning("请先验证邮箱后再启用邮箱通道")`；保存成功 → `toast.success("告警设置已保存")`。编辑态本地暂存，点击保存才提交。

---

#### 25. 个人中心 `/admin/center`

**文件**：[UserCenter.tsx](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/user-center/UserCenter.tsx)

**用途**：个人中心经济系统主页——余额总览 KPI、快捷操作入口、跨实例汇总、最近交易、提现记录。

**布局结构**：单列主内容区。page-header（标题「个人中心」+ RefreshCw「刷新」）→ KPI 卡片网格（stats-grid `repeat(auto-fit, minmax(160px, 1fr))`，6 格）→ 快捷操作卡 → 跨实例汇总表卡（条件渲染）→ 最近交易卡（含「查看全部」）→ 提现记录表卡（条件渲染）→ 3 个 Modal。

**主要模块**：
- KPI 卡片（6）：总余额、可用余额、冻结余额、累计收入、累计支出、累计提现
- 快捷操作卡（5 个按钮 + 待核销提现提示）
- 跨实例汇总表（各实例点券与 VIP 状态）
- 最近交易列表（前 5 条，卡片式）
- 提现记录表（前 5 条）
- Modals：CdkRechargeModal、CdkGenerateModal、WithdrawModal

**操作入口**：「刷新」；「CDK 充值」（KeyRound 图标，开 CdkRechargeModal）；「生成 CDKey」（Gift 图标，availableBalance<=0 禁用，开 CdkGenerateModal）；「申请提现」（Wallet 图标，availableBalance<=0 禁用，开 WithdrawModal）；「交易记录」（CreditCard 图标，navigate 'transactions'）；「消费统计」（Coins 图标，navigate 'stats'）；「查看全部」（navigate 'transactions'）。

**数据展示**：KPI 6 项 formatMoney 格式化（千分位），loading 时显示「…」。跨实例汇总列（实例/点券余额/点券累计获得/点券累计消费/VIP 状态「买断 VIP」/「订阅 VIP」+「Lv.N」或「无 VIP」徽章）。最近交易（左侧带色图标收入绿 ArrowDownLeft/支出红 ArrowUpRight + 类型徽章 + 实例名 + 描述 + 带符号金额绿 +N/红 -N + 时间）。提现记录列（提现码/申请金额/实际到账/状态待核销/已核销/已拒绝/已过期徽章/申请时间）。

**筛选/搜索/分页**：本页无（交易与提现均取前 5 条，分页在子页 transactions）。

**角色**：页面内无显式角色门控；三基座通用；所有登录用户可用。

**API**（来自 ./api.ts，Promise.all 并行）：`getBalanceSummary(token)` → `GET /me/balance/summary`；`getTransactions(token, {page:1, page_size:5})` → `GET /me/transactions`；`getWithdrawHistory(token, 1, 5)` → `GET /me/withdraw/history`；Modal 内部触发 `createWithdraw`/`generateUserCdk` 等，成功后 onSuccess 回调 refresh()。

**移动端**：stats-grid 自适应（auto-fit, minmax(160px, 1fr)）；交易列表卡片式布局适合窄屏；快捷操作按钮 flexWrap: wrap；无专用布局。

**空状态/错误**：KPI loading →「…」；最近交易 loading →「加载中…」；最近交易空 →「暂无交易记录」；pendingWithdrawCount > 0 → alert-info（「您有 {n} 笔提现申请待核销，请将提现码提供给服务器管理员」）；跨实例汇总/提现记录仅在数据非空时渲染；error → toast.error（区分 PanelApiError 与普通 Error）。

---

#### 26. 交易记录 `/admin/center/transactions`

**文件**：[UserTransactions.tsx](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/user-center/UserTransactions.tsx)

**用途**：本人钱包流水查询页，支持币种/类型过滤与分页。

**布局结构**：单列主内容区。page-header（标题「交易记录」+ ArrowLeft「返回」+ RefreshCw「刷新」）→ 过滤条卡（info-card，币种下拉 + 类型下拉 + 右侧计数）→ 流水表格卡（info-card，含表格 + 分页控制）。

**主要模块**：过滤条（币种下拉 + 类型下拉 + 记录总数计数）；流水表格（7 列明细）；分页控制（上一页/下一页 + 页码）。

**操作入口**：「返回」（navigate backToCenter，去掉 URL 最后一段）；「刷新」；「上一页」（ChevronLeft，disabled 当 page<=1 或 loading）；「下一页」（ChevronRight，disabled 当 page>=totalPages 或 loading）。

**数据展示**：流水表列（时间 formatFullTime whiteSpace:nowrap / 类型徽章 TX_TYPE_BADGE / 币种 CURRENCY_TYPE_LABEL / 金额带符号右对齐 font-weight:600 收入绿 #34C759/支出红 #FF3B30 / 交易后余额右对齐 mono / 实例 serverNames 映射失败降级显示 server_id / 描述 maxWidth:240 ellipsis title 悬浮全显）。币种选项：全部币种/余额/点券/积分。类型选项：全部类型 + 17 种（每日奖励/商城消费/商城退款/CDK充值/管理员充值/管理员扣减/VIP购买/余额兑换/生成CDKey/CDK兑换/CDK退款/提现/积分获得/积分衰减/积分调整/礼物/系统）。

**筛选/搜索/分页**：币种筛选（currency_type: balance/points/integral）；类型筛选（type: 17 种）；分页 PAGE_SIZE = 20 上一页/下一页按钮「第 {page} / {totalPages} 页」；过滤条件变化自动回第 1 页；右侧计数「共 {total} 条记录」。

**角色**：页面内无显式角色门控；路径 `{base}/center/transactions`（三基座通用）；所有登录用户可用。

**API**：`getTransactions(token, {currency_type, type, page, page_size})` → `GET /me/transactions`；`getBalanceSummary(token)` → `GET /me/balance/summary`（仅用于实例名映射，失败静默降级显示 server_id）。

**移动端**：过滤条 flex-wrap: wrap，下拉 flex: 0 1 180px；表格靠 table-wrap 横向滚动；分页控制 flex-wrap: wrap；无专用布局。

**空状态/错误**：loading →「加载中…」（padding:32px）；空态 →「暂无符合条件的交易记录」；error → toast.error（区分 PanelApiError）。

---

#### 27. 消费统计 `/admin/center/stats`

**文件**：[UserStats.tsx](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/user-center/UserStats.tsx)

**用途**：本人消费统计总览页——KPI 汇总 + 图表可视化。

**布局结构**：单列主内容区。page-header（标题「消费统计」+ ArrowLeft「返回」+ RefreshCw「刷新」）→ KPI 卡片网格（stats-grid，4 格）→ 图表区卡（info-card）。

**主要模块**：KPI 卡片（4）：本月收入（TrendingUp）、本月支出（TrendingDown）、近 12 月收入、近 12 月支出；图表区 SpendingCharts 子组件（传入 monthlyTrend/topServers/byType 三组数据，纯 CSS 图表）。

**操作入口**：「返回」（navigate backToCenter）；「刷新」（disabled 当 loading）。

**数据展示**：KPI 用 formatMoney 格式化，loading 时显示「…」。「本月」数据通过 monthly_trend 中匹配当前 YYYY-MM 取得；「近 12 月」为 monthly_trend 全量 reduce 求和。图表数据：月度收支趋势（monthly_trend: month/income/expense）、Top 消费实例（top_servers: server_id/server_name/total_spent）、分类汇总（by_type: currency_type/type/total_amount/tx_count）。

**筛选/搜索/分页**：无。

**角色**：页面内无显式角色门控；路径 `{base}/center/stats`（三基座通用）；所有登录用户可用。

**API**：`getUserStats(token)` → `GET /me/stats`（返回 by_type + monthly_trend + top_servers）。

**移动端**：stats-grid 自适应（auto-fit, minmax(160px, 1fr)）；通用 page/info-card class；无专用布局。

**空状态/错误**：loading →「加载中…」（padding:32px）；无数据（by_type/monthly_trend/top_servers 全空）→「暂无统计数据，完成首笔交易后此处将展示消费分析」；error → toast.error（区分 PanelApiError）。

---

## 四、跨页面横向对比

### 4.1 数据形态与 CRUD 能力对比

| 页面 | 数据形态 | CRUD | 二次确认机制 |
|---|---|---|---|
| 平台大盘 | KPI 卡片 + 横条图 | 只读 | — |
| 全平台总览 | KPI + 曲线 + 表格 | 只读 | — |
| 系统监控 | MetricCard + Sparkline + 表格 | 只读 | — |
| 审计日志 | 虚拟化表格 | 只读 + CSV 导出 | — |
| 运维清理 | 表格 + inline 编辑 | U（retention）+ D（清理） | useConfirm + useDestructiveAction |
| 权限管理 | 表格 + 移动卡片 | 全（CRUD + 批量） | useConfirm |
| 玩家绑定 | 表格 | D（解绑） | useConfirm |
| 提现审批 | 表格 | U（核销/拒绝） | useConfirm |
| API Keys | 表格 | C + D（撤销） | Modal |
| Webhooks | 表单 + 表格 | 全 + 测试 | useConfirm |
| 实例列表 | 表格 + 移动卡片 | 全 + 批量 + CSV | ConfirmDialog（输入名） |
| 实例详情 | Tab + 控制台 | 全 + 子目录清理 | ConfirmDialog（输入名） |
| 部署节点 | 表格 + 展开行 | C（邀请）+ D（删除） | useConfirm |
| 实例清理 | 双表格 | D（确认删除）+ U（忽略） | useDestructiveAction（输入 ID） |
| 配额管理 | 卡片 + 表格 | U（编辑） | Modal |
| 底座配置 | 表格 + inline 编辑 | 全（含恢复默认） | useConfirm（删除） |
| 面板设置 | 手风琴表单 | U + Reset | — |
| Pack 管理 | 表格 + YAML 编辑器 | 全 | useDestructiveAction（输入 packId） |
| SSL 证书 | InfoRow + 表单 | Stage + Deploy | useDestructiveAction（含回滚）+ Modal |
| 隧道管理 | 状态卡 + 表单 + 日志 | U + Start/Stop | — |
| 站内消息 | 卡片列表 | U（标记已读） | — |
| 个人设置 | 多卡片 + 表格 | U（资料/密码/绑定/钱包） | useConfirm（解绑） |
| 实名认证 | 表单 + 卡片 + 表格 | C（生成验证码） | — |
| 告警配置 | 卡片表单 | U（保存设置） | — |
| 个人中心 | KPI + 卡片 + 表格 | C（充值/CDKey/提现） | Modal |
| 交易记录 | 表格 | 只读 | — |
| 消费统计 | KPI + 图表 | 只读 | — |

### 4.2 筛选/搜索/分页能力对比

| 能力 | 页面 |
|---|---|
| 服务端搜索 + 分页 | 权限管理、实例列表、提现审批 |
| 客户端搜索 + 分页 | 配额管理（用户列表）、交易记录 |
| 客户端搜索无分页 | 站内消息 |
| 仅 Tab/分类筛选 | 底座配置（6 分类 Tab）、系统监控（4 Tab URL 同步） |
| 仅下拉筛选 | 玩家绑定、Webhooks（服务器维度）、审计日志（多条件） |
| URL 状态化 | 审计日志（全参数）、实例列表（全参数）、系统监控（tab）、站内消息（q/type） |
| 无任何筛选搜索分页 | 平台大盘、全平台总览、运维清理、API Keys、实例清理、面板设置、Pack 管理、SSL 证书、隧道管理、个人设置、实名认证、告警配置、个人中心、消费统计 |

### 4.3 移动端适配等级对比

| 等级 | 页面 | 说明 |
|---|---|---|
| 优秀（双布局） | 权限管理、实例列表、审计日志 | desktop-only 表格 + mobile-only 卡片列表 |
| 良好（响应式 grid） | 平台大盘、全平台总览、系统监控、面板设置、SSL 证书、隧道管理、个人中心、消费统计、交易记录 | auto-fit minmax grid + flexWrap |
| 一般（依赖外壳） | 玩家绑定、提现审批、API Keys、Webhooks、实例详情、部署节点、配额管理、底座配置、Pack 管理、站内消息、个人设置、实名认证、告警配置 | 表格 table-wrap 横向滚动，无专用布局 |
| 较弱（无移动端适配） | 运维清理、实例清理 | 表格无 mobile-only 降级，窄屏体验差 |

### 4.4 角色门控风格对比

| 风格 | 页面 |
|---|---|
| 显式 `Navigate to="/forbidden"` | 系统监控、审计日志、权限管理、玩家绑定、API Keys、Webhooks、底座配置、面板设置、Pack 管理、SSL 证书、隧道管理、部署节点 |
| 仅依赖路由守卫 | 平台大盘、全平台总览、运维清理、实例清理、配额管理 |
| 直接渲染告警条（不一致） | 提现审批（`if (!isAdmin) return <div className="alert alert-error">仅管理员可访问此页面</div>`） |
| 无角色门控（三基座通用） | 站内消息、个人设置、实名认证、告警配置、个人中心、交易记录、消费统计 |

---

## 五、关键发现与风险点

### 5.1 架构与一致性

1. **角色门控不一致**：27 个页面中，12 个显式 `Navigate to="/forbidden"`，5 个仅依赖路由守卫，1 个（提现审批）直接渲染告警条，7 个个人中心页面无门控。建议统一为「路由守卫 + 页面内显式检查」双层模式，至少破坏性操作页面（运维清理、实例清理、配额管理）应补显式检查。

2. **WithdrawApprovals 风格孤立**：唯一不使用 `api` 客户端而走 `userCenterRequest` 的页面，且未走 `/forbidden` 重定向而是直接渲染告警条，与其他 admin 页面风格不一致。建议统一为 `api` 客户端 + `Navigate to="/forbidden"`。

3. **AdminDashboard vs PlatformDashboard 功能重叠**：两者都展示总用户/实例/节点/收入 KPI。AdminDashboard 是轻量卡片 + 快捷入口的「门户」风格；PlatformDashboard 是详细数据 + 曲线 + 表格的「报表」风格。前者 KPI 卡片点击穿透到后者，定位清晰但需注意维护成本。

4. **降级策略差异**：
   - AdminDashboard：`Promise.allSettled`，资产模板失败非阻断
   - PlatformDashboard：5 个 `*Error` 状态位，每模块独立降级 + 独立重试
   - SystemHealth：`isEndpointUnavailable` 判断 404/网络错误 →「接口暂未开放」占位
   - AuditLogs：服务器列表失败非阻塞，主查询失败 alert-error
   - Maintenance：整页 error-banner + 重试
   建议提炼统一的降级 HOC 或 hook，减少重复实现。

### 5.2 移动端体验

5. **运维清理、实例清理移动端适配较弱**：两个页面均无 `mobile-only` 卡片降级，仅依赖表格横向滚动，与 Servers.tsx 的双套布局形成对比。实例清理涉及破坏性操作，移动端误触风险更高，建议优先补移动端卡片视图。

6. **多列表格窄屏体验差**：提现审批（8 列）、API Keys（9 列）、Webhooks（7 列）、玩家绑定（7 列）在窄屏下需横向滚动，无移动端卡片降级。建议参照 Users.tsx 的双布局模式。

### 5.3 破坏性操作保护

7. **破坏性操作保护到位**：Pack 删除、SSL 部署、实例删除、实例清理均走 `useDestructiveAction`（preview → confirm → execute + 失败回滚）；实例删除/清理需输入名称/ID 文本匹配确认；运维清理一键清理走 `useDestructiveAction` + `useConfirm` 双闸门。保护机制设计良好。

8. **SSL 部署失败自动回滚**：`rollbackSslCertificate()` 在部署失败时自动回滚，避免 nginx 配置损坏导致服务中断，是优秀实践。

### 5.4 数据展示与性能

9. **虚拟化表格应用得当**：AuditLogs 使用 VirtualTable（`estimateRowHeight={44}` `maxHeight={640}`）处理千行级数据，性能良好。

10. **全量加载无分页的页面较多**：玩家绑定、API Keys、Webhooks、底座配置、Pack 管理、SSL 证书、隧道管理、个人设置、站内消息均一次性加载全部数据。当前数据量下可接受，但需关注未来增长。

11. **Quotas 禁用项兼容性处理**：v4.29.13 禁用 `max_instances`/`max_players_total` 后，保存时仍传 null 保持后端契约兼容，注释保留待恢复，是良好的渐进式迁移实践。

### 5.5 访问性与键盘操作

12. **KPI 卡片键盘可访问**：AdminDashboard 的 KPI 卡片支持 `role="button"` + `tabIndex={0}` + Enter/Space 触发，符合无障碍标准。

13. **快捷键支持**：`/` 快捷键聚焦搜索框（实例列表、站内消息）；`Ctrl/Cmd+K` 命令面板；`?` 快捷键帮助。键盘操作体验良好。

14. **Tab 状态 URL 同步**：系统监控（`?tab=`）、实例详情（`?tab=`）、审计日志（全参数）、实例列表（全参数）均支持 URL 状态化，可分享/书签。

### 5.6 线上实地观察补充

15. **节点部署未启用**：`NODE_DEPLOYMENT_ENABLED = false`（v4.28.0 未开源），「添加节点」可查看部署引导预览但不实际创建邀请，使用 `DEPLOYMENT_PREVIEW_RESULT` 占位数据。

16. **v4.29.7 线上运行正常**：浏览器实地访问 9 个核心页面（平台大盘、全平台总览、系统监控、审计日志、权限管理、玩家绑定、提现审批、API Keys、Webhooks）均正常加载，控制台无红色错误（仅 1 条 EventEmitter MaxListenersExceededWarning 非阻断）。

---

## 六、调研方法说明与局限

### 6.1 调研方法

本报告采用「浏览器实地访问 + 前端源码深度分析」双轨调研：

1. **浏览器实地访问**：使用 browser_use 子代理访问 `https://gsp.ecsrz.com:3001/admin/` 各页面，采集页面标题、加载状态、控制台错误、可见文字等运行时证据，确认线上版本 v4.29.7。
2. **前端源码深度分析**：并行派 5 个 general_purpose_task 子代理读取 27 个页面的 React 源码（.tsx），按 10 个维度（用途/布局/模块/操作/数据/筛选/角色/API/移动端/空状态）产出结构化分析。源码分析为主，浏览器验证为辅。

### 6.2 局限

1. **未覆盖交互细节**：部分 Modal/表单的完整交互流程（如批量操作结果模态、SSL 部署回滚实际触发）仅基于源码推断，未在浏览器中实际触发。
2. **未覆盖后端 API 行为**：报告聚焦前端页面分析，后端接口的实际响应行为、错误码、数据契约未深入验证。
3. **未覆盖权限边界测试**：未以 instance_admin / user 角色实际访问各页面验证门控行为，角色门控结论基于源码静态分析。
4. **浏览器并行争用**：首次并行派 3 个浏览器子代理时出现会话争用（Agent 2 被重定向到 Agent 3 的页面），后改用源码分析为主、浏览器单代理验证为辅的策略规避。部分页面（部署节点、实例清理、面板设置、配额管理、个人中心子页）的浏览器实地截图因争用未完整采集，但源码分析已覆盖全部维度。
5. **未覆盖废弃路由重定向体验**：14 个已废弃的旧 `/admin/*` 路由重定向到 `/instances?uiTab=xxx` 的 Toast 引导体验未实地验证。

---

> 报告完。如需对特定页面做更深入的交互流程验证、权限边界测试或后端契约核对，可基于本报告的页面清单进一步定向调研。
