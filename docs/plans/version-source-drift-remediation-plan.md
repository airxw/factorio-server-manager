---
type: plan
title: 版本源漂移根治方案（bug1.md 复查闭环）
date: 2026-07-23
status: deployed
deployed_in: v4.13.0
related:
  - docs/bugfix/bug1.md
  - .trae/rules/bb.md
  - scripts/check-version-sync.ts
  - daemon/src/index.ts
tags: [version-sync, daemon, release-process, bug1-followup]
---

# 版本源漂移根治方案（bug1.md 复查闭环）

> 本方案是对 `docs/bugfix/bug1.md` 描述问题的复查闭环。bug1.md 原描述的"功能层故障"（路由被破坏、构建阻断、Mock 驱动）已在 v4.14.0/v4.14.1 修复；但"版本层漂移"问题复发，并演化出新的结构性形态。本方案只输出执行步骤与建议，不区分优先级，不计人力工期。

## 一、复查结论速览

| bug1.md 原问题 | 当前状态 | 证据 |
|---|---|---|
| Hero.tsx TS 错误导致构建阻断 | ✅ 已修复 | `panel/frontend/src/pages/landing/Hero.tsx` 为合法 TSX |
| 三基座子路由未注册 | ✅ 已修复 | `App.tsx#L324-L417` 下 `/admin` `/store` `/guild` 子路由完整挂载 |
| 新旧路由分裂（体验模式进新壳/登录进旧控制台）| ✅ 已修复 | `App.tsx#L155-L161` RootRedirect 按角色统一跳三基座；旧路径全部重定向 |
| commercial 是 Mock 驱动 | ✅ 已修复 | `commercial/index.tsx` 已走 `api.listMergedAssets`/`api.listServers` 真实后端 |
| 版本校验脚本解析 README 失效 | ✅ 已修复 | `check-version-sync.ts#L79-L91` 兼容 `**vX.Y.Z**` 新格式 |
| **版本源漂移（核心病灶）** | ⚠️ **复发且演化** | 见下文三层分析 |

## 二、交叉检查证据矩阵（12 处版本源全量盘点）

> 项目文档（`version.md` 历史条目、`current-note.md`）多次声称版本源为"8 处/11 个，含 daemon DAEMON_VERSION 常量"。但 `check-version-sync.ts` 实际只覆盖 11 处，DAEMON_VERSION 硬编码不在校验范围。本矩阵澄清全部 12 处版本源的当前值、校验覆盖与运行时消费链路。

| # | 版本源 | 当前值 | 校验脚本覆盖 | 运行时消费链路 | 备注 |
|---|---|---|---|---|---|
| 1 | `version.json` `.version` | 4.14.1 | ✅ | 根版本清单真相源 | — |
| 2 | `version.json` `.daemon` | 4.14.1 | ✅ | 声明 daemon 版本 | — |
| 3 | `version.json` `.panel_backend` | 4.14.1 | ✅ | 声明 backend 版本 | — |
| 4 | `version.json` `.panel_frontend` | 4.14.1 | ✅ | 声明 frontend 版本 | — |
| 5 | `package.json` (root) `.version` | 4.14.1 | ✅ | npm workspace 根 | — |
| 6 | `panel/frontend/package.json` | 4.14.1 | ✅ | 构建期注入 `APP_VERSION`，前端 fallback 显示 | `AppVersionContext.tsx` |
| 7 | `panel/backend/package.json` | 4.14.1 | ✅ | `/api/version` 返回 `backendPkg.version` | `routes-registry.ts#L498-L501` |
| 8 | `daemon/package.json` | 4.14.1 | ✅ | daemon 包元数据 | — |
| 9 | `version.md` 首个 `## vX.Y.Z` | 4.14.1 | ✅ | `/api/version/changelog` 解析返回 | `routes-registry.ts#L504-L511` |
| 10 | `README.md` `**vX.Y.Z**` 当前版本 | **4.13.1** | ✅ | 用户向入口展示 | **唯一硬不一致** |
| 11 | `deploy.sh` `DEPLOY_VERSION` | 4.14.1 | ✅ | 部署时版本标识 | — |
| 12 | `daemon/src/index.ts` `DAEMON_VERSION` 常量 | 4.14.1 | ❌ **盲区** | `createDaemonServer({daemonVersion})` → daemon HTTP → 上报 panel → `nodeService` 写入 `nodes.daemon_version` → 前端节点页展示 | **bug1.md 最早点名，至今未从校验层面闭环** |

