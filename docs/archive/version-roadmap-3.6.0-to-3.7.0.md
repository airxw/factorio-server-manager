# 版本路线图 v3.6.0 → v3.7.0

> 本文档为多版本规划路线图，整合 v3.6.0（已规划）及后续 v3.6.1 / v3.6.2 / v3.7.0 的完整规划。
> 仅包含执行步骤与建议，不区分优先级、不计人力工期。
> 版本号遵循 `.trae/rules/bb.md`：
> - 小版本号（x.x.X）：bug 修复 / 功能修改 / 微量增加
> - 中版本号（x.X.0）：全新功能增加
> - 大版本号（X.0.0）：用户决定

---

## 路线图总览

| 版本 | 主题 | 性质 | 状态 |
|------|------|------|------|
| **v3.6.0** | 存储清理统一治理 | 新功能（中版本） | 详细方案已产出 |
| **v3.6.1** | 磁盘占用可视化 | v3.6.0 功能补完 | 本文档规划 |
| **v3.6.2** | 日志清理聚合页 | 小版本功能增加 | 本文档规划 |
| **v3.7.0** | 管理后台与详情页信息架构重构 | 新功能（中版本） | 本文档规划 |

**版本号决策依据**：
- v3.6.1 和 v3.6.2 是 v3.6.0 主线的"补完"和"扩展"，属功能修改/微量增加，按规则走小版本
- v3.7.0 是 UX 架构级重构，属全新功能，按规则走中版本
- 多节点版本同步、Redis 分布式锁等架构级议题留给 v4.0.0（大版本号由用户决定）

---

# v3.6.0：存储清理统一治理

> 详见独立文档：[docs/3.6.0-version-management-plan.md](./3.6.0-version-management-plan.md)

## 核心内容速览

- **目标域 A**：`/versions` DELETE 补磁盘清理 + file_size_bytes 回填 + 前端表格扩展
- **目标域 B**：`/admin/cleanup` confirm-delete 同步补磁盘清理（与 A 共用 `safeRemoveService`）
- **目标域 C**：激活 `chatLogService.cleanupOldLogs` 死代码（scheduler 注册每日任务）

## 排除事项（移至后续版本）

以下事项在 v3.6.0 文档中已识别但明确排除，按本路线图分配到后续版本：

| 排除事项 | 移至版本 |
|---------|--------|
| 实例级磁盘占用统计（`du -sh instance_root`） | v3.6.1 |
| 节点级磁盘总览 API（`df -h`） | v3.6.1 |
| `/versions` 顶部空间总览信息条（v3.6.0 标为可选增强） | v3.6.1 |
| `/admin/maintenance` 聚合页 | v3.6.2 |
| audit_logs / user_notifications / item_sync_log 表 retention 清理 | v3.6.2 |
| 实例目录的 backups / saves / mods 子目录单独清理 | v3.6.2 |
| SystemHealth 与 Diagnostics 页面合并 | v3.7.0 |
| 实例详情页信息架构重构 | v3.7.0 |
| 侧边栏 ADMIN_LINKS 精简分组 | v3.7.0 |
| pack 配置选择 URL / steamcmd 切换 | v4.0.0 |
| Redis 分布式删除锁 | v4.0.0 |
| 版本删除审计日志表 | v4.0.0 |
| 多节点版本同步 | v4.0.0 |

---

# v3.6.1：磁盘占用可视化

## 一、目标

让用户在三个层面直观看到磁盘空间分布，提前发现"再加一个 ARK 就要满了"：

1. **节点级**：`df -h` 返回总览，让用户看到节点磁盘总量/已用/可用
2. **实例级**：`du -sh instance_root` 返回单实例占用
3. **版本池级**：`/versions` 顶部空间总览信息条（v3.6.0 的可选增强转正）

## 二、现状分析

### 2.1 后端
- 无 `GET /api/nodes/:id/disk-usage` 接口
- 无 `GET /api/servers/:id/disk-usage` 接口
- `servers` 列表 API 不返回 `disk_usage_bytes` 字段

### 2.2 前端
- 实例列表页（`/instances`）无磁盘占用列
- 实例详情页顶部信息卡片无磁盘占用字段
- `/versions` 页面无顶部空间总览信息条（v3.6.0 标为可选增强，本版本正式做）

## 三、执行步骤

### 3.1 后端：新增节点级磁盘总览 API

**位置**：`panel/backend/src/api/routes/nodes.ts`

**改动事项**：
1. 新增 `GET /api/nodes/:id/disk-usage` 路由
2. 调用 daemon exec `df -h --output=source,size,used,avail,pcent,target` 解析输出
3. 返回结构：
   ```ts
   interface NodeDiskUsage {
     node_id: string;
     filesystem: string;
     total_bytes: number;
     used_bytes: number;
     available_bytes: number;
     usage_percent: number;
     mount_point: string;
   }
   ```
4. daemon exec 超时 10s，失败返回 500

### 3.2 后端：新增实例级磁盘占用 API

**位置**：`panel/backend/src/api/routes/servers.ts`

**改动事项**：
1. 新增 `GET /api/servers/:id/disk-usage` 路由
2. 查询 `servers.instance_root`，调 daemon exec `du -sb <instance_root>` 拿到字节数
3. 复用 v3.6.0 的 `safeRemoveService` 路径白名单校验逻辑（防穿越）
4. 返回结构：
   ```ts
   interface InstanceDiskUsage {
     server_id: string;
     instance_root: string;
     total_bytes: number;
     subdirs?: Array<{ name: string; bytes: number }>;  // backups/saves/mods 等子目录
   }
   ```
5. **可选增强**：同时返回子目录占用（backups / saves / mods / logs），让用户看到空间分布
6. daemon exec 超时 30s（大目录可能慢）

### 3.3 后端：servers 列表 API 增加 disk_usage_bytes 字段

**位置**：`panel/backend/src/api/routes/servers.ts` 的 `GET /api/servers` 路由

**改动事项**：
1. 列表 API 响应类型 `ServerSummary` 增加 `disk_usage_bytes: number | null`
2. 实现策略：**异步刷新 + DB 缓存**，不在每次列表请求实时算
   - 新增 `servers.disk_usage_bytes` 字段 + `disk_usage_updated_at` 字段
   - scheduler 每日定时刷新所有实例的 disk_usage_bytes（参考 v3.6.0 chat_logs 定时清理模式）
   - 实例启动/停止/删除时触发一次刷新
3. 返回 DB 中的缓存值，null 时前端显示 "—"

**数据契约变更**：
- `ServerSummary` 增加 `disk_usage_bytes: number | null` + `disk_usage_updated_at: string | null`
- 需要新增 DB 迁移：`add_disk_usage_to_servers.ts`

### 3.4 后端：DB 迁移

**位置**：`panel/backend/src/db/migrations/20260720000000_add_disk_usage_to_servers.ts`

**改动事项**：
1. 新增迁移文件，给 `servers` 表加两列：
   - `disk_usage_bytes` integer nullable
   - `disk_usage_updated_at` timestamptz nullable
2. 不回填历史数据（null 即可，scheduler 首次运行时填充）

### 3.5 后端：scheduler 注册磁盘占用刷新任务

**位置**：`panel/backend/src/services/scheduler.ts` + `index.ts`

**改动事项**：
1. 注册 `disk-usage-refresh-daily` 任务，每日触发
2. 遍历所有 servers，调 daemon exec `du -sb <instance_root>` 刷新 disk_usage_bytes
3. 启动时立即跑一次
4. 每个 server 独立 try-catch

### 3.6 前端：实例列表页显示磁盘占用

**位置**：`panel/frontend/src/pages/Instances.tsx`（或对应列表页文件名）

**改动事项**：
1. 表格增加"磁盘占用"列
2. 读 `s.disk_usage_bytes`，用 `formatBytes()` 转人类可读
3. null 时显示 "—"
4. > 10GB 时加粗
5. 列支持排序

### 3.7 前端：实例详情页折叠卡片显示磁盘占用

**位置**：`panel/frontend/src/pages/ServerDetail.tsx`

**改动事项**：
1. 顶部信息卡片（v3.7.0 会做折叠改造，本版本先平铺增加一行）
2. 新增 info-row："磁盘占用" → `formatBytes(server.disk_usage_bytes)`
3. 后方加"刷新"按钮，调 `GET /api/servers/:id/disk-usage` 实时刷新
4. 刷新成功后更新本地 state + 不刷新整页

