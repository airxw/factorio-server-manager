---
type: spec
title: 三层操作逻辑视觉与交互细节规格
date: 2026-07-24
status: spec
version_target: v4.12.0
related:
  - docs/reports/three-tier-operation-logic-original-vision-analysis.md
  - docs/plans/v4.11.0_commercialization_upgrade_plan.md
  - docs/plans/three-tier-operation-logic-rebuild-plan.md
tags: [three-tier, ui-spec, platform-dashboard, gm-workbench, player-portal, v4.12.0]
---

# 三层操作逻辑视觉与交互细节规格

> 本文是对 [当初设想分析](file:///home/airxw/Documents/gsp/gameserver-panel/docs/reports/three-tier-operation-logic-original-vision-analysis.md) §3.4 的细化，为 v4.12.0 三 Layout 差异化实现提供可执行规格。当初设想 §四 仅一句话描述每层风格，本文细化到导航结构、视觉风格、信息架构、交互模式四维。

## 一、设计原则（贯穿三层）

1. **角色场景驱动**：每层 Layout 的导航、视觉、交互均围绕该层角色的核心任务设计，非通用壳。
2. **共享 chrome + 差异化外壳**：通知铃铛、命令面板、面包屑、版本/帮助模态、移动端导航抽离为共享组件；侧边栏结构、配色、主导航按层差异化。
3. **移动端优先**：三层均需移动端适配，Player Portal 移动端为一等公民（C 端电商体验），Admin/Store 移动端为桌面端降级。
4. **信息屏蔽**：Player Portal 屏蔽所有服务器运维信息（实例配置/Daemon/部署命令/系统健康）；GM Workbench 弱化终端命令行（折叠到二级）。
5. **视觉层次**：遵循用户偏好——强调视觉层次、特效、非文本元素，避免 PPT 式纯文本堆砌。

## 二、Platform Dashboard（/admin = 系统管理员）

### 2.1 定位
平台供应链与规则制定者的大盘，强调全局视图与资源调度。

### 2.2 视觉风格
- **色调**：深蓝灰主色（slate-800/900）+ 青色强调（cyan-500），传达专业、稳重、数据感
- **密度**：中高密度信息展示（大盘卡片 + 表格 + 图表）
- **字体**：标题用 font-semibold，数据用 tabular-nums 等宽对齐
- **卡片**：白底 + border + 轻阴影，数据卡片带趋势 sparkline

### 2.3 导航结构（侧边栏，仅 server_admin/system_admin/admin 可见）
```
全平台总览
  ├ 平台大盘 (/admin, index)
  ├ 全平台总览 (/admin/platform)
用户与权限
  ├ 权限管理 (/admin/users)
  ├ API Keys (/admin/api-keys)
系统监控
  ├ 系统监控 (/admin/system-health)
  ├ 部署节点 (/admin/nodes)
配置管理
  ├ 底座配置 (/admin/system-config)
  ├ 面板设置 (/admin/settings)
  ├ Pack 管理 (/admin/packs)
  ├ SSL 证书 (/admin/ssl)
  ├ 隧道管理 (/admin/tunnel)
审计与日志
  ├ 审计日志 (/admin/audit-logs)
  ├ Webhooks (/admin/webhooks)
运维清理
  ├ 实例清理 (/admin/cleanup)
  ├ 运维清理 (/admin/maintenance)
资产模板
  ├ 全局资产库 (/admin/global-assets)  [v4.12.0 新增]
  ├ 配额管理 (/admin/quotas)
```
> 注：原"业务运营"组（instance-vip/operations）已迁出 /store；新增"资产模板"组承接系统管理员的 Global_Assets 配置职责。

### 2.4 信息架构
- **index 页（AdminDashboard）**：四象限大盘
  - 左上：全局实例数 + 在线/离线分布（环形图）
  - 右上：节点资源大盘（CPU/内存/磁盘利用率条形图）
  - 左下：租户配额概览（表格：服主 / 实例数 / 配额 / 已用）
  - 右下：资产模板概览（Global_Assets 数量 + 最近变更）
- **页面布局**：桌面端侧边栏 + 内容区；移动端抽屉 + 底部导航（首页/节点/消息/我的）

### 2.5 交互模式
- 资源调度为主：表格批量操作、配额调整表单、节点状态实时刷新
- 终端命令行：保留（系统管理员需要 raw RCON 排障），但在二级菜单"运维清理"下

## 三、GM Workbench（/store = 服主工作台）

### 3.1 定位
服主的"店铺后台"，零售商与微创业者的运营阵地。弱化运维，强化商城/玩家/报表。

### 3.2 视觉风格
- **色调**：暖色主色（amber-500/600）+ 翠绿强调（emerald-500），传达商业、活力、收益感
- **密度**：中等密度（卡片 + 列表 + 报表）
- **字体**：标题 font-semibold，金额用 tabular-nums + emerald 色突出
- **卡片**：商品卡片带图占位 + 价格 + 上下架状态徽章

### 3.3 导航结构（侧边栏，instance_admin+ 可见）
```
店铺运营
  ├ 工作台首页 (/store, index)  [v4.12.0 改造为店铺概览]
  ├ 商城管理 (/store/commercial)  [商业化控制台]
  ├ 运营仪表盘 (/store/operations)
玩家管理
  ├ 玩家列表 (/store/players)  [v4.12.0 新增 CRM 视图]
  ├ VIP 管理 (/store/instance-vip)
数据报表
  ├ 流水报表 (/store/reports/revenue)  [v4.12.0 新增]
  ├ 时长统计 (/store/reports/playtime)  [v4.12.0 新增]
实例运营
  ├ 我的实例 (/store/servers)  [v4.12.0 新增，服主视角实例列表]
```
> 注：终端命令行/控制台/raw RCON 入口**折叠到"实例运营 → 我的实例 → 实例详情"二级 Tab**，默认不可见。

### 3.4 信息架构
- **index 页（StoreHome）**：店铺概览
  - 顶部：今日流水 + 在线玩家数 + 活跃实例数（三个数据卡片，带趋势）
  - 中部：最近订单列表（玩家 / 商品 / 金额 / 时间）
  - 底部：商品上下架快捷操作（最近改价的 5 个商品）
- **页面布局**：桌面端侧边栏 + 内容区；移动端抽屉 + 底部导航（首页/商城/玩家/报表/我的）

### 3.5 交互模式
- 选品定价运营为主：商品上架表单、改价 Override 面板、玩家封禁/补偿操作
- 终端命令行：折叠，需要时展开（默认隐藏，点击"高级"展开）

## 四、Player Portal（/guild = 玩家门户）

### 4.1 定位
玩家的 C 端电商与社交门户，移动端优先，服主店铺化呈现，屏蔽所有运维信息。

### 4.2 视觉风格
- **色调**：浅色主色（white/slate-50）+ 品牌强调色（按服主自定义 Banner 配色，默认 teal-500）
- **密度**：低密度，大卡片，大触摸目标（≥44px）
- **字体**：标题 font-bold，价格 font-semibold + 红色（促消费）
- **卡片**：商品卡片大图 + 名称 + 价格 + 购买按钮，圆角 + 轻阴影

### 4.3 导航结构（底部 tab，移动端优先；user+ 所有已登录用户）
```
底部 Tab 导航（移动端）：
  ├ 首页 (/guild, index)  [服主店铺浏览/Banner/商品流]
  ├ 商城 (/shop)  [商品消费]
  ├ 我的 (/me)  [我的资产]
  ├ 发现 (/discover)  [服务器发现]
  ├ 消息 (/admin/notifications)  [站内消息]

桌面端顶部导航（>768px）：
  ├ Logo + 服主店铺名
  ├ 首页 / 商城 / 发现 / 消息 / 我的
  ├ 通知铃铛 + 用户头像下拉
```
> 注：**无侧边栏**——Player Portal 采用顶部导航（桌面）+ 底部 tab（移动端）的 C 端电商布局，不复用 Admin/Store 的侧边栏结构。**所有运维入口（实例配置/Daemon/系统健康/部署命令）对玩家角色不可见**。

### 4.4 信息架构
- **index 页（GuildDock）**：服主店铺首页
  - 顶部：服主自定义 Banner（占视口 ≥30% 高度，图片占位 + 服主店铺名 + 简介）
  - 中部：热门商品流（横向滚动卡片，大图 + 名称 + 价格）
  - 下部：商品分类（VIP / 道具 / 时长 / CDK，tab 切换）
  - 底部：账号绑定卡片（Steam ID 绑定状态，未绑定则提示绑定）
- **页面布局**：移动端单列流；桌面端顶部导航 + 居中内容区（max-width-5xl）

### 4.5 交互模式
- 浏览消费绑定为主：商品卡片点击 → 详情 → 购买/兑换；账号绑定卡片点击 → 绑定流程
- **无运维交互**：不显示实例状态、Daemon、控制台、部署命令、系统健康等任何运维信息

## 五、共享 chrome 组件清单

抽离到 `panel/frontend/src/components/chrome/` 下，三个 Layout 按需 import 组合：

| 组件 | 路径 | 说明 |
|------|------|------|
| NotificationBell | chrome/NotificationBell.tsx | 通知铃铛 + 未读数角标（WS 驱动） |
| CommandPalette | chrome/CommandPalette.tsx | 全局命令面板（Ctrl+K），从现有 CommandPalette 迁移 |
| Breadcrumbs | chrome/Breadcrumbs.tsx | 面包屑导航，接受 items props |
| VersionModal | chrome/VersionModal.tsx | 版本信息模态 |
| HelpModal | chrome/HelpModal.tsx | 帮助中心模态 |
| ShortcutsHelp | chrome/ShortcutsHelp.tsx | 快捷键帮助模态 |
| NodeStatusWidget | chrome/NodeStatusWidget.tsx | 节点状态悬浮组件（仅 Admin/Store 可见，Guild 屏蔽） |
| UserMenu | chrome/UserMenu.tsx | 用户信息 + 登出下拉 |

> 旧 Layout.tsx 重构为 BaseLayout（接受 navConfig props），Admin/Store 复用 BaseLayout + 注入各自导航配置；GuildLayout 独立实现不复用 BaseLayout。

## 六、完成判据（对照 v4.12.0 方案步骤）

| 判据 | 验证方式 |
|------|---------|
| 三 Layout 视觉与信息架构明显不同 | 截图对比：Admin 深蓝大盘 / Store 暖色店铺后台 / Guild 浅色 C 端电商 |
| 角色门控隔离生效 | user 登录看不到 /admin /store 管理入口；instance_admin 看不到 /admin |
| Player Portal 移动端布局正确 | Chrome DevTools 375px 视口：Banner ≥30% 视口高度，底部 tab 可用，运维菜单 DOM 不可见 |
| GM Workbench 终端折叠 | StoreLayout 主导航无"终端/控制台"一级入口，仅"实例运营"二级 Tab 内可见 |
| 旧路径重定向 | /dashboard /shop /me /friends 等 301 到新基座 |
| 运行时接入未破坏 | grep commercial 在 routes-registry 仍注册；AssetService 仍注入；ExecutionEngine 仍被引用 |

## 七、风险与降级

- **风险**：GuildLayout 完全独立实现移动端 C 端布局工作量最大。若移动端 C 端电商体验在本次无法完整落地（如服主自定义 Banner 数据契约未就绪），降级为：GuildLayout 复用 BaseLayout 但隐藏运维导航 + 简化 Banner 占位，Banner 数据契约延后到 v4.13.0。
- **风险**：新增页面（玩家列表 CRM / 数据报表）需要后端 API 支撑。若后端 API 不存在，前端先做 Mock 占位页面 + 标注"数据接入待 v4.13.0"，不阻断 v4.12.0 结构落地。
- **风险**：Instance_Assets Banner 字段扩展属 public/ 契约变更，须走 s0601 + 人类授权。若人类未授权，Banner 用 Instance_Assets 现有字段的 metadata JSON 承载，不扩展 schema。

---

> 本规格为 v4.12.0 三 Layout 差异化实现的执行依据。后续 UI 实现以此为准。