### 2.1 校验脚本实测结果（`npx tsx scripts/check-version-sync.ts`）

```
❌ 版本号同步校验失败 — 以下来源版本号不一致：
  • 10 处 → 4.14.1
  • README.md (**vX.Y.Z** 当前版本) → 4.13.1
```

脚本 exit 1，**闸门本身有效**，能拦住漂移。问题在于：本次 README 滞留是在版本同步过程中漏改，说明"同步"动作仍是手工逐文件改，无单一真相源驱动。

### 2.2 DAEMON_VERSION 消费链路（运行时影响）

```
daemon/src/index.ts:18  DAEMON_VERSION = '4.14.1'
   │
   ├── index.ts:43  slaveMode 配置解析传入 daemonVersion
   └── index.ts:55  createDaemonServer({ daemonId, daemonVersion: DAEMON_VERSION })
           │
           └── daemon HTTP 上报 → panel/backend/src/daemon-event-forwarder.ts:25
                   │   { daemon_id, daemon_version: event.daemon_version }
                   └── panel/backend/src/services/nodeService.ts:59
                           │   daemon_version?: string  ← 写入 nodes 表
                           └── 前端节点管理页展示
```

若 DAEMON_VERSION 与 `daemon/package.json` 不一致，会出现"daemon 包是 4.14.1 但上报成 4.13.1"的幽灵版本，且校验脚本不会报警。本次碰巧同步，但盲区仍在。

## 三、根因分析（三层结构性问题）

### 第一层：硬不一致（表层）

`README.md` 的"当前版本"标注滞留 4.13.1，其余 11 处已到 4.14.1。这是手工同步过程中的遗漏，修一次即可消除，但**不解决复发机制**。

### 第二层：版本号语义违规（中层，违反 bb.md）

`.trae/rules/bb.md` 明确规定：

> 每次 bug 修复和功能修改和微量增加都算自动增加小版本号，**每次全新功能增加时候，自动增加中版本号**。

但实测发现：**v4.15.0 的全新功能已大面积落地，版本号却只递增了小版本号（4.14.0 → 4.14.1）**。

交叉检查证据（v4.15.0 代码落地范围，49 处注释）：

| 层 | 落地内容 | 文件证据 |
|---|---|---|
| 前端页面 | 玩家门户 4 个新页面（我的服务器/绑定管理/CDK兑换/我的订单）+ GuildDock 重写 + ServerDetailGuild 视觉升级 | `panel/frontend/src/pages/guild/{GuildServers,GuildBind,GuildCdk,GuildOrders,GuildDock,ServerDetailGuild}.tsx` |
| 前端 API | 玩家门户聚合 API 切片 `/api/my/*` | `panel/frontend/src/api/modules/my.ts`、`api/client.ts#L160,L794` |
| 前端样式 | 深色电竞风设计体系 | `panel/frontend/src/styles/guild-portal.css` |
| 后端路由 | 玩家门户聚合路由 `/api/my/orders` `/api/my/overview` | `panel/backend/src/api/routes/my.ts`、`routes-registry.ts#L60,L665` |
| 契约 | `panel-api-types.ts` 新增 v4.15.0 聚合类型 | `public/schema/panel-api-types.ts#L2901` |
| 测试 | 4 个 guild 页面单测 + api/client.test.ts + my.test.ts | `panel/frontend/src/pages/guild/__tests__/`、`panel/backend/src/api/routes/my.test.ts` |
| 计划文档 | 明确写"4.14.0 → 4.15.0（bb.md）" | `docs/plans/player-portal-completion-redesign-plan.md#L133,L164` |