### 3.8 前端：/versions 顶部空间总览信息条

**位置**：`panel/frontend/src/pages/VersionsPage.tsx`

**改动事项**：
1. 在"Pack 选择"卡片下方，"远程可用版本"卡片上方，新增"空间总览"信息条
2. 内容：
   ```
   当前 Pack 已下载版本：N 个，合计占用：XX.X GB
   ```
3. 数据来源：前端基于 `versions` state 聚合 `file_size_bytes` 求和
4. 样式：浅蓝信息条，居中显示

### 3.9 前端：节点磁盘总览展示位置

**建议**：放 `/admin/system-health` 页面（与 v3.7.0 的 SystemHealth+Diagnostics 合并方案对齐），作为新增的"磁盘"区块。

**本版本改动事项**：
1. 在 `/admin/system-health` 页面底部新增"节点磁盘总览"区块
2. 调 `GET /api/nodes/:id/disk-usage` 拉取所有节点的 df -h 数据
3. 用进度条 + 数字展示每个节点的磁盘使用情况
4. 进度条 > 80% 显示红色警告

### 3.10 文档与版本号同步

- 所有 package.json version 改为 `3.6.1`
- version.md 新增 v3.6.1 章节

## 四、数据库迁移

**本次需要迁移**：
- 新增 `servers.disk_usage_bytes` integer nullable
- 新增 `servers.disk_usage_updated_at` timestamptz nullable

## 五、验收清单

### 后端
- [ ] `GET /api/nodes/:id/disk-usage` 返回 df -h 解析结果
- [ ] `GET /api/servers/:id/disk-usage` 返回 du -sb 结果 + 子目录占用
- [ ] `GET /api/servers` 列表返回 disk_usage_bytes + disk_usage_updated_at
- [ ] scheduler 注册 `disk-usage-refresh-daily` 任务
- [ ] 路径白名单校验生效（防穿越）
- [ ] daemon exec 超时处理正确

### 前端
- [ ] 实例列表页显示磁盘占用列
- [ ] 实例详情页显示磁盘占用 + 刷新按钮
- [ ] /versions 页面顶部空间总览信息条
- [ ] /admin/system-health 页面节点磁盘总览区块
- [ ] 进度条 > 80% 红色警告
- [ ] formatBytes 工具函数复用（v3.6.0 已建）

### 端到端
- [ ] 节点磁盘总览正确显示 df -h 数据
- [ ] 实例磁盘占用正确显示 du -sb 数据
- [ ] 大目录（>10GB）加载不超时
- [ ] scheduler 每日刷新后 DB 字段更新
- [ ] 删除实例后 disk_usage_bytes 同步清空

---

# v3.6.2：日志清理聚合页

## 一、目标

把分散在各处的日志/记录清理入口聚合到统一页面，并提供 retention 配置：

1. **`/admin/maintenance` 聚合页**：显示各表行数 + retention 配置 + 手动清理按钮
2. **三张表的 retention 清理**：audit_logs / user_notifications / item_sync_log
3. **实例目录子目录清理**：backups / saves / mods 单独清理（v3.6.0 只整体清 instance_root）

## 二、现状分析

### 2.1 各日志/记录表清理机制现状

| 表 | 清理机制 | 现状 | v3.6.2 处理 |
|----|---------|------|---------|
| `chat_logs` | `chatLogService.cleanupOldLogs` + scheduler（v3.6.0 已激活） | ✅ v3.6.0 后正常 | 不动 |
| `audit_logs`（webhooks_audit 迁移） | 无 | ❌ 永久累积 | v3.6.2 补 |
| `user_notifications` | 无 | ❌ 永久累积 | v3.6.2 补 |
| `item_sync_log` | 无 | ❌ 永久累积 | v3.6.2 补 |

### 2.2 实例目录清理现状

v3.6.0 的 `cleanup confirm-delete` 整体删除 `instance_root`。但实际场景中，用户可能只想清理某个子目录（如清空旧 backups 释放空间，保留 saves）。

## 三、执行步骤

### 3.1 后端：audit_logs 表 retention 清理

**位置**：
- `panel/backend/src/db/migrations/20260721000000_add_retention_to_audit_logs.ts`
- `panel/backend/src/services/auditLogService.ts`（新增或扩展）
- `panel/backend/src/services/scheduler.ts`

**改动事项**：
1. DB 迁移：给 `audit_logs` 表增加 `retention_days` 字段（默认 90 天）
2. 新增 `auditLogService.cleanupOldLogs()` 方法，按 `created_at < now - retention_days` 删除
3. scheduler 注册 `audit-logs-cleanup-daily` 任务，每日触发
4. 启动时立即跑一次

### 3.2 后端：user_notifications 表 retention 清理

**位置**：
- `panel/backend/src/db/migrations/20260722000000_add_retention_to_user_notifications.ts`
- `panel/backend/src/services/notificationService.ts`（扩展）
- `panel/backend/src/services/scheduler.ts`

**改动事项**：
1. DB 迁移：给 `user_notifications` 表增加 `retention_days` 字段（默认 30 天）
2. 扩展 `notificationService.cleanupOldNotifications()` 方法
3. scheduler 注册 `user-notifications-cleanup-daily` 任务
4. 启动时立即跑一次

### 3.3 后端：item_sync_log 表 retention 清理

**位置**：
- `panel/backend/src/db/migrations/20260723000000_add_retention_to_item_sync_log.ts`
- `panel/backend/src/services/itemSyncService.ts`（扩展）
- `panel/backend/src/services/scheduler.ts`

**改动事项**：
1. DB 迁移：给 `item_sync_log` 表增加 `retention_days` 字段（默认 30 天）
2. 扩展 `itemSyncService.cleanupOldLogs()` 方法
3. scheduler 注册 `item-sync-log-cleanup-daily` 任务
4. 启动时立即跑一次

### 3.4 后端：`/admin/maintenance/overview` API

**位置**：`panel/backend/src/api/routes/admin.ts` 或新建 `panel/backend/src/api/routes/maintenance.ts`

**改动事项**：
1. 新增 `GET /api/admin/maintenance/overview` 路由
2. 返回结构：
   ```ts
   interface MaintenanceOverview {
     tables: Array<{
       name: string;                    // chat_logs / audit_logs / user_notifications / item_sync_log
       row_count: number;
       retention_days: number;
       last_cleanup_at: string | null;
       estimated_size_bytes: number;   // 可选，估算表占用
     }>;
     schedulers: Array<{
       task_id: string;
       interval: string;
       last_run_at: string | null;
       next_run_at: string | null;
       last_result: { success: boolean; deleted_rows?: number; error?: string } | null;
     }>;
   }
   ```
3. 仅 server_admin 可访问

### 3.5 后端：`/admin/maintenance/cleanup` API

**位置**：同上

**改动事项**：
1. 新增 `POST /api/admin/maintenance/cleanup` 路由
2. 请求体：
   ```ts
   interface CleanupRequest {
     table: 'chat_logs' | 'audit_logs' | 'user_notifications' | 'item_sync_log' | 'all';
     server_id?: string;  // 可选，仅清理指定实例的日志（chat_logs 用）
   }
   ```
3. 调对应 service 的 cleanup 方法
4. 返回：
   ```ts
   interface CleanupResponse {
     table: string;
     deleted_rows: number;
     freed_bytes: number | null;  // 估算
     elapsed_ms: number;
   }
   ```
5. 仅 server_admin 可访问

### 3.6 后端：`/admin/maintenance/retention` API

**位置**：同上

**改动事项**：
1. 新增 `PUT /api/admin/maintenance/retention` 路由
2. 请求体：
   ```ts
   interface RetentionUpdate {
     table: 'chat_logs' | 'audit_logs' | 'user_notifications' | 'item_sync_log';
     retention_days: number;  // 1-365
   }
   ```
3. 更新对应表的 retention_days 配置
4. 返回更新后的配置
5. 仅 server_admin 可访问

### 3.7 后端：实例子目录清理 API

**位置**：`panel/backend/src/api/routes/servers.ts`

