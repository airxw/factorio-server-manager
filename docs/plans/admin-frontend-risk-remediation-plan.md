---
type: plan
title: "/admin 前端梳理审计修复方案"
date: 2026-07-26
status: draft
related:
  - docs/frontend/pages/admin-*.md
  - docs/frontend/flows/flow-admin-*.md
  - docs/frontend/logs/2026-07-26.md
  - panel/frontend/src/pages/admin/
  - panel/frontend/src/pages/Profile.tsx
  - panel/frontend/src/pages/PlayerVerify.tsx
  - panel/frontend/src/pages/AlertSettings.tsx
  - panel/backend/src/api/routes/
  - public/schema/
tags: [admin, frontend, audit, risk-remediation, security, ux]
---

# `/admin` 前端梳理审计修复方案

> 本方案基于 [docs/frontend/logs/2026-07-26.md](../frontend/logs/2026-07-26.md) 主线程汇总段与 23 篇页面文档 + 4 篇流程文档中标注的 200 条 `[RISK]`/`[TODO]` 条目编制。
> 按用户规则：方案编制不计人力工期与开发投入，不区分优先级，仅输出执行步骤、开发事项与建议。

## 一、修复总览

### 1.1 范围

- **审计来源**：[docs/frontend/pages/](../frontend/pages/) 下 23 篇 `admin-*.md` + [docs/frontend/flows/](../frontend/flows/) 下 4 篇 `flow-admin-*.md`
- **条目总数**：200 条（RISK 110 + TODO 90）
- **优先级分布**：P0 × 31 / P1 × 32 / P2 × 137
- **难度分布**：S × 105 / M × 80 / L × 15
- **主题聚类**：8 个跨页面主题（见下文执行批次）

### 1.2 修复原则

1. **P0 优先**：安全/数据丢失/线上故障 31 条全部修复，其中 11 条 S 难度可单批完成
2. **主题归并**：同类问题跨页面统一修复，避免分散改动
3. **契约优先**：涉及类型契约变更走 s0601 流程，不直接编辑 `public/`
4. **后端兜底**：所有前端安全校验必须有后端二次校验，前端校验仅做 UX
5. **不破坏现有**：所有修改走渐进式，保留旧接口至少一个版本兼容期

### 1.3 修复批次划分（8 批，对应 8 个主题）

| 批次 | 主题 | 涉及条目 | 优先级 | 难度 | 主要文件 |
|------|------|----------|--------|------|----------|
| B1 | 明文展示敏感凭证 | 7 条 | P0 | S-M | Tunnel/ApiKeys/Webhooks/SystemConfig/Settings/SSL/AlertSettings |
| B2 | 破坏性操作无 dry-run | 4 条 | P0 | M | SSL/Maintenance/Cleanup/Packs |
| B3 | 后端鉴权不足 | 5 条 | P0 | S-M | system-health/alert-settings/apiKeys/nodes |
| B4 | `window.confirm` 统一 | 6 条 | P2 | S | SystemConfig/Webhooks/Profile/PlayerBindings/Nodes/Servers |
| B5 | 列表分页/虚拟化 | 10+ 条 | P1-P2 | M-L | Users/Webhooks/PlayerBindings/Notifications/Nodes/AuditLogs/Cleanup |
| B6 | `ServerDetail` 跨路由复用拆分 | 4 条 | P1 | L | ServerDetail/Admin/Store/Guild |
| B7 | 类型契约漂移治理 | 5 条 | P1-P2 | M | client.ts/modules/settings.ts/SystemConfig/Settings |
| B8 | `Promise.all` 单点失败 | 3 条 | P1 | S-M | Tunnel/Platform/Dashboard |
| B9 | 其他散落 P1/P2 | 150+ 条 | P1-P2 | S-M | 各页面零散条目 |

---

## 二、执行批次详解

### 批次 B1：明文展示敏感凭证（P0 安全）

**目标**：消除 6 类敏感数据的明文展示，引入统一 `SensitiveInput` 组件 + 后端加密存储 + 响应脱敏。

#### 开发事项

1. **抽象通用组件 `<SensitiveInput>`**
   - 路径：`panel/frontend/src/components/ui/SensitiveInput.tsx`
   - 能力：`type="password"` 默认 + 👁 切换显示 + 📋 复制按钮 + `autocomplete="off"` + `autoCorrect="off"`
   - Props：`value` / `onChange` / `placeholder` / `disabled` / `revealable`(默认 true) / `copyable`(默认 true)

2. **Tunnel token 改造**（[TunnelManagement.tsx](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/admin/TunnelManagement.tsx)）
   - token input 改用 `<SensitiveInput revealable>`
   - 后端 `GET /api/admin/tunnel` 响应 token 字段返回 `***` 占位，前端通过 `GET /api/admin/tunnel/:id/token?reveal=true` 按需拉取（需二次确认）

3. **API Key 显示改造**（[ApiKeys.tsx](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/admin/ApiKeys.tsx)）
   - 创建 Modal 中明文 key 改用 `<SensitiveInput revealable copyable>`
   - 后端 `POST /api/admin/api-keys` 响应体中 `key` 字段加 `Cache-Control: no-store` + `Pragma: no-cache`
   - 列表查询时 `key` 字段返回前 4 位 + `****` + 后 4 位掩码