而 `version.md` 的 4.14.1 条目标题是"配色全面 Apple 化"，**完全未记录玩家门户 4 个新页面这个核心功能**。这意味着：

1. 版本号递增违反 bb.md（新功能应 4.15.0，实际 4.14.1）
2. `version.md` 4.14.1 条目漏记 v4.15.0 功能（版本日志失真）
3. 49 处代码注释标 `v4.15.0` 与实际版本号 `4.14.1` 不符（注释漂移）

### 第三层：校验脚本盲区未闭环（深层，bug1.md 原始病灶）

bug1.md 最早指出"Daemon 运行时硬编码 `4.10.1`"问题。本次复查确认：

- `check-version-sync.ts` 已修复 README 解析（bug1.md 提到的闸门失效问题已解决）
- 但 **DAEMON_VERSION 硬编码仍不在校验范围**（`collectSources()` 硬编码 11 个来源，未含第 12 处）
- 项目文档（`version.md#L232,L372,L413,L452`、`current-note.md#L49,L207`）反复声称版本源"含 daemon DAEMON_VERSION 常量"，**文档描述与脚本实现不符**

这是 bug1.md 原始病灶的残留：校验闸门虽然能拦住"硬不一致"，但拦不住"DAEMON_VERSION 静默漂移"。只要下一次版本同步漏改 `daemon/src/index.ts:18`，就会重演 bug1.md 描述的"daemon 运行时硬编码落后"问题，且无任何告警。

## 四、执行步骤（开发事项与建议）

> 不区分优先级，仅列出开发事项。每步均标注执行位置与验证口径。

### 步骤 1 — 消除第一层硬不一致：README 当前版本同步

- 修改 `README.md` 第 12 行 `**v4.13.1**` → 与 `version.json` 当前值一致
- 同步更新"当前版本"小节的版本说明文案，使其与 `version.md` 最新条目语义对齐
- 验证口径：`npx tsx scripts/check-version-sync.ts` 输出 `✅ 版本号同步校验通过` 且 exit 0

### 步骤 2 — 消除第二层语义违规：版本号递增到 4.15.0

依据 bb.md "新功能递增中版本号"规则，因 v4.15.0 玩家门户新功能已落地，应将版本号定为 `4.15.0` 而非 `4.14.1`。执行：

- `package.json` (root) `version` → 4.15.0
- `panel/frontend/package.json` `version` + `description` → 4.15.0
- `panel/backend/package.json` `version` + `description` → 4.15.0
- `daemon/package.json` `version` + `description` → 4.15.0
- `version.json` 4 个字段 → 4.15.0
- `deploy.sh` `DEPLOY_VERSION` → 4.15.0
- `daemon/src/index.ts:18` `DAEMON_VERSION` 常量 + 第 17 行注释 → 4.15.0
- `README.md` 当前版本 → 4.15.0

> 决策建议：若已以 4.14.1 对外发布且不可收回，则保留 4.14.1 作为已发布快照，但需在 `version.md` 追加 4.15.0 条目记录玩家门户功能，并把代码注释中的 v4.15.0 与发布版本对齐。此为价值判断节点，建议人类裁决（见第六节）。

### 步骤 3 — 补全 version.md 版本日志

- 在 `version.md` 顶部新增 `## v4.15.0` 条目，标题反映"玩家门户完整重设计（4 新页面 + 聚合 API + 深色换肤）"
- 变更清单覆盖：6+ 前端页面、`/api/my/*` 后端路由、`public/schema/panel-api-types.ts` 契约扩展、guild-portal.css 设计体系、新增测试
- 将当前 4.14.1 条目（"配色 Apple 化"）保留为独立小版本记录，**不与 v4.15.0 功能混并**
- 验证口径：`version.md` 首行裸版本号 == 首个 `## vX.Y.Z` 版本号 == `version.json` 值

### 步骤 4 — 闭环第三层校验盲区：check-version-sync.ts 覆盖 DAEMON_VERSION