**改动事项**：
1. 新增 `DELETE /api/servers/:id/subdir/:subdir` 路由
2. 支持的 subdir 白名单：`backups` / `saves` / `mods` / `logs` / `cache`
3. 从 pack.yaml 的 `paths` 配置读取子目录路径（不是硬编码）
4. 复用 v3.6.0 的 `safeRemoveService`（路径白名单 + daemon exec rm）
5. 路径白名单：必须以 `instances/<server_id>/<subdir>/` 结尾
6. 返回 `freed_bytes`
7. 仅 server_admin 可访问
8. **状态约束**：saves / mods / cache 在 running 状态下禁用（返回 409）

### 3.8 前端：`/admin/maintenance` 聚合页

**位置**：`panel/frontend/src/pages/admin/Maintenance.tsx`（新增）

**改动事项**：
1. 新增 `/admin/maintenance` 路由 + 页面
2. 页面结构：
   ```
   ┌─ 日志表清理 ─────────────────────────┐
   │ 表名 | 行数 | retention | 上次清理 | 操作 │
   │ chat_logs         | 12345 | 30 天 | 2026-07-17 | [立即清理] │
   │ audit_logs        | 678   | 90 天 | 2026-07-17 | [立即清理] │
   │ user_notifications| 890   | 30 天 | 2026-07-17 | [立即清理] │
   │ item_sync_log     | 234   | 30 天 | 2026-07-17 | [立即清理] │
   │ [全部清理]                                  │
   └─────────────────────────────────────┘
   ┌─ 定时任务状态 ──────────────────────┐
   │ 任务名 | 周期 | 上次运行 | 下次运行 | 结果 │
   │ chat-logs-cleanup-daily | 24h | ... | ... | ✅   │
   │ audit-logs-cleanup-daily | 24h | ... | ... | ✅  │
   └─────────────────────────────────────┘
   ```
3. retention 列可点击编辑（弹窗输入 1-365）
4. "立即清理"按钮弹确认框，显示"将删除 N 行记录，确认？"
5. 清理成功后 toast 显示"已删除 N 行"
6. 仅 server_admin 可访问

### 3.9 前端：实例详情"子目录清理"功能

**位置**：`panel/frontend/src/pages/ServerDetail.tsx`（v3.7.0 会重构此页，本版本先做接口）

**改动事项**：
1. 在实例详情页的"运维"区（v3.7.0 会做分组，本版本临时放 Tab 末尾）新增"子目录清理"按钮组
2. 从 pack.yaml 的 `paths` 配置读取可清理的子目录列表
3. 每个子目录一个"清理"按钮，显示当前占用（调 `GET /api/servers/:id/disk-usage` 的 subdirs）
4. 点击清理按钮 → 弹确认框 → 调 `DELETE /api/servers/:id/subdir/:subdir`
5. running 状态下 saves/mods/cache 按钮禁用 + tooltip
6. 清理成功后刷新磁盘占用数据

### 3.10 文档与版本号同步

- 所有 package.json version 改为 `3.6.2`
- version.md 新增 v3.6.2 章节

## 四、数据库迁移

**本次需要迁移**：
- `audit_logs` 表增加 `retention_days` integer default 90
- `user_notifications` 表增加 `retention_days` integer default 30
- `item_sync_log` 表增加 `retention_days` integer default 30

## 五、验收清单

### 后端
- [ ] audit_logs / user_notifications / item_sync_log 三表的 retention_days 字段已添加
- [ ] 三个 service 的 cleanup 方法已实现
- [ ] scheduler 注册三个定时任务
- [ ] `GET /api/admin/maintenance/overview` 返回表行数 + retention + 任务状态
- [ ] `POST /api/admin/maintenance/cleanup` 手动触发清理
- [ ] `PUT /api/admin/maintenance/retention` 修改 retention_days
- [ ] `DELETE /api/servers/:id/subdir/:subdir` 子目录清理（含路径白名单 + 状态约束）

### 前端
- [ ] `/admin/maintenance` 页面显示四张表的行数 + retention + 操作
- [ ] retention 列可编辑
- [ ] "立即清理"按钮弹确认框
- [ ] 定时任务状态表显示
- [ ] 实例详情页子目录清理按钮组
- [ ] running 状态下 saves/mods/cache 按钮禁用

### 端到端
- [ ] 三张表定时清理任务每日触发
- [ ] 手动清理成功后表行数减少
- [ ] retention 修改后下次清理按新值执行
- [ ] 子目录清理后磁盘占用减少
- [ ] running 状态下尝试清理 saves 返回 409

---

# v3.7.0：管理后台与详情页信息架构重构

## 一、目标

整体 UX 重构，解决"功能多但平铺混乱"的问题：

1. **实例详情页重构**：信息卡片折叠 + Tab 分组（折叠抽屉）+ 状态联动（隐藏）+ 业务 Tab 二级页面 + 底部固定操作栏
2. **SystemHealth + Diagnostics 合并**：合并到 `/admin/system-health` Tab 化
3. **侧边栏精简**：ADMIN_LINKS 按主题分组（10 项 → 6 项）
4. **数据契约扩展**：pack.yaml 的 `ui.tabs` 支持分组元数据

## 二、用户决策点（已确认）

| 决策点 | 选择 |
|-------|------|
| Tab 分组视觉呈现 | **折叠抽屉**——点击分组标题展开该组 Tab |
| 状态联动策略 | **隐藏**——不可用 Tab 直接隐藏（不显示禁用态） |
| 业务运营 Tab | **抽到二级页面**——`/instances/:id/business` 而非平铺在详情页 |
| 底部固定操作栏 | **3 个按钮**——启动 / 停止 / 刷新（不放删除） |

## 三、现状分析

### 3.1 实例详情页现状

**位置**：[panel/frontend/src/pages/ServerDetail.tsx](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/ServerDetail.tsx)