4. **Webhook Secret 改造**（[Webhooks.tsx](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/admin/Webhooks.tsx)）
   - Secret input 改用 `<SensitiveInput revealable>`
   - 后端 `GET /api/servers/:serverId/webhooks` 响应中 `secret` 字段返回 `***` 占位
   - 新增 `GET /api/servers/:serverId/webhooks/:id/secret?reveal=true` 按需拉取
   - 补「重置 Secret」按钮（替代「忘记只能删除重建」）

5. **SMTP 密码脱敏**（[SystemConfig.tsx](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/admin/SystemConfig.tsx) + [Settings.tsx](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/admin/Settings.tsx)）
   - 后端 `GET /api/system-config` 与 `GET /api/settings` 响应中识别 `*.password` / `*.secret` / `*.smtp_password` 字段返回 `***`
   - 前端 schema 标记 `sensitive: true` 的字段自动用 `<SensitiveInput>` 渲染
   - 编辑时若值仍为 `***` 则不提交该字段（保留原值）

6. **SSL PEM/KEY 改造**（[SslManagement.tsx](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/admin/SslManagement.tsx)）
   - textarea 改为 `<SensitiveInput revealable multiline>`（多行模式）
   - 上传成功后立即清空 input value，避免浏览器自动填充历史记录私钥
   - 后端 `POST /api/admin/ssl/certificates` 响应不回显 private_key

7. **Alert Webhook URL 改造**（[AlertSettings.tsx](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/AlertSettings.tsx)）
   - webhook_url input 改用 `<SensitiveInput revealable>`
   - 后端 `PUT /api/alert-settings` 时若 webhook_url 为 `***` 则保留原值
   - 数据库对 webhook_url 字段加密存储（AES-256-GCM，密钥从 `.env` 读取）

#### 验证清单

- [ ] 6 类敏感字段在浏览器 DevTools Network 面板均不可见明文
- [ ] 6 类字段在 UI 上默认隐藏，需点击眼睛图标才显示
- [ ] `<SensitiveInput>` 单元测试覆盖（reveal/copy/disabled/autocomplete）
- [ ] 后端单元测试覆盖（敏感字段响应脱敏 + 加密存储 + 按需 reveal 接口）

---

### 批次 B2：破坏性操作无 dry-run 预览（P0 数据丢失）

**目标**：4 个高破坏性操作统一接入 dry-run 预览 + 二次确认 + 回滚能力。

#### 开发事项

1. **抽象 `useDestructiveAction` hook**
   - 路径：`panel/frontend/src/hooks/useDestructiveAction.ts`
   - 能力：`preview()` → 拿到将删除的资源清单 → `<ConfirmDialog>` 展示清单 → `execute()` 执行 → 失败回滚
   - 接口契约：
     ```ts
     interface DestructiveAction<TPreview, TArgs> {
       preview(args: TArgs): Promise<TPreview>;
       execute(args: TArgs): Promise<void>;
       rollback?(args: TArgs): Promise<void>;
     }
     ```