- 在 `scripts/check-version-sync.ts` 的 `collectSources()` 中新增第 12 个来源：解析 `daemon/src/index.ts` 中 `const DAEMON_VERSION = 'x.y.z'` 的字符串字面量
- 解析方式：正则 `/^const\s+DAEMON_VERSION\s*=\s*['"]([^'"]+)['"]/m`，与现有 `readDeployVersion` 同构
- 来源 label 建议：`daemon/src/index.ts (DAEMON_VERSION 常量)`
- 失败诊断：若解析不到（如常量被重构为从 package.json 读取），应输出明确错误而非静默跳过
- 验证口径：
  - 临时把 `daemon/src/index.ts:18` 改成与 `daemon/package.json` 不同的值，跑校验脚本应 exit 1 并列出该来源
  - 改回后 exit 0
  - 校验后**务必还原**，避免留下不一致

### 步骤 5 — 消除代码注释版本号漂移

- 全量 grep `v4.15.0` 注释（49 处），确认这些注释指向的功能确实随本次版本号发布
- 若步骤 2 将版本号定为 4.15.0，则注释与版本号一致，无需改动
- 若步骤 2 决定保留 4.14.1，则需将这些注释统一改为 `v4.14.1`（但不推荐，因违反 bb.md 语义）
- 验证口径：`grep -rn "v4.15.0" panel/ daemon/ public/ | grep -v node_modules` 的每一处都能在 `version.md` 对应条目中找到功能记录

### 步骤 6 — 建立版本源单一真相源（根治复发机制）

当前版本同步是"手工逐文件改 12 处"，易漏（本次 README 漏改即为明证）。建议建立单一真相源驱动：

- 方案 A（轻量）：在 `scripts/` 新增 `bump-version.ts`，接受目标版本号为参数，自动改写全部 12 处版本源，再跑 `check-version-sync.ts` 验证
- 方案 B（更彻底）：将 `version.json` 作为唯一真相源，`daemon/src/index.ts` 的 `DAEMON_VERSION` 改为构建期从 `daemon/package.json` 读取（`import pkg from '../package.json'`），消除硬编码常量；`check-version-sync.ts` 仍校验 12 处但其中 DAEMON_VERSION 改为校验"非常量、且等于 package.json"
- 验证口径：执行 `bump-version.ts 4.15.0` 后，12 处版本源全部一致，`check-version-sync.ts` exit 0

### 步骤 7 — 接入 npm run check 总闸

- 确认 `scripts/check-all.ts`（根目录 `npm run check`）已包含 `check-version-sync.ts`
- 若未包含，将版本同步校验作为 `check-all.ts` 的硬性子检查项，失败即整体失败
- 验证口径：临时制造一处版本不一致，`npm run check` 应整体 exit 非 0 并提示版本同步失败

### 步骤 8 — 部署前预检闭环

- 在 `deploy.sh` 的 `update`/`deploy` 流程开头调用 `npx tsx scripts/check-version-sync.ts`，版本不一致时拒绝部署
- 与 `.trae/rules/deploy.md` 的"部署前必须关闭现有部署"等规则并列
- 验证口径：制造版本不一致后执行 `bash deploy.sh update`，应在部署早期阶段中断

## 五、交叉检查清单（修复后逐项核验）

> 以下清单用于修复完成后的人类/agent 双重核验，逐项打勾方可声明闭合。

### 5.1 版本源一致性

- [ ] `npx tsx scripts/check-version-sync.ts` 输出 `✅ 版本号同步校验通过` 且 exit 0
- [ ] 校验脚本覆盖来源数 ≥ 12（含新增的 DAEMON_VERSION）
- [ ] `npm run check`（根目录）整体通过
- [ ] `grep -rn "4.13.1" --include="*.md" --include="*.json" --include="*.ts" --include="*.sh" .` 仅命中 `version.md` 历史条目（非"当前版本"语义）

### 5.2 版本号语义合规