**问题清单**：
1. 顶部信息卡片不可折叠（[L414-458](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/ServerDetail.tsx#L414-L458)）——9 行平铺，移动端占满近一屏
2. Tab 全部平铺无分组（[L460-496](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/ServerDetail.tsx#L460-L496)）——13 个 Tab 横向滚动
3. 无"启动必要 vs 启动后可改"的语义区分
4. 无"状态跟踪 vs 配置管理 vs 业务运营"的语义区分
5. 启动/停止/删除/刷新按钮在顶部 page-actions，移动端操作不便

### 3.2 SystemHealth + Diagnostics 现状

**位置**：
- `/admin/system-health`：`panel/frontend/src/pages/admin/SystemHealth.tsx`
- `/admin/diagnostics`：`panel/frontend/src/pages/admin/Diagnostics.tsx`

**问题清单**：
1. 两者都是"系统健康"域，但侧边栏并列两项，用户易点错
2. SystemHealth 是被动展示（指标快照），Diagnostics 是主动操作（跑诊断+修复）——认知上是同一类事
3. v3.6.1 会在 SystemHealth 页面新增"节点磁盘总览"区块，进一步证明该页面是"系统监控聚合页"

### 3.3 侧边栏现状

**位置**：[panel/frontend/src/components/Layout.tsx](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/components/Layout.tsx) 的 ADMIN_LINKS

**问题清单**：
1. 当前 10 项平铺：users / system-health / diagnostics / cleanup / system-config / packs / webhooks / audit-logs / notifications / instance-vip / player-bindings
2. 菜单过长，移动端滚动疲劳
3. 无主题分组

## 四、执行步骤

### 4.1 数据契约：pack.yaml 的 ui.tabs 扩展为对象数组

**位置**：
- `public/schema/pack-schema.ts`
- 所有 `packs/*/pack.yaml`

**改动事项**：
1. `InstanceTabSchema` 扩展为 union 类型：
   ```ts
   type InstanceTabConfig =
     | string  // 旧格式，向后兼容
     | {
         id: string;
         group: 'runtime' | 'config' | 'ops' | 'business';
         order?: number;
         require_state?: InstanceState[];  // 空=任何状态可见
       };
   ```
2. pack.yaml 支持对象数组形式：
   ```yaml
   ui:
     tabs:
       - id: console
         group: runtime
         order: 1
         require_state: []
       - id: world-gen
         group: config
         order: 2
         require_state: [stopped, error]
       - id: update
         group: config
         order: 3
         require_state: [stopped, error]
       # ...
   ```
3. 字符串数组形式仍支持（降级为 group=runtime, order=默认）
4. 所有现有 pack.yaml 同步更新为新格式（minecraft-vanilla / factorio-vanilla / rust-vanilla / palworld-vanilla / ark-vanilla）

**Tab 分组定义**：

| 分组 | group 值 | 包含的 Tab | 用户场景 |
|------|---------|----------|---------|
| 运行时 | `runtime` | console / chat-logs / players / log-files | 启动后高频查看 |
| 配置 | `config` | config-files / world-gen / update | 启动前/停止后操作 |
| 运维 | `ops` | saves / mods | 运行中也可改但有风险 |
| 业务运营 | `business` | shop-admin / chat-triggers / player-join-settings / vote-settings / game-command-help | 管理员侧业务管理（抽到二级页面） |

### 4.2 后端：pack 加载逻辑兼容两种格式

**位置**：`panel/backend/src/services/packService.ts`

**改动事项**：
1. pack 解析时，如果 `ui.tabs` 是字符串数组，转换为对象数组（降级填充默认值）
2. 如果是对象数组，按 schema 校验
3. 返回给前端的 `PackSummary.ui_tabs` 统一为对象数组格式

### 4.3 前端：实例详情页顶部信息卡片折叠

**位置**：`panel/frontend/src/pages/ServerDetail.tsx` 的 [L414-458](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/ServerDetail.tsx#L414-L458)

**改动事项**：
1. 新增 state：`const [infoCollapsed, setInfoCollapsed] = useState(true)`（默认折叠）
2. 折叠态：显示一行摘要
   ```
   [状态徽章] Minecraft 1.21.4 · 端口 25565 · 占用 1.2 GB · [展开]
   ```
3. 展开态：显示完整 9 行 + 新增"磁盘占用"行（v3.6.1 已加字段）
4. 折叠/展开按钮放右上角
5. 桌面端记忆展开状态（localStorage key: `server-detail-info-expanded`）
6. 移动端始终默认折叠

### 4.4 前端：Tab 分组（折叠抽屉式）

**位置**：`panel/frontend/src/pages/ServerDetail.tsx` 的 [L460-496](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/ServerDetail.tsx#L460-L496)

**改动事项**：
1. 根据 pack.ui_tabs 的 group 字段分组
2. 每个分组用一个折叠抽屉组件：
   ```
   ▼ 运行时
     [控制台] [聊天日志] [玩家历史] [日志文件]
   ▶ 配置
   ▶ 运维
   ```
3. 默认展开"运行时"分组，其他折叠
4. 点击分组标题切换展开/折叠
5. 当前 activeTab 所在分组自动展开
6. 分组标题加图标 + 计数（如"运行时 (4)"）
7. 抽屉组件抽到 `panel/frontend/src/components/ui/TabGroup.tsx`

**移动端专项**：
- 折叠抽屉在移动端天然适配（不需要横向滚动）
- 抽屉标题用大字号 + 点击区域加大（44pt 触摸目标）

### 4.5 前端：状态联动（隐藏策略）

**位置**：`panel/frontend/src/pages/ServerDetail.tsx`

**改动事项**：
1. 根据 `server.status` 和 pack.ui_tabs 的 `require_state` 字段过滤可见 Tab
2. **隐藏策略**（用户决策）：require_state 不包含当前状态的 Tab 直接不渲染（不显示禁用态）
3. 当前 activeTab 被隐藏时（状态切换导致）→ 自动切到"运行时"分组的第一个 Tab
4. 状态切换时打印日志：`[ServerDetail] Tab X hidden due to state=running`

**状态联动规则**：

| Tab | stopped | starting | running | stopping | error |
|-----|---------|----------|---------|----------|-------|
| console | ✅ | ✅ | ✅ | ✅ | ✅ |
| chat-logs | ✅ | ⛔ | ✅ | ✅ | ✅ |
| players | ✅ | ⛔ | ✅ | ✅ | ✅ |
| log-files | ✅ | ✅ | ✅ | ✅ | ✅ |
| config-files | ✅ | ✅ | ✅ | ⛔ | ✅ |
| world-gen | ✅ | ⛔ | ⛔ | ⛔ | ✅ |
| update | ✅ | ⛔ | ⛔ | ⛔ | ✅ |
| saves | ✅ | ⛔ | ⛔ | ⛔ | ✅ |
| mods | ✅ | ⛔ | ⛔ | ⛔ | ✅ |

### 4.6 前端：业务运营 Tab 抽到二级页面

**位置**：
- 新增 `panel/frontend/src/pages/instance-detail/Business.tsx`
- 修改 `panel/frontend/src/App.tsx` 路由

**改动事项**：
1. 新增路由 `/instances/:id/business`，渲染 `Business.tsx`
2. `Business.tsx` 内部用 Tab 组织业务运营功能：
   ```
   /instances/:id/business
   ├── Tab: 商店管理（ShopItems + 订单 + CDK）
   ├── Tab: 聊天触发（ChatTriggers）
   ├── Tab: 加入设置（PlayerJoinSettings）
   ├── Tab: 投票设置（VoteSettings）
   └── Tab: 命令帮助（GameCommandHelp）
   ```
3. 实例详情页的"业务运营"分组只显示一个"进入业务管理"按钮 → 跳转到 `/instances/:id/business`
4. 业务管理页顶部加"返回实例详情"按钮
5. 仅 server_admin 可访问（普通用户看不到入口）

**pack.yaml 调整**：
- group=business 的 Tab 不再出现在实例详情页
- pack.ui_tabs 中 group=business 的项作为"业务管理页"的子 Tab 声明

### 4.7 前端：底部固定操作栏

**位置**：`panel/frontend/src/pages/ServerDetail.tsx` + `panel/frontend/src/styles/*.css`

**改动事项**：
1. 新增 `bottom-action-bar` 固定在视口底部（`position: fixed; bottom: 0`）
2. 3 个按钮（用户决策：不放删除）：
   - 启动（btn-success）
   - 停止（btn-warning）
   - 刷新（btn-ghost）
3. 按钮状态联动 server.status（与原 page-actions 一致）
4. 移动端按钮加宽（44pt 触摸目标）
5. 顶部 page-actions 保留"删除"按钮（移到底部栏会让用户误触）
6. 桌面端底部栏宽度居中（max-width: 1200px）
7. 内容区底部加 padding-bottom: 80px 避免被遮挡

### 4.8 前端：SystemHealth + Diagnostics 合并

**位置**：
- `panel/frontend/src/pages/admin/SystemHealth.tsx`
- `panel/frontend/src/pages/admin/Diagnostics.tsx`
- `panel/frontend/src/App.tsx` 路由

**改动事项**：
1. 合并到 `/admin/system-health` 单页，用 Tab 组织：
   ```
   /admin/system-health
   ├── Tab 1: 实时指标（原 SystemHealth 内容）
   ├── Tab 2: 一键诊断（原 Diagnostics 内容）
   └── Tab 3: 磁盘总览（v3.6.1 已新增的节点磁盘总览区块）
   ```
2. 删除 `/admin/diagnostics` 路由
3. 侧边栏移除"系统诊断"项
4. PATH_ACTIVE_MAP 同步更新
5. 面包屑映射同步更新
6. 默认 Tab 为"实时指标"

### 4.9 前端：侧边栏 ADMIN_LINKS 分组

**位置**：`panel/frontend/src/components/Layout.tsx`

**改动事项**：
1. ADMIN_LINKS 从 10 项平铺改为 6 项分组：

| 合并后菜单项 | 子页面（Tab 或子路由） | 合并来源 |
|----------|-----------|--------|
| **用户与权限** | 用户列表 / VIP 模板 / 玩家绑定 | `/admin/users` + `/admin/instance-vip` + `/admin/player-bindings` |
| **系统监控** | 实时指标 / 一键诊断 / 磁盘总览 | `/admin/system-health`（含合并后的 Diagnostics） |
| **运维清理** | 实例清理 / 维护工具 | `/admin/cleanup` + `/admin/maintenance`（v3.6.2 新增） |
| **配置管理** | 底座配置 / Pack 管理 / Webhooks | `/admin/system-config` + `/admin/packs` + `/admin/webhooks` |
| **审计与日志** | 审计日志 / 消息中心 | `/admin/audit-logs` + `/admin/notifications` |
| **业务运营**（保持独立） | 商店物品 / CDK / 投票 / 聊天触发 / 周期消息 / 加入设置 / 物品同步 / 存档 / 模组 / 备份 / 监控 | `/admin/*` 业务页保持不变 |

2. 侧边栏渲染改为分组式（每组带标题 + 子项）
3. 折叠/展开整组（默认展开当前 active 所在组）
4. PATH_ACTIVE_MAP 同步更新
5. 面包屑映射同步更新

### 4.10 前端：Tab 警告条（运行中修改类操作）

**位置**：各子页（ConfigFiles / Saves / Mods）+ 新增 `panel/frontend/src/components/ui/WarningBar.tsx`

**改动事项**：
1. 新增公共 `WarningBar` 组件：
   ```tsx
   <WarningBar level="warning">
     修改后需重启生效
   </WarningBar>
   ```
2. ConfigFiles 子页：running 状态下顶部显示警告条"修改后需重启生效"
3. Saves 子页：running 状态下显示警告条"运行中操作存档有风险"（但 v3.7.0 已隐藏，此条仅在 stopped 时提示"操作前请先停止实例"）
4. Mods 子页：同 Saves

### 4.11 前端：二级页面返回 Tab 保留（ShopOrders / Shop / CdkRedeem）

**位置**：
- `panel/frontend/src/pages/ShopOrders.tsx:157`
- `panel/frontend/src/pages/Shop.tsx:254`
- `panel/frontend/src/pages/CdkRedeem.tsx:41`

**当前问题**：
- [ShopOrders.tsx:157](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/ShopOrders.tsx#L157) 的"返回详情"调 `navigate(/instances/${idParam})`，URL 不带 `?tab=shop-admin` → 跳转后落到默认 Tab 而非用户原本所在的"商店管理"Tab
- [Shop.tsx:254](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/Shop.tsx#L254) 同样问题
- [CdkRedeem.tsx:41](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/CdkRedeem.tsx#L41) 用 `useGoBack()`，但跨页面进入时回退路径不可控

**改动事项**：
1. 由于 v3.7.0 已把"业务运营"Tab 抽到 `/instances/:id/business` 二级页面（见 4.6），ShopOrders / Shop / CdkRedeem 的入口统一改为：
   ```
   /instances/:id/business?tab=shop     // 商店
   /instances/:id/business?tab=orders    // 订单（原 shop-orders）
   /instances/:id/business?tab=cdk       // CDK 兑换（原 cdk-redeem）
   ```
2. 二级页面的"返回详情"按钮统一改为 `navigate(/instances/${id}?tab=business)`，落到实例详情的"业务运营"入口
3. 进入二级页面时记录 `from` 参数（来自哪个 Tab），返回时按 `from` 回退
4. URL 参数 `?tab=` 在实例详情页解析后高亮对应分组并展开抽屉

**建议**：
- 把 ShopOrders / Shop / CdkRedeem 三个独立页面合并为 `/instances/:id/business` 下的 Tab（与 v3.7.0 4.6 节合并），减少页面跳转
- "返回详情"行为统一：永远回到 `/instances/:id?tab=business`，而不是浏览器历史回退（避免跨页面跳转后回退到无关页面）

### 4.12 文档与版本号同步

- 所有 package.json version 改为 `3.7.0`
- version.md 新增 v3.7.0 章节
- README.md 更新（重大 UX 调整，用户向文档需同步）

## 五、数据库迁移

**本次无需迁移**——纯前端 + pack.yaml schema 扩展。

## 六、验收清单

### 数据契约
- [ ] `InstanceTabSchema` 扩展为 union 类型
- [ ] 字符串数组形式向后兼容
- [ ] 所有 5 个 pack.yaml 已更新为新格式
- [ ] pack 加载逻辑兼容两种格式

### 实例详情页
- [ ] 顶部信息卡片默认折叠，显示一行摘要
- [ ] 点击展开显示完整信息 + 磁盘占用
- [ ] 桌面端记忆展开状态
- [ ] Tab 按分组渲染（折叠抽屉式）
- [ ] 默认展开"运行时"分组
- [ ] 当前 activeTab 所在分组自动展开
- [ ] 状态联动：require_state 不匹配的 Tab 直接隐藏
- [ ] 状态切换导致 activeTab 被隐藏时自动切到运行时第一个 Tab
- [ ] 业务运营 Tab 抽到 `/instances/:id/business` 二级页面
- [ ] 业务管理页 Tab 组织正确
- [ ] 底部固定操作栏 3 个按钮（启动/停止/刷新）
- [ ] 顶部 page-actions 保留"删除"按钮
- [ ] 内容区底部 padding 避免被遮挡
- [ ] 移动端触摸目标 ≥ 44pt

### SystemHealth + Diagnostics 合并
- [ ] `/admin/system-health` 页面有 3 个 Tab（实时指标 / 一键诊断 / 磁盘总览）
- [ ] `/admin/diagnostics` 路由已删除
- [ ] 侧边栏移除"系统诊断"项
- [ ] PATH_ACTIVE_MAP 同步更新
- [ ] 面包屑映射同步更新

### 侧边栏分组
- [ ] ADMIN_LINKS 从 10 项改为 6 项分组
- [ ] 每组带标题 + 子项
- [ ] 折叠/展开整组
- [ ] 默认展开当前 active 所在组

### Tab 警告条
- [ ] `WarningBar` 组件已抽到公共组件
- [ ] ConfigFiles 子页 running 状态显示警告条
- [ ] Saves / Mods 子页 stopped 状态显示操作提示

### 二级页面返回 Tab 保留
- [ ] ShopOrders / Shop / CdkRedeem 合并到 `/instances/:id/business` Tab
- [ ] "返回详情"统一跳转到 `/instances/:id?tab=business`
- [ ] URL 参数 `?tab=` 在实例详情页正确高亮对应分组

### 端到端
- [ ] 移动端进入实例详情 → 首屏直接看到 Tab（信息卡片折叠）
- [ ] 点击分组标题展开/折叠抽屉
- [ ] 启动实例后 world-gen / update / saves / mods Tab 隐藏
- [ ] 停止实例后隐藏的 Tab 重新出现
- [ ] 点击"进入业务管理"跳转到二级页面
- [ ] 底部操作栏在移动端可触摸
- [ ] SystemHealth 页面 Tab 切换流畅
- [ ] 侧边栏分组折叠/展开正常

## 七、不在 v3.7.0 范围内

以下事项留给 v4.0.0（大版本，用户决定时机）：

1. pack 配置选择 URL / steamcmd 切换
2. Redis 分布式删除锁（多副本 Panel 部署）
3. 版本删除审计日志表（独立审计表 + 操作流水）
4. 多节点版本同步（一个版本下载到多个节点）

---

# 附录 C：上线前重要工作清单

> 本附录独立于版本路线图，列出项目距离真正上线运行前需要完成的重要工作。
> 这些事项**不绑定具体版本号**——由用户决定何时做，但需作为上线前的 checklist。
> 标记说明：🔴 必须 / 🟡 建议评估 / 🟢 可选

## C.1 安全与合规

| 项 | 现状 | 标记 | 备注 |
|----|------|-----|------|
| HTTPS/TLS 终端 | 后端仅跑 HTTP（[index.ts](file:///home/airxw/Documents/gsp/gameserver-panel/panel/backend/src/index.ts) 未发现 TLS 配置），靠反代或 Cloudflare 兜底 | 🔴 必须 | 生产环境必须配 Nginx/Caddy + Let's Encrypt |
| Rate limiting | 全文搜索 `rate.limit|rateLimit|limiter` 零命中——登录/注册/CDK 兑换等敏感接口无防爆破 | 🔴 必须 | 至少对 `/api/auth/login` `/api/auth/register` `/api/cdk-redeem` 加 IP 限流 |
| Helmet 安全头 | 未发现 helmet 中间件——X-Frame-Options、CSP 等缺失 | 🔴 必须 | `npm i helmet` + `app.use(helmet())` |
| CSRF 防护 | [index.ts:10](file:///home/airxw/Documents/gsp/gameserver-panel/panel/backend/src/index.ts#L10) 用了 cors，但未发现 CSRF 中间件 | 🟡 建议评估 | 若全部走 JWT Bearer 可豁免；若有 cookie 场景必须补 |
| 密码强度策略 | [index.ts:1101](file:///home/airxw/Documents/gsp/gameserver-panel/panel/backend/src/index.ts#L1101) 注册仅校验字段非空，未做密码强度/黑名单校验 | 🟡 建议评估 | 至少 8 位 + 字母数字组合 |
| 邮箱验证 | [index.ts:1136](file:///home/airxw/Documents/gsp/gameserver-panel/panel/backend/src/index.ts#L1136) 注册后直接 login，未发验证邮件（也未发现 nodemailer 集成） | 🟡 看业务定位 | 若开放公网注册必须做 |
| 审计日志完整性 | 已有 audit_logs 表，但需确认所有 admin 操作都走审计 | 🟡 建议评估 | 写审计中间件统一拦截 |
| 用户协议/隐私政策 | 未发现相关页面 | 🔴 必须 | 合规要求，公网部署必须有 |
| 密码找回流程 | 未发现"忘记密码"流程 | 🔴 必须 | 开放注册的产品必须有 |
| 注册流程防刷 | 直接注册直接登录，无验证码/邮箱验证 | 🟡 看业务定位 | 公网开放注册必须加 |

## C.2 可观测性

| 项 | 现状 | 标记 | 备注 |
|----|------|-----|------|
| 日志收集系统 | 有日志文件，但未发现集中式日志（loki/ELK） | 🟡 建议 | 上线初期可暂用 journald + 文件日志 |
| Prometheus 指标 | 有 [monitorService.ts](file:///home/airxw/Documents/gsp/gameserver-panel/panel/backend/src/services/monitorService.ts) 但未发现 `/metrics` 端点暴露 | 🟡 建议 | `prom-client` 集成，暴露 `/metrics` |
| 健康检查完善 | 已有 `/api/health`，但需确认是否覆盖 DB/daemon 全链路 | 🟡 建议 | 至少包含：DB ping / daemon 可达 / systemd active |
| 错误追踪 | 未发现 Sentry/Bugsnag 集成 | 🟡 建议 | Sentry 免费版即可 |
| 业务指标埋点 | 无（如注册量/订单量/启动量等关键漏斗） | 🟢 可选 | 看运营需求 |
| 慢查询监控 | 无 | 🟢 可选 | Knex 可加 `.on('query-response')` 钩子 |

## C.3 灾备与运维

| 项 | 现状 | 标记 | 备注 |
|----|------|-----|------|
| 数据库自动备份 | 有 [backupService.ts](file:///home/airxw/Documents/gsp/gameserver-panel/panel/backend/src/services/backupService.ts) 但未发现定时任务注册（同 chat_logs 死代码问题） | 🔴 必须 | scheduler 注册每日全量备份 + 7 天滚动保留 |
| 数据库恢复演练 | 无 | 🔴 必须 | 文档化恢复流程 + 至少做一次演练 |
| 日志轮转 | systemd 自带 journald，但应用层日志文件可能未轮转 | 🟡 建议评估 | logrotate 配置 + 应用层用 winston rotating file |
| 磁盘空间监控告警 | v3.6.1 会补占用统计，但告警机制（>80% 自动通知）未做 | 🟡 建议 | scheduler 每小时检查 df，>80% 写 user_notifications |
| 进程崩溃自动重启 | systemd 配置 `Restart=always` 应已生效 | ✅ 已就绪 | [部署状态记忆](memory) 确认 |
| 维护模式开关 | 无——升级时直接断服 | 🟡 建议 | 加 `MAINTENANCE_MODE=true` 环境变量，返回 503 + 维护页面 |

## C.4 用户体验与功能完整性

| 项 | 现状 | 标记 | 备注 |
|----|------|-----|------|
| 支付系统对接 | 项目有商店/订单/CDK，但未发现实际支付网关集成（仅点券体系） | 🔴 看业务定位 | 若要真实收费必须对接支付宝/微信支付 |
| 错误页面 | 404/500 是否有友好页面 | 🟡 建议评估 | 前端加 NotFound.tsx + 后端中间件兜底 |
| WebSocket 断线重连 | 之前的记忆提到 WS 事件订阅问题，需确认重连机制稳健 | 🟡 建议评估 | daemon 重启后 Panel 是否自动重订阅 |
| 实例异常崩溃恢复 | 进程崩溃后 DB 状态是否会卡在 "starting" | 🔴 必须验证 | daemon 监听 child.on('exit') 后强制更新 DB 为 stopped |
| 并发订单/CDK 一致性 | 之前的记忆提到两阶段事务，需确认覆盖了所有并发场景 | 🟡 建议评估 | 补并发测试用例 |
| Pack 配置完整性校验 | 用户自定义 pack 时 schema 是否严格校验 | 🟡 建议评估 | pack-schema.ts 应覆盖所有字段 |
| 国际化（i18n） | 当前全部中文硬编码 | 🟢 可选 | 看用户群体 |

## C.5 性能与扩展性

| 项 | 现状 | 标记 | 备注 |
|----|------|-----|------|
| DB 连接池配置 | 需确认 Knex 配置的 pool size | 🟡 建议 | 生产建议 pool.min=5 / pool.max=30 |
| 前端首屏加载 | vite + 路由懒加载已做，需确认 bundle 体积 | 🟢 可选 | `vite-bundle-visualizer` 检查 |
| CDN 静态资源 | 后端直接 serve dist，未发现 CDN | 🟡 看用户规模 | 用户跨地域时建议 CDN |
| 多实例水平扩展 | 当前单 Panel + 多 daemon，多 Panel 副本未考虑 | 🟢 看用户规模 | v4.0.0 才上 Redis |

## C.6 文档与运维交接

| 项 | 现状 | 标记 | 备注 |
|----|------|-----|------|
| 运维手册 | 散落在 [docs/](file:///home/airxw/Documents/gsp/gameserver-panel/docs/) 多个文件，无统一入口 | 🟡 建议 | 集成到 `docs/ops-manual.md` 单一入口 |
| 故障 Runbook | [记忆](memory) 提到的 `docs/daemon-fetch-failed-rootcause-and-fix.md` 是个范例，但未覆盖所有故障场景 | 🟡 建议 | 至少覆盖：daemon 不可达 / DB 连接失败 / 磁盘满 / 实例启动失败 |
| 用户使用手册 | README 有，但面向最终用户的"如何创建实例/启动游戏/管理商店"完整流程文档未发现 | 🟡 建议 | `docs/user-guide.md` |
| API 文档 | 有 `public/interface_stub/`，但无 OpenAPI/Swagger 自动生成 | 🟢 可选 | `swagger-jsdoc` 自动生成 OpenAPI |

## C.7 业务正确性验证（上线前必须回归）

| 项 | 现状 | 标记 | 备注 |
|----|------|-----|------|
| Daemon 重启后状态恢复 | 之前的记忆提到 Panel 必须发 `subscribe(instanceId)` 才能收到事件 → daemon 重启后是否需要重订阅？ | 🔴 必须验证 | 手工 kill daemon → systemctl restart → 确认实例状态事件恢复推送 |
| 实例异常崩溃恢复 | 进程崩溃后 DB 状态是否会卡在 "starting"？ | 🔴 必须验证 | kill -9 java 进程 → 确认 DB 自动变 stopped |
| 五个游戏完整启动 | 之前的记忆提到 Factorio/Rust/Palworld/ARK 因 32 位库问题启动失败 | 🔴 必须验证 | 部署前在节点装 lib32gcc-s1 / lib32stdc++6 + 初始化 steamcmd |
| 商店订单完整流程 | 创建物品 → 下单 → 领取 → 入库 | 🔴 必须验证 | 实测端到端 |
| CDK 兑换完整流程 | 生成 CDK → 兑换 → 物品送达 | 🔴 必须验证 | 实测端到端 |
| VIP 折扣生效 | VIP 用户购买物品时折扣正确 | 🔴 必须验证 | 实测端到端 |
| 投票踢人 | 玩家在游戏内 `!vk` 触发 → 后端处理 → RCON 执行 | 🔴 必须验证 | 实测端到端 |
| 聊天触发器 | 三种匹配模式（精确/前缀/正则）+ 冷却 | 🔴 必须验证 | 实测端到端 |

## C.8 建议的上线前最小 checklist（Subset）

如果时间紧张，至少完成以下 10 项才能上线：

1. ✅ HTTPS/TLS 配置（Nginx + Let's Encrypt）
2. ✅ Rate limiting（登录/注册/CDK 接口）
3. ✅ Helmet 安全头
4. ✅ 数据库自动备份 + 恢复演练
5. ✅ 进程崩溃恢复验证（实例异常退出后 DB 状态正确）
6. ✅ 五个游戏完整启动验证（含 SteamCMD 依赖）
7. ✅ 用户协议 + 隐私政策页面
8. ✅ 密码找回流程
9. ✅ 维护模式开关
10. ✅ 故障 Runbook（至少覆盖 daemon 不可达 + DB 失败 + 磁盘满）

---

# 整体路线图总结

| 版本 | 主题 | 主要交付物 | DB 迁移 |
|------|------|----------|---------|
| v3.6.0 | 存储清理统一治理 | versions DELETE 磁盘清理 + cleanup 同步 + chat_logs 死代码激活 | 无 |
| v3.6.1 | 磁盘占用可视化 | 节点/实例级磁盘统计 + /versions 顶部空间总览 + system-health 磁盘 Tab | servers 表加 2 列 |
| v3.6.2 | 日志清理聚合页 | /admin/maintenance 聚合页 + 三张表 retention + 实例子目录清理 | 3 张表各加 retention_days |
| v3.7.0 | 管理后台与详情页信息架构重构 | 实例详情页折叠+分组+二级页面+底部栏 + SystemHealth 合并 + 侧边栏分组 | 无 |
| v3.8.0（候选） | 系统诊断实现 + 面板设置面板 | 6 层诊断 30+ 检查项 + 设置面板 7 域 + 初始化引导向导 | 新增 panel_settings/settings_schema 表 |

**版本号合规性自检**（按 `.trae/rules/bb.md`）：
- v3.6.1 / v3.6.2：功能修改 / 微量增加 → 小版本号 +1 ✅
- v3.7.0：UX 架构级全新功能 → 中版本号 +1，小版本归零 ✅
- v3.8.0：诊断系统落地 + 设置面板重构 → 全新功能 → 中版本号 +1，小版本归零 ✅
- 大版本号未调整 ✅

---

# 附录 D：系统诊断增强 + 面板设置面板讨论（v3.8.0 候选）

> 两个议题独立但可合并在同一版本——都属于"面板自身能力增强"。
> 不绑定版本号，由用户决定何时做。

## D.1 系统诊断现状与缺口

### D.1.1 当前状态

**诊断功能已实现**，位于 `modules/模块12_系统诊断/`（[systemDiagnosticService.ts](file:///home/airxw/Documents/gsp/gameserver-panel/modules/模块12_系统诊断/systemDiagnosticService.ts)），并非空壳。当前浏览器显示 12 检查项全部通过，4 个分类：系统环境 (4) / 服务状态 (4) / 游戏依赖 (2) / 配置完整性 (2)。

诊断规则配置在 [diagnostic-rules.json](file:///home/airxw/Documents/gsp/gameserver-panel/modules/模块12_系统诊断/config/diagnostic-rules.json)，支持 11 种 `check_type`：`disk_usage` / `memory_usage` / `file_exists` / `directory_exists` / `process_running` / `port_listening` / `db_connectivity` / `command_exists` / `java_version` / `steamcmd_check` / `node_version`。

### D.1.2 当前 12 条规则 vs 应补齐的缺口

**已覆盖**（12 条，4 类）：

| 分类 | 规则 ID | 检查方式 | 
|------|--------|---------|
| 系统环境 (4) | `disk_usage_root` / `disk_usage_deploy` / `memory_usage` / `node_version` | statfs / os.freemem / process.version |
| 服务状态 (4) | `panel_process_running` / `panel_port_listening` / `daemon_port_listening` / `db_connectivity` | pgrep / TCP probe / SELECT 1 |
| 游戏依赖 (2) | `java_runtime` / `steamcmd_installed` | java -version / steamcmd +quit |
| 配置完整性 (2) | `packs_dir` / `instances_dir` | fs.stat |

**应补齐的缺口**（按层，标注是否已有 partial 覆盖）：

| 层 | 诊断项 | 现状 | 重要度 |
|----|-------|------|-------|
| **L0** | 实例/_versions 文件权限（读写） | ❌ | 🔴 |
| | NTP 时钟同步 | ❌ | 🟡 |
| **L1** | DB WAL 堆积（SQLite 特有） | ❌ | 🟡 |
| | Daemon WebSocket 连通性（不只 TCP，要验证 WS 握手） | 仅 TCP probe | 🟡 |
| **L2** | port 全量冲突检测（扫描全部 servers，不止自增） | ❌ | 🔴 |
| | instance_root 路径唯一性 | ❌ | 🔴 |
| | pack.yaml 版本池 >= 1 可下载版本 | ❌ | 🟡 |
| | servers 引用完整性（version_id/pack_id/node_id 有效） | ❌ | 🟡 |
| **L3** | 僵尸实例（DB running 但 daemon 无对应进程） | ❌ | 🔴 |
| | 状态卡死（starting/stopping > 5min） | ❌ | 🔴 |
| | RCON 端口可达（每个 running 实例） | ❌ | 🟡 |
| | Daemon 事件订阅活跃度 | ❌ | 🟡 |
| **L4** | 同版本多实例端口/路径无可观测冲突 | ❌ | 🔴 |
| | 备份路径可写 | ❌ | 🟡 |
| **L5** | .env 无密钥泄露到 git | ❌ | 🟡 |
| | 非默认 admin 密码 | ❌ | 🔴 |

### D.1.3 🔴 关键问题：代码与部署在同一服务器导致的误判风险

> 项目源码在 `/home/airxw/Documents/gsp/gameserver-panel/`，systemd 部署在 `/opt/gameserver-panel/`，两者在同一台物理机上运行。诊断系统当前**未区分开发环境与生产环境**，存在 4 类误判。

**误判类型分析**：

| 规则 ID | 误判风险 | 原理 |
|---------|---------|------|
| `panel_process_running` | 🔴 高 | `pgrep -f node` 匹配**本机任意 Node 进程**（包括 `npm run dev` 的 vite/tsx watch、其他开发项目）。即使 systemd 的 panel 挂了，只要还有 Node 在跑就返回 pass。 |
| `panel_port_listening` | 🔴 高 | 检查 `127.0.0.1:3000`——Vite dev server 也在 3000 端口。开发模式下 dev server 存在却误判 panel 正常运行。 |
| `daemon_port_listening` | 🟡 中 | 检查 `127.0.0.1:8080`——此处 port 检查不绑定进程名，任意进程占用 8080 即为 pass。 |
| `disk_usage_deploy` | 🟡 中 | 路径 `${DEPLOY_ROOT}` 等于 `/opt/gameserver-panel`，如果未配置环境变量则为空串 → 检查的路径可能是 `/`。即使配置了，检查的是生产目录而非开发工作目录的磁盘状态。 |
| `packs_dir` / `instances_dir` | 🟡 中 | `${DEPLOY_ROOT}/packs` 和 `${DEPLOY_ROOT}/instances` 同样是生产路径。如果开发机上也存在这些目录（来自之前的手动部署），会 pass；如果不存在，会报错但实际开发环境并不需要这些目录。 |

**核心矛盾**：诊断系统的静态规则配置（`diagnostic-rules.json`）通过 `${DEPLOY_ROOT}` 环境变量区分路径，但**诊断服务不感知自己是运行在 dev mode 还是 systemd mode**。同一台机器上的开发环境和生产环境共用同一个诊断结果。

**修正方案**（建议 v3.8.0 一并处理）：

1. **进程检查精准化**：从 `pgrep -f node` 改为读 `/proc/<pid>/cmdline` 匹配具体进程路径（如 `/opt/gameserver-panel/panel/backend/dist/index.js`），或者改为读 systemd unit 状态（`systemctl is-active gameserver-panel`）——后者最精确
2. **端口检查绑定进程名**：改为 `ss -tlnp sport = :3000 | grep node` 确认是 panel 进程而非 dev server
3. **环境感知**：新增 `check_type: systemd_service`，用 `systemctl is-active gameserver-panel.service` 替代 `process_running` + `port_listening` 的双重检查
4. **诊断模式标记**：诊断结果中增加 `environment: 'production' | 'development'` 字段，让用户知道当前在什么环境下做的诊断
5. **路径双配置**：`diagnostic-rules.json` 支持 `check_params.path` 优先读环境变量，其次 fallback 到 `cwd-relative` 路径

### D.1.4 补充：同游戏同版本多实例冲突 + SteamCMD 游戏

**同游戏同版本多实例冲突**：
- 端口：`allocatePort`（[servers.ts:866](file:///home/airxw/Documents/gsp/gameserver-panel/panel/backend/src/api/routes/servers.ts#L866)）只做自增 MAX()+1，**不扫描全部 servers 做全量冲突检测**。用户手动指定 port 或两 pack default_port 相同时会产生端口冲突。
- 路径：`instance_root` 按约定生成（`instances/<id>/`），但无唯一性校验——两个实例路径重叠会互相覆盖文件。

**非 MC 游戏没跑起来**：
- Factorio/Rust/Palworld/ARK 依赖 SteamCMD + 32 位库（lib32gcc-s1 / lib32stdc++6）
- 诊断中 `steamcmd_installed` 规则已做 SteamCMD 基础检查，包括：文件存在 → linux32 初始化 → `steamcmd.sh +quit` 试运行（失败时提示"缺少 32 位依赖库，请安装 lib32gcc-s1"）
- 但缺的是 **app_update 实际下载测试**（针对具体游戏 ID 如 ARK 376030），目前仅做基础可用性检查

---

## D.2 一键部署功能（v3.8.0 或 v4.0.0 候选）

### D.2.1 现状

[deploy.sh](file:///home/airxw/Documents/gsp/gameserver-panel/deploy.sh) 已存在，支持 6 个子命令：`install` / `start` / `stop` / `restart` / `status` / `update` / `uninstall`。但 `install` 命令的子步骤（`create_user` → `install_deps` → `copy_files` → `configure_env` → `build` → `create_systemd_services`）需要**逐个确认或手动跳过**，不是真正的"一键"。

### D.2.2 应有的一键部署流程

```
sudo bash deploy.sh one-click
  ├── 1. 环境检测（ports 3000/8080 无冲突 + Node.js >= 18 + Java >= 21）
  ├── 2. 依赖安装（lib32gcc-s1 + steamcmd 自动下载初始化）
  ├── 3. npm install（frontend + backend + daemon 三目录）
  ├── 4. 构建（frontend vite build）
  ├── 5. DB 迁移（knex migrate:latest）
  ├── 6. 创建 systemd 服务（gameserver-panel + gameserver-daemon）
  ├── 7. enable + start
  ├── 8. 健康检查（curl localhost:3000/api/health + curl localhost:8080/health）
  └── 9. 输出访问地址 + 初始 admin 密码
```

### D.2.3 关键设计点

- **非交互式**：通过 `.env` 或命令行参数传入配置，不弹交互提示
- **幂等**：重复执行不覆盖已有配置（除 `npm install` / `build` 阶段）
- **前置健康检查自动化**：部署前跑一次 `diagnostic-rules.json` 的子集，确保环境就绪
- **回滚**：任意步骤失败时保留已完成步骤，`--rollback` 可回退到部署前状态
- **Web 端触发**（可选增强）：在 `/admin/system-update` 页面提供"一键更新"按钮，本质是在线调 deploy.sh

### D.2.4 与 v3.6.0-v3.7.0 的关系

不阻塞现有版本。v3.8.0 的"诊断增强"天然为"部署前健康检查"提供数据源——两者的结合点在 v3.8.0 最合适。

---

## D.3 v4.0.0：大版本清理（丢掉历史包袱）

### D.3.1 需要清理的历史包袱

| 类型 | 具体内容 | 清理方式 |
|------|---------|---------|
| **版本号不一致** | [deploy.sh:2](file:///home/airxw/Documents/gsp/gameserver-panel/deploy.sh#L2) 声明 `3.0.0`，实际 >= 3.5.4 | 统一到当前版本号 |
| **双目录结构** | `/home/airxw/Documents/gsp/gameserver-panel/`（开发）+ `/opt/gameserver-panel/`（生产） | 文档化双目录，生产路径统一读 deploy.sh 变量 |
| **死代码** | `chatLogService.cleanupOldLogs`（v3.6.0 激活前是死代码）、`backupService` 未注册 scheduler | v3.6.0-v3.6.2 已逐个激活 |
| **注释残留** | [index.ts](file:///home/airxw/Documents/gsp/gameserver-panel/panel/backend/src/index.ts) 大量 `v3.x.0` 历史版本注释块 | 归档到 docs/version-history.md，index.ts 中删除 |
| **模块编号断裂** | 模块 0/7/10/11/12/13 部署在 modules/ 下，但模块 1-6/8-9 存在于历史规划中未落地 | 重整模块编号为连续序列 |
| **package.json version 碎片** | 前端/后端/daemon 的 version 字段历史不同步（之前的 [记忆](memory) 提到 3.5.1 vs 3.5.4 不同步问题） | v3.6.0+ 已逐版本同步 |
| **环境变量分裂** | `DAEMON_PORT=18432`（历史）→ `8080`（当前），端口号在 deploy.sh / README / .env.template 间不统一 | 统一为 8080 |
| **废弃的迁移** | 部分 migration 的 `down()` 是 `dropTable`，但表在后续迁移中被重新创建 | 保留 up，清理无用的 down |
| **TypeScript 编译产物** | `modules/` 下的 `.js` / `.d.ts` 编译产物混在源码目录 | 统一 dist 输出到 `dist/modules/` |

### D.3.2 建议的清理节奏

- **v3.6.0-v3.7.0**：逐个激活死代码（chat_logs scheduler、backup scheduler），不集中清理
- **v3.8.0**：补充诊断 + 设置面板，同时做"注释归档"（把 index.ts 的历史注释移到 version-history.md）
- **v4.0.0**：大版本清理——重整模块编号、清理编译产物目录、统一双目录文档、移除废弃 migration 的 down

### D.3.3 不想等到 v4.0.0 的低风险清理（可在 v3.8.0 顺手做）

1. **deploy.sh 版本号更新**：`3.0.0` → 实际当前版本（1 行改动）
2. **index.ts 注释归档**：把 `// v3.0.0: xxx` / `// 模块N` 的历史描述块移到 `docs/version-history.md`（纯文档操作，零风险）
3. **package.json version 统一**：每次版本发布时已同步

---

## D.4 v3.8.0 候选实施概要（整合版）

### 执行步骤

1. **后端：诊断精准化**（systemd_service check_type + 进程/端口精准匹配 + 环境感知）
2. **后端：补齐 15+ 诊断缺口**（端口冲突/路径唯一性/僵尸实例/状态卡死/RCON/权限 等）
3. **后端：SettingSchemaService**（替代纯 KV，带类型校验 + 默认值 + 枚举约束）
4. **后端：注册/游戏/实例数拦截中间件**（读取 panel_settings 拦截请求）
5. **后端：VIP/备份 scheduler 化**（过期自动降级 + 备份定时执行）
6. **前端：SystemConfig → PanelSettings 重构**（表单式 UI，非 KV 编辑器）
7. **前端：初始化引导向导**（3 步引导页）
8. **deploy.sh：一键部署子命令**（`one-click`，9 步全自动）
9. **文档清理**：index.ts 注释归档 + deploy.sh 版本号更新
10. **DB 迁移**：新增 `panel_settings` 表 + `settings_schema` 表

### 关键设计决策

- 诊断与设置 + 一键部署合并在 v3.8.0：三者都属"面板自身能力增强"
- 数据库切换**不在线执行**：仅展示当前类型 + 导出 SQL 按钮 + 部署文档说明
- 设置面板**分角色**：server_admin 可见全部，instance_admin 仅可见"游戏"域
- 诊断报告**可导出 JSON**（供 GN-004 或人工审查使用）
- v4.0.0 大清理**不混入 v3.8.0**：v3.8.0 只做低风险清理（注释归档 + 版本号统一），高风险重整留给 v4.0.0