2. **SSL deploy 改造**（[SslManagement.tsx](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/admin/SslManagement.tsx) + [ssl.ts](file:///home/airxw/Documents/gsp/gameserver-panel/panel/backend/src/api/routes/ssl.ts)）
   - 后端新增 `POST /api/admin/ssl/deploy/preview`：返回当前证书指纹 + 新证书指纹 + nginx 配置语法检查结果
   - 后端新增 `POST /api/admin/ssl/rollback`：回滚到上一份证书（保留最近 3 份证书备份）
   - 前端 deploy 按钮先调 preview → ConfirmDialog 展示「当前证书 → 新证书」对比 → 用户输入 `CONFIRM` → 执行 deploy
   - deploy 失败自动触发 rollback + Toast 提示

3. **Maintenance 一键清理改造**（[Maintenance.tsx](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/admin/Maintenance.tsx) + [maintenance.ts](file:///home/airxw/Documents/gsp/gameserver-panel/panel/backend/src/api/routes/maintenance.ts)）
   - 后端新增 `POST /api/admin/maintenance/cleanup-all/preview`：返回将删除的表 + 行数 + 总大小
   - 前端一键清理按钮先调 preview → ConfirmDialog 展示「将清理 N 张表，共 M 行，释放 X GB」→ 用户输入 `CONFIRM` → 执行
   - 清理结果持久化到 `last_cleanup_result` 字段，刷新页面后仍可查看

4. **Cleanup 实例删除改造**（[CleanupPage.tsx](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/CleanupPage.tsx) + [SafeRemoveService](file:///home/airxw/Documents/gsp/gameserver-panel/panel/backend/src/services/SafeRemoveService.ts)）
   - 后端 `DELETE /api/admin/cleanup/:id` 增加 `?dry_run=true` 参数：返回将删除的文件路径 + 大小 + DB 记录
   - 前端删除按钮先调 dry_run → ConfirmDialog 展示「将删除目录 /xxx/xxx (1.2 GB) + DB 记录」→ 确认后执行

5. **Pack 删除改造**（[Packs.tsx](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/admin/Packs.tsx) + [packs.ts](file:///home/airxw/Documents/gsp/gameserver-panel/panel/backend/src/api/routes/packs.ts)）
   - 后端 `DELETE /api/packs/:id` 增加 `?dry_run=true`：返回将被删除的目录 + 依赖该 Pack 的实例列表
   - 前端删除按钮先调 dry_run → ConfirmDialog 展示「将删除 Pack 目录 + 警告：N 个实例正在使用此 Pack」→ 若有依赖实例则禁止删除

#### 验证清单

- [ ] 4 个破坏性操作均有 dry-run 预览步骤
- [ ] SSL deploy 失败自动 rollback 验证通过
- [ ] Maintenance 清理结果持久化验证
- [ ] Cleanup 删除预览展示文件路径 + 大小
- [ ] Pack 删除有依赖实例检测

---

### 批次 B3：后端鉴权不足（P0 安全）

**目标**：5 个鉴权缺口补齐，前端软阻断改硬阻断。

#### 开发事项

1. **`/api/system/*` 补 `requireAdmin`**（[systemMetricsRoute.ts](file:///home/airxw/Documents/gsp/gameserver-panel/modules/模块1_系统监控/systemMetricsRoute.ts) + [system-health.ts](file:///home/airxw/Documents/gsp/gameserver-panel/panel/backend/src/api/routes/system-health.ts)）
   - `/api/system/metrics` / `/api/system/health` / `/api/system/diagnostics` 全部加 `requireAdmin` 中间件
   - 前端 `useAuth().user.role` 为 `user` 时不调用这些接口（避免无谓 403）

2. **Alert 邮箱通道后端二次校验**（[alert-settings.ts](file:///home/airxw/Documents/gsp/gameserver-panel/panel/backend/src/api/routes/alert-settings.ts)）
   - `PUT /api/alert-settings` 时若 `email_enabled=true`，后端查询 `users.email_verified` 字段
   - 未验证时返回 403 `ALERT_EMAIL_NOT_VERIFIED`
   - 前端移除 client 层的 `emailVerified` 软阻断，改为后端错误码驱动

3. **API Key 撤销硬校验**（[apiKeys.ts](file:///home/airxw/Documents/gsp/gameserver-panel/panel/backend/src/api/routes/apiKeys.ts)）
   - 鉴权中间件 `authenticateApiKey` 显式校验 `revoked_at IS NULL`
   - 数据库索引 `WHERE revoked_at IS NULL` 提升查询性能
   - 前端撤销操作 Toast 改为成功提示 + 列表立即移除（不再乐观更新）

4. **Nodes bootstrap-script IP 限制**（[nodes.ts](file:///home/airxw/Documents/gsp/gameserver-panel/panel/backend/src/api/routes/nodes.ts)）
   - `GET /api/nodes/invite/:linkKey/bootstrap-script` 增加 IP 白名单（可配置 `NODE_INVITE_IP_WHITELIST`）
   - 或改为一次性下载（下载后 linkKey 标记 `downloaded_at`，二次下载需重新生成 linkKey）

5. **Nodes 删除前 dry-run**（[Nodes.tsx](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/admin/Nodes.tsx) + nodes.ts）
   - 后端 `DELETE /api/nodes/:id` 增加 `?dry_run=true`：返回该节点上的活跃实例数
   - 前端删除按钮先调 dry_run → 若有活跃实例则禁止删除并提示

#### 验证清单

- [ ] 普通用户直接调用 `/api/system/metrics` 返回 403
- [ ] 未验证邮箱用户启用 Alert 邮箱通道返回 403
- [ ] 已撤销 API Key 调用受保护接口返回 401
- [ ] Nodes bootstrap-script 二次下载失败（或配置 IP 白名单生效）
- [ ] Nodes 删除有活跃实例时前端禁止 + 后端 409

---

### 批次 B4：`window.confirm` 统一为 `useConfirm`（P2 一致性）

**目标**：6 个页面的 `window.confirm` 全部替换为 `<ConfirmDialog>` 组件。

#### 开发事项

1. **抽象 `<ConfirmDialog>` 组件**（如已存在则复用）
   - 路径：`panel/frontend/src/components/ui/ConfirmDialog.tsx`
   - 能力：标题 + 描述 + 确认按钮文案 + 取消按钮文案 + 危险操作红色按钮 + 输入 `CONFIRM` 二次确认（可选）
   - 配套 `useConfirm()` hook 返回 `[confirm, ConfirmDialogComponent]`

2. **6 个页面替换**：
   - [SystemConfig.tsx](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/admin/SystemConfig.tsx) 删除配置
   - [Webhooks.tsx](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/admin/Webhooks.tsx) 删除 Webhook
   - [Profile.tsx](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/Profile.tsx) 解绑实例
   - [PlayerBindings.tsx](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/admin/PlayerBindings.tsx) 解绑玩家
   - [Nodes.tsx](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/admin/Nodes.tsx) 重新邀请 / 删除节点
   - [Servers.tsx](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/Servers.tsx) 批量启动/停止/重启/备份

3. **移动端适配**
   - ConfirmDialog 移动端改为底部 Sheet 样式（与 iOS Action Sheet 一致）
   - 触摸目标 ≥ 44px

#### 验证清单

- [ ] 6 个页面 `window.confirm` 调用全部移除（grep 验证）
- [ ] ConfirmDialog 移动端 Sheet 样式验证
- [ ] 危险操作按钮红色高亮

---

### 批次 B5：列表分页/虚拟化（P1-P2 性能）

**目标**：8 个列表页统一接入分页 + 虚拟滚动。

#### 开发事项

1. **抽象 `<PaginationTable>` 组件**
   - 路径：`panel/frontend/src/components/ui/PaginationTable.tsx`
   - 能力：服务端分页（page/page_size）+ 排序 + 筛选 + CSV 导出 + 移动端卡片视图
   - Props：`columns` / `fetchData` / `defaultPageSize` / `mobileCardRender`

2. **抽象 `<VirtualList>` 组件**
   - 路径：`panel/frontend/src/components/ui/VirtualList.tsx`
   - 能力：基于 `react-window` 的虚拟滚动，支持动态高度
   - 用于：通知列表、用户列表（移动端卡片视图）

3. **后端补分页参数**（8 个接口）
   - `GET /api/users` 加 `page` / `page_size`（默认 20，最大 100）
   - `GET /api/servers/:serverId/webhooks` 加分页
   - `GET /api/servers/:serverId/player-bindings` 加分页
   - `GET /api/notifications` 加分页
   - `GET /api/nodes` 加分页
   - `GET /api/audit-logs` 加 `page`（当前仅 limit）
   - `GET /api/admin/cleanup` 全部实例概览加分页
   - `GET /api/admin/assets` 加分页

4. **8 个页面接入**
   - [Users.tsx](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/admin/Users.tsx)：`listUsers` 改服务端分页 + keyword 服务端搜索
   - [Webhooks.tsx](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/admin/Webhooks.tsx)：Webhook 列表分页
   - [PlayerBindings.tsx](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/admin/PlayerBindings.tsx)：绑定列表分页
   - [NotificationsPage.tsx](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/NotificationsPage.tsx)：通知列表分页 + 虚拟滚动
   - [Nodes.tsx](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/admin/Nodes.tsx)：节点列表分页
   - [AuditLogs.tsx](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/admin/AuditLogs.tsx)：补分页 UI（page + page_size）
   - [CleanupPage.tsx](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/CleanupPage.tsx)：全部实例概览分页
   - [Users.tsx](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/admin/Users.tsx) 移动端卡片视图接入 `<VirtualList>`

#### 验证清单

- [ ] 8 个接口均支持 `page` / `page_size` 参数
- [ ] 8 个页面分页 UI 一致（底部分页器 + 页码跳转）
- [ ] 移动端卡片视图虚拟滚动性能验证（1000 条数据流畅滚动）
- [ ] 服务端 keyword 搜索验证（Users）

---

### 批次 B6：`ServerDetail` 跨路由复用拆分（P1 架构）

**目标**：拆分 `ServerDetail` 为 3 个独立组件，消除跨路由复用导致的角色边界模糊。

#### 开发事项

1. **现状分析**
   - [ServerDetail.tsx](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/admin/ServerDetailAdmin.tsx) 当前被 3 个路由复用：`/instances/:id` / `/admin/servers/:id` / `/store/servers/:id`
   - 任何修改影响所有视图，且两套视图无实质差异

2. **拆分方案**
   - 保留 `ServerDetailCore` 作为共享底层（数据加载 + WS 订阅 + 基础 Tab 框架）
   - 拆出 3 个角色化包装组件：
     - `ServerDetailAdmin`（[ServerDetailAdmin.tsx](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/admin/ServerDetailAdmin.tsx)）：默认展示「系统监控」「部署命令」「审计日志」「业务运营」Tab
     - `ServerDetailStore`（[ServerDetailStore.tsx](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/store/ServerDetailStore.tsx)）：默认展示「店铺外观」「商品管理」「VIP 用户」Tab
     - `ServerDetailGuild`（[ServerDetailGuild.tsx](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/guild/ServerDetailGuild.tsx)）：默认展示「店铺首页」「商品列表」Tab
   - 路由层不再共享，每个路由显式 import 对应组件

3. **入口修复**
   - [Servers.tsx](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/Servers.tsx) 列表点击实例跳转目标按角色分流：
     - `server_admin` → `/admin/servers/:id`
     - `instance_admin` → `/store/servers/:id`
     - `user` → `/guild/servers/:id`
   - 「← 返回列表」按钮按角色跳转对应列表

4. **`__business__` pseudo-tab 修复**
   - 跳转目标改为按角色基座：`/admin/servers/:id/business` / `/store/servers/:id/business` / `/guild/servers/:id/business`

5. **类型契约修复**
   - `BASE_USER_TAB_OBJECTS` 中 `admins` / `roles` 不再用 `as unknown as` 绕过 `InstanceTabSchema` 枚举
   - 走 s0601 契约变更流程：在 `public/schema/instance-tabs.ts` 中扩展枚举值

#### 验证清单

- [ ] 3 个角色化组件独立存在，无共享代码
- [ ] 列表点击按角色跳转正确路由
- [ ] 「← 返回列表」按角色跳转
- [ ] `__business__` 跳转目标按角色基座
- [ ] 类型契约变更走 s0601 流程（public/schema/ 修改有 human authorization）

---

### 批次 B7：类型契约漂移治理（P1-P2 契约）

**目标**：5 处类型契约漂移统一治理，所有枚举/默认值/范围改为后端 schema 动态拉取。

#### 开发事项

1. **`SettingSchemaItem` 统一**（[client.ts](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/api/client.ts) + [modules/settings.ts](file:///home/airxw/Documents/gsp/gameserver-panel/panel/backend/src/modules/settings.ts)）
   - 走 s0601 契约变更流程：在 `public/schema/settings.ts` 中统一定义 `SettingSchemaItem`
   - 前后端均从 `public/schema/` import，删除各自的本地定义
   - `group` 集合对齐为后端的 10 个（前端 6 个改为 10 个）

2. **`GROUP_LABELS` / `GROUP_ORDER` 改为后端拉取**
   - 后端 `GET /api/settings/schema` 响应中包含 `group_labels` 和 `group_order`
   - 前端删除硬编码常量，启动时拉取 schema

3. **SystemConfig 预定义 Key 改为后端拉取**
   - 后端 `GET /api/system-config/schema` 返回预定义 Key 列表 + 默认值 + 描述 + 是否 sensitive
   - 前端删除硬编码 `PREDEFINED_KEYS`，从 schema 动态渲染

4. **`retention_days` 范围改后端校验**
   - 后端 `PUT /api/admin/maintenance/retention` 返回 422 时包含 `min` / `max` 字段
   - 前端从错误响应中读取范围，动态设置 input 的 min/max

5. **`InstanceTabSchema` 枚举扩展**（与 B6 协同）
   - 走 s0601 流程在 `public/schema/instance-tabs.ts` 中扩展 `admins` / `roles` 等枚举值
   - 前端删除 `as unknown as` 类型断言

#### 验证清单

- [ ] `SettingSchemaItem` 在前后端只有一处定义（`public/schema/`）
- [ ] `group` 集合一致（10 个）
- [ ] SystemConfig 预定义 Key 从后端拉取
- [ ] `retention_days` 范围从后端读取
- [ ] `InstanceTabSchema` 枚举扩展通过 s0601 流程

---

### 批次 B8：`Promise.all` 单点失败改造（P1 容错）

**目标**：3 个页面改为 `Promise.allSettled` 按字段降级。

#### 开发事项

1. **[TunnelManagement.tsx](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/admin/TunnelManagement.tsx)**
   - `Promise.all([getStatus, getConfig, getLogs])` 改为 `Promise.allSettled`
   - status 失败 → status 区显示「加载失败」+ 重试按钮
   - config 失败 → config 区显示「加载失败」+ 重试按钮
   - logs 失败 → logs 区显示「加载失败」+ 重试按钮（不影响其他区）

2. **[PlatformDashboard.tsx](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/admin/PlatformDashboard.tsx)**
   - `Promise.all([getOverview, getUsers, getRevenue, getDiskTop])` 改为 `Promise.allSettled`
   - 每个 KPI 卡片独立处理失败状态（显示「—」+ 重试按钮）

3. **[AdminDashboard.tsx](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/admin/AdminDashboard.tsx) + 后端 `getPlatformOverview`**
   - 后端 `getPlatformOverview` 改为按字段独立查询 + 失败字段返回 `null` + `errors` 数组
   - 前端按字段渲染，失败字段显示「—」+ 重试按钮

#### 验证清单

- [ ] 3 个页面单接口失败不影响其他接口数据展示
- [ ] 失败字段有「重试」按钮
- [ ] 后端 `getPlatformOverview` 部分失败时仍返回 200 + `errors` 数组

---

### 批次 B9：其他散落 P1/P2 条目（150+ 条）

**目标**：处理 8 个主题外的散落条目，按页面归并修复。

#### 开发事项（按页面分组）

**admin-profile.md（11 条）**
- 改密成功后强制跳转 `/login` + 多 Tab 同步登出（通过 WS 推送 `auth.invalidated` 事件）
- Demo 账号判定改用后端 `user.is_demo` 字段
- 钱包查询失败显示「加载失败」badge + 重试
- `bindInstance` 4xx 错误码完整映射
- 「可绑定实例」表格加搜索/过滤

**admin-profile-verify.md（10 条）**
- 倒计时改为 `setInterval` 每秒更新（修复 UX bug）
- 验证码卡片加「复制」按钮
- 服务器下拉加搜索/过滤
- 验证码列表分页/折叠
- 409 `VERIFY_CODE_ACTIVE_EXISTS` 错误码映射
- `listMyVerifyCodes` 失败显示 toast + retry
- 维护模式下 `/api/verify-codes/generate` 加入豁免清单
- 验证码有效期改为 10 分钟（或增加「延长有效期」接口）

**admin-server-detail.md（10 条）**
- `cancelledRef` 改为 AbortController
- `infoExpanded` 按实例 ID 区分存储
- `useSwipe` 限制为移动端
- `RconConsole` 多 Tab 限流（后端 WS 连接数限制）
- `visibleTabs` 在 WS 断线时 fallback 到 `server?.status`
- `cleanupSubdir` 409 错误码专门映射

**admin-system-health.md（6 条）**
- 补 `useDocumentTitle('系统监控')`
- Tab 切换改为 `replace: false`（入历史栈）
- `nodeDiskUsages` 加 `key` 唯一性防御
- Sparkline 改 `preserveAspectRatio="xMidYMid meet"`
- RealtimeMonitorPanel events 用环形缓冲区替代 `slice(-1800)`
- `listNodes` + N+1 改后端聚合 `/api/nodes/disk-usage`

**admin-notifications.md（6 条）**
- `listNotifications` 失败显示 toast + retry
- `TYPE_LABEL` 增加「未知类型」占位
- 顶部展示 `unread_count`
- `listNotifications` 传 AbortController signal
- `goBack` 改为 `navigate(-1)` 而非基座固定路径
- markRead 失败回滚 + toast 提示
- 接入 WS 推送新通知

**admin-settings.md（6 条）**
- `SettingInput` toggle 加「未保存」标识
- 删除「v3.8.0+ 后端未启用」历史文案
- 分组级「全部保存」按钮
- 移动端手风琴展开状态持久化到 URL
- `GROUP_LABELS` 改后端拉取（与 B7 协同）
- `json` 类型接入 CodeMirror + 保存前 JSON 合法性校验

**admin-platform.md（5 条）**
- 收入趋势曲线加时间范围切换（24h/7d/30d）
- 磁盘 TopN 表格加分页/排序
- `LineChart` 改 `preserveAspectRatio="xMidYMid meet"`
- KPI 卡片样式统一为 Tailwind `bg-white rounded-xl`
- 自研 SVG 图表接入 ECharts/Recharts

**admin-audit-logs.md（7 条）**
- limit input 强制 max=1000
- CSV 导出加 Safari 隐私模式兜底（提示用户手动复制）
- 详情弹窗 before/after 字段名改后端返回
- `limit` 默认值写入 URL
- `datetime-local` 改为统一日期选择器组件
- 过滤表单加「重置」按钮
- 详情弹窗展示 `user_id` 关联的用户名/邮箱

**admin-users.md（5 条）**
- 软删除后从列表移除（不再依赖刷新）
- 统计卡片失败加重试按钮
- 新建用户 modal 邮箱格式服务端校验回显
- 批量改角色为「覆盖式」增加输入 `CONFIRM` 二次确认
- 移动端卡片视图接入虚拟滚动（与 B5 协同）

**admin-api-keys.md（4 条）**
- 列表加搜索/过滤（name / user / role / 状态）
- 表格展示 `last_used_ip`
- 创建表单 user 下拉 join 用户名
- `expires_at` 增加「强制最大过期时间」配置项

**admin-packs.md（5 条）**
- 补 `useDocumentTitle('Pack 管理')`
- 新建弹窗「游戏类型」下拉 onChange 真正预填到 YAML
- `reloadResult.failed` 错误信息脱敏（不展示文件系统路径）
- `authHeaders()` 改用 `useAuth().api` 统一鉴权（关键：修复 token 不刷新 bug）
- YAML 编辑器升级为 CodeMirror

**admin-system-config.md（5 条）**
- 配置分类支持「未分类」聚合 Tab
- PUT `/system-config/:key` 前端做重复 key 检查
- 配置项变更历史入口（跳转 audit-logs 带 filter）
- 删除走 ConfirmDialog（与 B4 协同）
- 敏感配置脱敏（与 B1 协同）

**admin-webhooks.md（7 条）**
- 事件类型下拉候选 + 自动补全
- 测试投递结果展示响应体
- 服务器下拉显示节点/游戏类型元信息
- 测试弹层改为 Modal
- Webhook 投递历史记录查看
- 启用切换失败回滚
- 表格移动端 `mobile-card-list` 双视图

**admin-player-bindings.md（5 条）**
- 服务器下拉显示节点/游戏类型元信息
- 加 `verify_status` / `player_name` / `username` 过滤搜索
- 表格移动端 `mobile-card-list` 双视图
- 解绑走 ConfirmDialog（与 B4 协同）
- 支持查看绑定详情（verify_token / 玩家 ID）

**admin-tunnel.md（5 条）**
- 日志区加「自动刷新」开关
- 配置编辑加「未保存提示」+ `beforeunload` 警告
- 启停操作加二次确认 Modal
- 保存配置后强提示「需手动启动 frpc」
- 隧道列表加拖拽排序 + 导入导出

**admin-ssl.md（3 条）**
- 证书过期预警接入告警系统（Webhook/邮件）
- 暂存证书区列表持久化
- PEM/KEY 改 `SensitiveInput`（与 B1 协同）

**admin-cleanup.md（4 条）**
- 顶部加 alert-info 说明「待清理」判定规则
- 「确认删除」按钮加 ConfirmDialog（与 B4 协同）
- `badge-${inst.status}` 加默认样式 fallback
- 孤儿实例（`owner_username='未知'`）标红提示

**admin-maintenance.md（4 条）**
- chat_logs retention 后端返回真实值（不再固定 7）
- 上次清理结果持久化到 localStorage 或后端字段
- 顶部状态徽章改为后端返回真实 `scheduler_enabled`
- retention 编辑输入框实时 max/min 校验

**admin-quotas.md（5 条）**
- `openEditUser` 失败显示 toast + 不打开 Modal
- `parseNum` 空字符串改为保留原值（不转为 null）
- 用户配额保存后刷新当前用户配额
- `max_disk_mb` 单位明确标注
- 用户列表加分页大小切换

**admin-servers.md（6 条）**
- 页面标题与 `useDocumentTitle` 统一为「实例」
- CSV 导出加时间戳 + 「导出全部」选项
- 批量操作统一用 ConfirmDialog（与 B4 协同）
- URL 状态化改为 `replace: false`
- `invalidateQueries` 失败加 retry
- 配额进度条 `null` 时显示「不限」+ usage

**admin-profile-alerts.md（7 条）**
- 保存按钮 sticky footer
- 规则卡片抽象为通用 CSS 类
- 加「重置为上次保存」按钮
- 规则搜索/过滤
- 接入 `listAlertEvents` 展示「最近告警事件」预览
- 测试 Webhook 加 debounce
- `useToast` 统一为 `components/ui` 版本

**admin-dashboard.md（3 条）**
- KPI 卡片「今日收入/30 天收入」跳转 `/store/reports/revenue`
- `listGlobalAssets` 403 时显示「权限不足」
- 接入实时刷新（30s 轮询或 WS）

#### 验证清单

- [ ] 每个页面的 P1/P2 条目逐项修复
- [ ] 修复后 grep 验证无遗留 `window.confirm` / `localStorage.getItem('panel_token')` / `as unknown as` 等反模式
- [ ] 浏览器核对所有页面渲染正常

---

## 三、跨批次协同事项

### 3.1 s0601 契约变更流程（B6 + B7 协同）

涉及 `public/schema/` 修改的批次必须走 s0601 流程：

1. **B6**：`public/schema/instance-tabs.ts` 扩展 `admins` / `roles` 枚举
2. **B7**：`public/schema/settings.ts` 统一 `SettingSchemaItem` 定义

执行顺序：先调用 Skill `s0601-adapting-contract-changes` → 识别影响面 → 拆解同步任务 → 阻断条件判断 → 执行适配 → 验证。

### 3.2 后端接口新增汇总

| 批次 | 新增接口 | 方法 | 用途 |
|------|---------|------|------|
| B1 | `/api/admin/tunnel/:id/token?reveal=true` | GET | 按需拉取 token |
| B1 | `/api/servers/:serverId/webhooks/:id/secret?reveal=true` | GET | 按需拉取 Secret |
| B1 | `/api/servers/:serverId/webhooks/:id/secret` | POST | 重置 Secret |
| B2 | `/api/admin/ssl/deploy/preview` | POST | SSL 部署预览 |
| B2 | `/api/admin/ssl/rollback` | POST | SSL 回滚 |
| B2 | `/api/admin/maintenance/cleanup-all/preview` | POST | 清理预览 |
| B2 | `DELETE /api/admin/cleanup/:id?dry_run=true` | DELETE | 删除预览 |
| B2 | `DELETE /api/packs/:id?dry_run=true` | DELETE | 删除预览 |
| B3 | `DELETE /api/nodes/:id?dry_run=true` | DELETE | 删除预览 |
| B5 | 8 个列表接口加 `page` / `page_size` | GET | 分页 |
| B7 | `/api/settings/schema` | GET | 拉取 schema |
| B7 | `/api/system-config/schema` | GET | 拉取预定义 Key |
| B8 | `getPlatformOverview` 改为按字段独立查询 | GET | 部分降级 |

### 3.3 前端通用组件抽象汇总

| 组件 | 路径 | 用途 | 涉及批次 |
|------|------|------|----------|
| `<SensitiveInput>` | `components/ui/SensitiveInput.tsx` | 敏感字段输入 | B1 |
| `useDestructiveAction` | `hooks/useDestructiveAction.ts` | 破坏性操作 hook | B2 |
| `<ConfirmDialog>` + `useConfirm` | `components/ui/ConfirmDialog.tsx` | 统一确认弹窗 | B2 + B4 |
| `<PaginationTable>` | `components/ui/PaginationTable.tsx` | 分页表格 | B5 |
| `<VirtualList>` | `components/ui/VirtualList.tsx` | 虚拟滚动 | B5 |

### 3.4 数据库迁移事项

| 批次 | 迁移内容 | 风险 |
|------|---------|------|
| B1 | `alert_settings.webhook_url` 加密存储 | 需读取现有明文 → 加密 → 写回 |
| B1 | `api_keys.key` 字段掩码存储（仅展示前 4 + 后 4） | 已有 Key 需迁移 |
| B3 | `api_keys` 索引 `WHERE revoked_at IS NULL` | 在线 DDL，需评估锁表风险 |
| B5 | 8 个列表接口加分页参数 | 无 DB 变更，仅 SQL 改造 |

### 3.5 配置项新增

| 配置项 | 路径 | 用途 | 默认值 |
|--------|------|------|--------|
| `NODE_INVITE_IP_WHITELIST` | `.env` | Nodes bootstrap-script IP 白名单 | 空（不限制） |
| `API_KEY_MAX_EXPIRY_DAYS` | `.env` | API Key 最大过期天数 | 365 |
| `ALERT_WEBHOOK_TEST_DEBOUNCE_MS` | `.env` | Alert Webhook 测试 debounce | 5000 |

---

## 四、执行建议

### 4.1 执行顺序建议

```
B1（敏感凭证）→ B3（后端鉴权）→ B2（dry-run）→ B4（确认弹窗）→ B8（容错）→ B7（契约）→ B6（ServerDetail 拆分）→ B5（分页）→ B9（散落）
```

**理由**：
- B1 + B3 为纯安全修复，独立性强，优先完成可立即降低安全风险
- B2 依赖 B1 的 `useDestructiveAction` 抽象（与 `<ConfirmDialog>` 共用）
- B4 为纯 UI 一致性，可在 B2 后顺带完成
- B8 为纯前端容错，独立性强
- B7 + B6 涉及契约变更，需走 s0601 流程，建议协同执行
- B5 涉及前后端协同 + 通用组件抽象，工作量最大，放后
- B9 为散落条目，最后批量处理

### 4.2 版本规划建议

按项目版本号规则（x.x.x）：

| 版本 | 内容 |
|------|------|
| v4.x.1 | B1 + B3（安全修复） |
| v4.x.2 | B2 + B4 + B8（数据安全 + 一致性 + 容错） |
| v4.(x+1).0 | B6 + B7（架构重构 + 契约治理，中版本号 +1） |
| v4.(x+1).1 | B5（分页性能优化） |
| v4.(x+1).2 | B9（散落条目收尾） |

### 4.3 测试要求

每个批次完成前必须通过：

1. **单元测试**：新增组件/hook/服务覆盖率 ≥ 80%
2. **E2E 测试**：Playwright 覆盖关键路径（登录 → 操作 → 验证）
3. **Mock 回归**：MSW 覆盖 API 失败场景（401/403/500/网络错误）
4. **浏览器核对**：在 `https://gsp.ecsrz.com:3001/admin/*` 实际访问验证
5. **独立审查**：每个批次完成时调用 GN-004 能力做交付前审查

### 4.4 文档维护

- 每个批次完成时更新对应 `docs/frontend/pages/admin-*.md` 的「待办与风险」段（标记已修复条目）
- 每个批次完成时在 `docs/frontend/logs/YYYY-MM-DD.md` 追加修复记录
- 每个版本发布时更新 `version.md` 详细说明
- 重大重构（B6 + B7）更新根目录 `README.md`

### 4.5 风险与回退

| 风险 | 回退方案 |
|------|---------|
| B1 后端加密存储迁移失败 | 保留明文字段 + 加密字段双写，灰度切换 |
| B2 dry-run 接口性能差 | dry-run 接口加缓存 + 超时降级为直接执行 |
| B6 ServerDetail 拆分后功能缺失 | 保留旧 `ServerDetail` 组件一个版本，灰度切换 |
| B7 契约变更影响下游模块 | 走 s0601 流程，识别所有依赖模块，同步适配 |
| B5 后端分页改造导致现有 API 不兼容 | 保留 `limit` 参数兼容，新增 `page` / `page_size` |

---

## 五、完成判据

### 5.1 批次级完成判据

每个批次完成时必须满足：

- [ ] 所有开发事项的「验证清单」全部通过
- [ ] 独立审查（GN-004 能力）通过或警示放行
- [ ] 对应 `docs/frontend/pages/admin-*.md` 文档已更新
- [ ] 当日日志已记录修复内容
- [ ] 浏览器核对页面渲染正常

### 5.2 整体完成判据

全部 9 个批次完成时必须满足：

- [ ] 200 条 RISK/TODO 全部处理（修复或标注「不修复」+ 原因）
- [ ] grep 验证无遗留反模式：
  - `window.confirm` 在 `panel/frontend/src/pages/admin/` 下为 0
  - `localStorage.getItem('panel_token')` 在 `panel/frontend/src/pages/admin/` 下为 0
  - `as unknown as` 在 `panel/frontend/src/pages/admin/` 下为 0
  - `<input type="text">` 包含 `token` / `secret` / `password` / `key` 的字段为 0
- [ ] 浏览器核对 22 个有效路由全部 PASS
- [ ] 独立审查整体交付前审查通过
- [ ] `version.md` 更新所有修复说明
- [ ] `docs/frontend/logs/` 记录所有修复批次

---

## 六、附录

### 6.1 相关文档索引

- 梳理索引：[docs/frontend/README.md](../frontend/README.md)
- 当日梳理日志：[docs/frontend/logs/2026-07-26.md](../frontend/logs/2026-07-26.md)
- 23 篇页面文档：[docs/frontend/pages/admin-*.md](../frontend/pages/)
- 4 篇流程文档：[docs/frontend/flows/flow-admin-*.md](../frontend/flows/)

### 6.2 关键规则引用

- 浏览器入口最高规则：[.trae/rules/0.md](../../.trae/rules/0.md)
- 版本号规则：[.trae/rules/bb.md](../../.trae/rules/bb.md)
- 核心行为规则：[.trae/rules/rules-0.md](../../.trae/rules/rules-0.md)
- 契约变更流程：Skill `s0601-adapting-contract-changes`
- 安全文件写入：Skill `s0401-safe-file-writing`
- 前端三重闸门：Skill `s0402-frontend-triple-gate`

### 6.3 反模式清单（grep 验证用）

```bash
# B4 验证：window.confirm 应为 0
grep -rn "window.confirm" panel/frontend/src/pages/admin/

# B1 验证：直接读 localStorage token 应为 0
grep -rn "localStorage.getItem('panel_token')" panel/frontend/src/pages/admin/

# B7 验证：as unknown as 类型断言应为 0
grep -rn "as unknown as" panel/frontend/src/pages/admin/

# B1 验证：敏感字段明文 input 应为 0
grep -rnE 'type="text"[^>]*(token|secret|password|apiKey|api_key)' panel/frontend/src/pages/admin/

# 完成判据：破坏性操作无 dry-run 应为 0
grep -rn "DELETE.*confirm" panel/frontend/src/pages/admin/ | grep -v "dry_run\|preview"
```

---

> 本方案为审计修复的整体规划，具体执行时每个批次应独立立项、独立审查、独立交付。