- [ ] `version.md` 首行裸版本号 == 首个 `## vX.Y.Z` 标题版本号 == `version.json` `.version`
- [ ] `version.md` 最新条目的变更清单覆盖所有 `v<x.y.z>` 代码注释指向的功能
- [ ] bb.md 规则复核：本次版本号递增类型（大/中/小）与实际变更内容匹配（新功能→中版本号）
- [ ] 49 处 `v4.15.0` 代码注释与实际发布版本号一致（或已统一改写）

### 5.3 运行时消费链路

- [ ] `curl https://192.168.5.14:3001/api/version` 返回的 `version` == `version.json` 值（本机健康检查用 `curl http://127.0.0.1:3002/api/version`，遵守 `.trae/rules/0.md`）
- [ ] `curl .../api/version/changelog` 解析 `version.md` 不报错
- [ ] daemon 启动后，panel `nodes.daemon_version` 字段值 == `daemon/package.json` 版本（通过节点管理页或 `nodes` 表查询确认）
- [ ] 前端页面 footer/BUILD ID 显示的版本 == `version.json` 值

### 5.4 校验盲区闭环

- [ ] 临时篡改 `daemon/src/index.ts:18` 的 DAEMON_VERSION，`check-version-sync.ts` 能检出并 exit 1
- [ ] 上述验证后已还原 DAEMON_VERSION
- [ ] `deploy.sh update` 在版本不一致时拒绝继续部署

### 5.5 bug1.md 原始问题最终复核

- [ ] bug1.md 表格中 5 项 Issue 全部标注已修复且有证据
- [ ] daemon 运行时硬编码问题从"靠人工记得改"升级为"脚本强制校验"
- [ ] 版本同步流程从"手工改 12 处"升级为"单一真相源驱动或 bump 脚本统一改写"

## 六、价值判断节点（建议人类裁决）

> 依据 AC 范式 EC-7，以下节点涉及价值取舍，需人类裁决后继续。

### 节点 A：版本号定为 4.15.0 还是保留 4.14.1

- **选项 1（推荐）**：定为 4.15.0。符合 bb.md 语义，代码注释与版本号一致，`version.md` 新增 4.15.0 条目记录玩家门户功能。代价：需承认 4.14.1 的版本号递增是误判（把新功能当 bug 修复递增了小版本号）。
- **选项 2**：保留 4.14.1 已发布状态，4.15.0 作为下一版本规划。代价：需将 49 处 `v4.15.0` 代码注释改写为 `v4.14.1`，且违反 bb.md"新功能递增中版本号"规则，需在 `version.md` 说明豁免理由。
- **选项 3**：4.14.1 与 4.15.0 并列记录，4.14.1 记配色，4.15.0 记玩家门户，承认两个版本同日发布。代价：同日两个版本号违反"线性递增"惯例，且 `version.md` 首行只能取一个。

### 节点 B：版本源单一真相源方案

- **选项 1（推荐）**：方案 B（DAEMON_VERSION 改为从 package.json 读取），消除硬编码常量，根治盲区。
- **选项 2**：方案 A（bump-version.ts 脚本统一改写），保留硬编码但用脚本保证同步，改动范围小。
- **选项 3**：两者结合，既改 bump 脚本又消除 DAEMON_VERSION 硬编码。

## 七、附：复查过程中观察到的非阻塞项

> 以下不属版本漂移问题，但复查中发现，记录备查。

1. `panel/backend/src/services/nodeService.test.ts:40,64,91` 的 mock 数据 `daemon_version: '4.10.1'` 陈旧，建议在后续测试维护中同步到当前版本号（非版本源，不影响运行时）
2. `panel/frontend/src/mocks/handlers.ts` 与 `Login.test.tsx` 中的 `v4.13.1` 注释属功能引入标记，非版本声明，可保留
3. `backup/` 目录下存在多个历史版本快照（如 `backup/v4.11.0-pre-release-20260724-004342/daemon/src/index.ts` 含 `DAEMON_VERSION = '4.10.1'`），grep 版本号时需排除 `backup/` 以免误判
