# GameServer Panel 长期版本迭代计划（v3.6.0 → v4.0.0）

> 本文档为项目从 v3.6.0 到 v4.0.0 的完整版本迭代计划。
> 仅包含方案规划与执行步骤，不修改代码、不计人力工期、不区分优先级。
> 版本号遵循 `.trae/rules/bb.md`：小版本（x.x.X）为 bug 修复/功能修改/微量增加，中版本（x.X.0）为全新功能，大版本（X.0.0）由用户决定。
> 关联讨论文档：[version-roadmap-3.6.0-to-3.7.0.md](./version-roadmap-3.6.0-to-3.7.0.md)

---

## 一、路线图总览

| 版本 | 主题 | 性质 | 核心交付 |
|------|------|------|---------|
| **v3.6.0** | 存储清理统一治理 | 中版本（新功能） | versions/cleanup DELETE 磁盘清理 + chat_logs 死代码激活 |
| **v3.6.1** | 磁盘占用可视化 | 小版本（功能补完） | 节点/实例/版本池三层磁盘统计 |
| **v3.6.2** | 日志清理聚合页 | 小版本（功能扩展） | `/admin/maintenance` 页 + 三张表 retention + 子目录清理 |
| **v3.7.0** | 管理后台与详情页 UX 重构 | 中版本（新功能） | 详情页折叠+抽屉+二级页面+底部栏 + 菜单合并 |
| **v3.8.0** | 面板核心能力增强 | 中版本（新功能） | 诊断精准化 + 设置面板 + 一键部署 |
| **v3.9.0** | 生产就绪安全加固 | 中版本（新功能） | HTTPS/Rate Limit/Helmet/密码找回/自动备份/维护模式 |
| **v4.0.0** | 历史包袱大清理 | 大版本（用户决定） | 模块重整/注释归档/双目录统一/编译产物清理 |

### 版本依赖关系

```
v3.6.0 → v3.6.1 → v3.6.2 → v3.7.0 → v3.8.0 → v3.9.0 → v4.0.0
   │        │        │        │        │        │        │
   │        │        │        │        │        │        └─ 大清理（可独立）
   │        │        │        │        │        └─ 安全加固（不依赖上游）
   │        │        │        │        └─ 设置面板需要 v3.7.0 侧边栏分组
   │        │        │        └─ 依赖 v3.6.x 数据基础
   │        │        └─ 依赖 v3.6.0 死代码激活
   │        └─ 依赖 v3.6.0 file_size_bytes 数据
   └─ 独立起点
```

### 影响领域矩阵

| 版本 | 后端 API | 前端 UI | DB 迁移 | 部署脚本 | pack.yaml | 侧边栏 |
|------|---------|---------|---------|---------|----------|-------|
| v3.6.0 | ✅ | ✅ | - | - | - | - |
| v3.6.1 | ✅ | ✅ | ✅ | - | - | - |
| v3.6.2 | ✅ | ✅ | ✅ | - | - | - |
| v3.7.0 | ✅ | ✅ | - | - | ✅ | ✅ |
| v3.8.0 | ✅ | ✅ | ✅ | ✅ | - | - |
| v3.9.0 | ✅ | ✅ | ✅ | ✅ | - | - |
| v4.0.0 | - | - | ✅ | ✅ | - | - |

---

## 二、v3.6.0：存储清理统一治理

### 2.1 目标

统一修复三处"删 DB 不删磁盘"或"清理代码从未被调用"的同根问题，建立存储全生命周期管理基线。

### 2.2 主要任务

| 任务 ID | 任务 | 位置 | 说明 |
|---------|------|------|------|
| A1 | versions DELETE 补磁盘清理 | `versions.ts:296-324` | 当前只 `db.delete()`，不删磁盘文件。补路径白名单 + daemon exec `rm -rf` |
| A2 | download 完成时回填 `file_size_bytes` | `versions.ts:450-462` | insert 语句当前缺该字段，补 daemon exec `stat`/`du` 回填 |
| A3 | 抽取 `safeRemoveService` 公共服务 | `panel/backend/src/services/safeRemoveService.ts` | versions 和 cleanup 共用路径白名单 + daemon rm 逻辑 |
| B1 | cleanup confirm-delete 补磁盘清理 | `cleanup.ts:128-149` | 当前只 `db('servers').delete()`，不删 `instance_root`。复用 A3 |
| B2 | cleanup 成功后同步清 chat_logs | `cleanup.ts` | 实例删除后 chat_logs 变孤儿记录 |
| C1 | 激活 `chatLogService.cleanupOldLogs` | `chatLogService.ts:178` + `scheduler.ts` | 方法存在但从未被 scheduler 调用，注册每日定时任务 |
| C2 | scheduler 启动时立即跑一次清理 | `index.ts` | 部署后首次立刻清理历史累积 |
| D1 | 前端 VersionsPage 表格扩展 | `VersionsPage.tsx:262-293` | 新增"大小"+"操作"列 + formatBytes 工具函数 |
| D2 | 前端删除确认对话框 | `VersionsPage.tsx` | 弹确认框显示版本号+磁盘占用+警告 |
| D3 | 前端 API client 封装 `deleteVersion` | `api/client.ts` | 当前前端未封装 DELETE 调用 |
| E1 | 文档与版本号同步 | `version.md` / `package.json` | 版本号统一为 3.6.0 |

### 2.3 预期成果

- versions DELETE 和 cleanup confirm-delete 均实现"先删磁盘、再删 DB"的完整闭环
- 所有已下载版本显示真实磁盘占用（不再全为 null）
- chat_logs 实现自动按 retention_days 清理（不再永久累积）
- 前端 `/versions` 页面有完整的删除操作入口

### 2.4 数据契约变更

- `GameVersionSummary` 新增 `reference_count: number`
- `ConfirmCleanupDeleteResponse` 新增 `freed_bytes: number | null`

### 2.5 DB 迁移

无。`file_size_bytes` 字段已在 `20260718000000_create_game_versions.ts` 中定义。

### 2.6 排除事项（移至后续版本）

- 实例级磁盘占用统计 → v3.6.1
- 节点级磁盘总览 → v3.6.1
- `/admin/maintenance` 聚合页 → v3.6.2
- 各日志表 retention 清理 → v3.6.2

---

## 三、v3.6.1：磁盘占用可视化

### 3.1 目标

在节点、实例、版本池三个层面直观展示磁盘空间分布，让用户提前发现"再加一个 ARK 就要满了"。

### 3.2 主要任务

| 任务 ID | 任务 | 位置 | 说明 |
|---------|------|------|------|
| A1 | 新增 `GET /api/nodes/:id/disk-usage` | `nodes.ts` | daemon exec `df -h` 解析，返回 total/used/avail/percent |
| A2 | 新增 `GET /api/servers/:id/disk-usage` | `servers.ts` | daemon exec `du -sb`，返回总量+子目录占用（backups/saves/mods/logs） |
| A3 | servers 列表新增 `disk_usage_bytes` | `servers.ts` (GET /api/servers) | DB 缓存 + scheduler 每日刷新，不在每次请求实时算 |
| A4 | scheduler 注册 `disk-usage-refresh-daily` | `scheduler.ts` | 遍历所有 servers 刷新 disk_usage_bytes，启动时立即跑一次 |
| B1 | 实例列表页显示磁盘占用列 | `Instances.tsx` | 读 `s.disk_usage_bytes` + formatBytes，>10GB 加粗 |
| B2 | 实例详情页折叠卡片显示磁盘占用 | `ServerDetail.tsx` | 顶部 info-card 新增一行"磁盘占用" + 刷新按钮 |
| B3 | `/versions` 顶部空间总览信息条 | `VersionsPage.tsx` | "当前 Pack 已下载版本：N 个，合计占用：XX.X GB" |
| B4 | `/admin/system-health` 节点磁盘总览 | `SystemHealth.tsx` | 进度条 + 数字，>80% 红色警告 |
| C1 | 文档与版本号同步 | `version.md` / `package.json` | 版本号统一为 3.6.1 |

### 3.3 预期成果

- 节点磁盘总览（total/used/avail/percent）在 SystemHealth 页可见
- 实例磁盘占用（含子目录分布）在实例详情页可见
- 版本池空间总览在 `/versions` 页面顶部可见
- 实例列表页新增磁盘占用列

### 3.4 数据契约变更

- `ServerSummary` 新增 `disk_usage_bytes: number | null` + `disk_usage_updated_at: string | null`

### 3.5 DB 迁移

`20260720000000_add_disk_usage_to_servers.ts`：
- `servers.disk_usage_bytes` integer nullable
- `servers.disk_usage_updated_at` timestamptz nullable

### 3.6 排除事项（移至后续版本）

- 磁盘告警通知（>80% 自动通知管理员）→ v3.8.0（与设置面板的通知系统一起做）

---

## 四、v3.6.2：日志清理聚合页

### 4.1 目标

把分散在各处的日志/记录清理入口聚合到 `/admin/maintenance` 统一页面，并对三张目前无清理机制的表补 retention 逻辑。

### 4.2 主要任务

| 任务 ID | 任务 | 位置 | 说明 |
|---------|------|------|------|
| A1 | audit_logs 表增加 `retention_days`（默认 90） | migration | 新增字段 + `auditLogService.cleanupOldLogs()` + scheduler |
| A2 | user_notifications 表增加 `retention_days`（默认 30） | migration | 新增字段 + `notificationService.cleanupOldNotifications()` + scheduler |
| A3 | item_sync_log 表增加 `retention_days`（默认 30） | migration | 新增字段 + `itemSyncService.cleanupOldLogs()` + scheduler |
| A4 | 新增 `GET /api/admin/maintenance/overview` | `maintenance.ts` | 返回四张表行数/retention/上次清理/scheduler 状态 |
| A5 | 新增 `POST /api/admin/maintenance/cleanup` | `maintenance.ts` | 手动触发清理（单表或全部），返回 deleted_rows + freed_bytes |
| A6 | 新增 `PUT /api/admin/maintenance/retention` | `maintenance.ts` | 修改 retention_days（1-365），仅 server_admin |
| A7 | 新增 `DELETE /api/servers/:id/subdir/:subdir` | `servers.ts` | 子目录清理（backups/saves/mods/logs/cache），复用 safeRemoveService |
| B1 | 新增 `/admin/maintenance` 聚合页 | `admin/Maintenance.tsx` | 四张表表格（行数+retention+操作）+ scheduler 状态 + retention 可编辑 |
| B2 | 实例详情页子目录清理按钮组 | `ServerDetail.tsx` | 按 pack.yaml paths 配置读取可清理子目录列表 + running 状态下禁用 |
| C1 | 文档与版本号同步 | `version.md` / `package.json` | 版本号统一为 3.6.2 |

### 4.3 预期成果

- 用户可在 `/admin/maintenance` 页面看到所有日志表行数、retention 配置、scheduler 状态
- 用户可修改 retention 天数、手动触发清理（单表或全部）
- 用户可在实例详情页清特定子目录（backups/saves/mods 等）
- 首次运行 scheduler 时历史累积数据被一次性清理

### 4.4 数据契约变更

- `SubdirCleanupRequest`/`SubdirCleanupResponse` 新增类型
- `MaintenanceOverview`/`CleanupRequest`/`CleanupResponse`/`RetentionUpdate` 新增类型

### 4.5 DB 迁移

三张表各加 `retention_days` 字段：
- `20260721000000_add_retention_to_audit_logs.ts` → `audit_logs.retention_days` integer default 90
- `20260722000000_add_retention_to_user_notifications.ts` → `user_notifications.retention_days` integer default 30
- `20260723000000_add_retention_to_item_sync_log.ts` → `item_sync_log.retention_days` integer default 30

### 4.6 排除事项（移至后续版本）

- 磁盘告警通知 → v3.8.0

---

## 五、v3.7.0：管理后台与详情页 UX 重构

### 5.1 目标

解决两个核心 UX 问题：实例详情页功能平铺混乱（信息卡片不可折叠 + 13 个 Tab 全平铺 + 无状态联动 + 无移动端适配），以及侧边栏 ADMIN_LINKS 过长（10 项）。

### 5.2 主要任务

| 任务 ID | 任务 | 位置 | 说明 |
|---------|------|------|------|
| A1 | pack.yaml `ui.tabs` 扩展为对象数组 | `pack-schema.ts` + 5 个 pack.yaml | 增加 `group` / `order` / `require_state` 字段，向后兼容字符串数组 |
| A2 | pack 加载逻辑兼容两种格式 | `packService.ts` | 字符串数组降级为 group=runtime |
| B1 | 顶部信息卡片折叠 | `ServerDetail.tsx:414-458` | 默认折叠为一行摘要，点击展开完整 9 行，桌面端记忆展开状态 |
| B2 | Tab 折叠抽屉式分组 | `ServerDetail.tsx:460-496` | 四组：运行时/配置/运维/业务运营，默认展开运行时，activeTab 所在组自动展开 |
| B3 | 状态联动：隐藏策略 | `ServerDetail.tsx` | require_state 不匹配的 Tab 直接不渲染，activeTab 被隐藏时自动切到运行时第一个 |
| B4 | 业务运营 Tab 抽到二级页面 | `ServerDetail.tsx` + `instance-detail/Business.tsx` | `/instances/:id/business` 下用 Tab 组织 shop/orders/cdk/triggers/join/vote/commands |
| B5 | 底部固定操作栏（3 按钮） | `ServerDetail.tsx` + `styles.css` | 启动/停止/刷新，"删除"保留在顶部 page-actions |
| B6 | Tab 警告条 | 各子页 + `WarningBar.tsx` | ConfigFiles running 状态显示"修改后需重启生效" |
| C1 | ShopOrders/Shop/CdkRedeem 返回 Tab 保留 | `ShopOrders.tsx:157` 等 | 统一跳到 `/instances/:id?tab=business` |
| D1 | SystemHealth + Diagnostics 合并 | `SystemHealth.tsx` | 三 Tab：实时指标 / 一键诊断 / 磁盘总览（v3.6.1 数据） |
| D2 | 删除 `/admin/diagnostics` 路由 | `App.tsx` | 合并后无独立路由 |
| E1 | 侧边栏 ADMIN_LINKS 分组（10→6） | `Layout.tsx` | 用户与权限 / 系统监控 / 运维清理 / 配置管理 / 审计与日志 / 业务运营 |
| F1 | 文档与版本号同步 | `version.md` / `package.json` / `README.md` | 版本号统一为 3.7.0，README 同步更新 |

### 5.3 状态联动规则

| Tab | stopped | starting | running | stopping | error |
|-----|---------|----------|---------|----------|-------|
| console / log-files | ✅ | ✅ | ✅ | ✅ | ✅ |
| chat-logs / players | ✅ | ⛔ | ✅ | ✅ | ✅ |
| config-files | ✅ | ✅ | ✅ | ⛔ | ✅ |
| world-gen / update / saves / mods | ✅ | ⛔ | ⛔ | ⛔ | ✅ |

### 5.4 预期成果

- 移动端首屏直接看到 Tab（信息卡片折叠）
- Tab 分组后用户认知负荷显著降低（13 项→4 组）
- 状态切换时 Tab 自动显隐，不会误操作
- 业务运营功能独立二级页面，详情页不拥挤
- 底部操作栏在移动端可触摸
- 侧边栏从 10 项降到 6 项

### 5.5 数据契约变更

- `InstanceTabSchema` 扩展为 union 类型（string | object）
- `PackSummary.ui_tabs` 统一为对象数组格式

### 5.6 DB 迁移

无。纯前端 + pack.yaml schema 扩展。

### 5.7 排除事项（移至后续版本）

- 详细的设置面板重构 → v3.8.0
- 注册/游戏开关 → v3.8.0

---

## 六、v3.8.0：面板核心能力增强

### 6.1 目标

三个独立但互补的能力提升：(1) 诊断系统精准化，消除"代码与部署同机"导致的误判；(2) 通用 KV 编辑器转型为结构化设置面板；(3) 新增一键部署命令。

### 6.2 主要任务：诊断精准化

| 任务 ID | 任务 | 位置 | 说明 |
|---------|------|------|------|
| D1 | 新增 `systemd_service` check_type | `systemDiagnosticService.ts` | 用 `systemctl is-active gameserver-panel.service` 替代 `pgrep -f node` |
| D2 | `panel_process_running` 改为 systemd_service | `diagnostic-rules.json` | 消除 `pgrep -f node` 匹配任意 Node 进程的误判 |
| D3 | `panel_port_listening` 绑定进程名 | `diagnostic-rules.json` + service | 改用 `ss -tlnp sport = :3000` 确认是 panel 进程非 dev server |
| D4 | 诊断结果增加 `environment` 字段 | `systemDiagnosticService.ts` | `production` / `development` 标记 |
| D5 | 路径双配置回退 | `systemDiagnosticService.ts` | `${DEPLOY_ROOT}` 未设置时 fallback 到 `process.cwd()` 相对路径 |
| D6 | 新增 port 全量冲突检测 | `diagnostic-rules.json` | 扫描全部 servers 检测端口重叠 |
| D7 | 新增 instance_root 路径唯一性检查 | `diagnostic-rules.json` | 检测两个实例路径是否重叠 |
| D8 | 新增僵尸实例检测 | `diagnostic-rules.json` | DB running 但 daemon 无对应进程 |
| D9 | 新增状态卡死检测 | `diagnostic-rules.json` | starting/stopping > 5min |
| D10 | 新增实例/_versions 文件权限检查 | `diagnostic-rules.json` | 读写权限验证 |
| D11 | 新增非默认 admin 密码检测 | `diagnostic-rules.json` | 安全自检 |

### 6.3 主要任务：设置面板

| 任务 ID | 任务 | 位置 | 说明 |
|---------|------|------|------|
| S1 | `SettingSchemaService` 替代纯 KV | `panel/backend/src/services/` | 带类型校验 + 默认值 + 枚举约束 |
| S2 | `registration.enabled` 开关 | 设置面板 + `index.ts` | register 路由读配置拦截 |
| S3 | `games.enabled_packs` 多选 | 设置面板 + `servers.ts` | pack 列表过滤 + 创建实例时校验 |
| S4 | `games.max_instances_per_user` 限制 | 设置面板 + `servers.ts` | 创建实例时校验 |
| S5 | `games.port_range` 配置 | 设置面板 + `allocatePort` | `[min,max]` 约束 port 分配范围 |
| S6 | `vip.default_expiry_days` 配置 | 设置面板 + `vipService.ts` | null=永久，有值时到期自动降级 |
| S7 | `vip.discount_levels` 配置 | 设置面板 + 商店计算 | `map{level→percent}` 外化硬编码 |
| S8 | `admin.expiry_days` 配置 | 设置面板 | instance_admin 到期自动降级 |
| S9 | `backup.auto_enabled` + `backup.schedule` | 设置面板 + `scheduler.ts` | 按 cron 自动备份 |
| S10 | `backup.path` + `backup.max_count` | 设置面板 | 备份路径 + 保留数配置 |
| S11 | `site.name` / `site.announcement` / `site.logo_url` | 设置面板 | 站点信息 |
| S12 | 面板设置页面前端重构 | `SystemConfig.tsx` | KV 编辑器→表单式 UI（开关/下拉框/数字/日期） |
| S13 | 初始化引导向导 | 新增页面 | 首次启动 3 步：站点名→管理员密码→启用游戏 |

### 6.4 主要任务：一键部署

| 任务 ID | 任务 | 位置 | 说明 |
|---------|------|------|------|
| P1 | 新增 `one-click` 子命令 | `deploy.sh` | 9 步全自动：检测→依赖→npm install→构建→迁移→systemd→健康检查→输出地址 |
| P2 | `one-click` 拉取环境变量检查 | `deploy.sh` | 自动初始化缺失的 .env 文件 |
| P3 | `one-click` 部署前诊断 | `deploy.sh` | 调诊断 API 的子集确保环境就绪 |
| P4 | 失败回滚支持 | `deploy.sh` | `--rollback` 回退到部署前状态 |
| P5 | deploy.sh 版本号更新 | `deploy.sh:2` | `3.0.0` → 实际当前版本 |

### 6.5 主要任务：文档清理（顺手做）

| 任务 ID | 任务 | 位置 | 说明 |
|---------|------|------|------|
| L1 | index.ts 历史注释归档 | `index.ts` → `docs/version-history.md` | 把 `// v3.0.0: xxx` / `// 模块N` 的历史描述块移到 version-history.md |
| L2 | 文档与版本号同步 | `version.md` / `package.json` | 版本号统一为 3.8.0 |

### 6.6 预期成果

- 诊断结果不再因开发环境和生产环境同机而产生误判
- 诊断从 12 项扩展到 20+ 项，覆盖 L0-L5 全部 6 层
- 用户可通过设置面板开关注册、选择启用哪些游戏、设置实例数上限
- VIP/管理员到期自动降级
- 备份定时自动执行
- 服务器首次部署一条命令完成
- index.ts 不再散落历史注释

### 6.7 数据契约变更

- `diagnostic-rules.json` rules 数组扩展（新增 10+ 规则）
- `DiagnosticsResult` 新增 `environment: 'production' | 'development'`
- panel_settings 相关类型定义

### 6.8 DB 迁移

`20260725000000_create_panel_settings.ts`：
- `panel_settings` 表（key/type/value/default_value/description/updated_at）
- `settings_schema` 表（key/type/enum_values/validation/group/order/required）

---

## 七、v3.9.0：生产就绪安全加固

### 7.1 目标

把附录 C 中标记为 🔴 必须的安全、灾备、合规事项全部落地，让项目达到可公网部署的生产级标准。

### 7.2 主要任务：安全加固

| 任务 ID | 任务 | 位置 | 说明 |
|---------|------|------|------|
| S1 | 安装配置 Helmet 安全头 | `index.ts` | `app.use(helmet())`——X-Frame-Options/CSP/HSTS 等 |
| S2 | Rate limiting 中间件 | 新增 `middleware/rateLimiter.ts` | 对 `/api/auth/login` `/api/auth/register` `/api/cdk-redeem` 加 IP 限流 |
| S3 | 密码强度校验 | `index.ts:1101` register 路由 | 至少 8 位 + 字母数字组合 + zxcvbn 评分 |
| S4 | 密码找回流程 | 新增 `auth/password-reset.ts` | "忘记密码"→邮箱发送重置链接→新密码 |
| S5 | 注册邮箱验证 | 新增 `auth/email-verify.ts` | register 后发验证邮件，验证后才可登录 |
| S6 | Nodemailer 集成 | `index.ts` + `.env` | SMTP 配置，共用 S4/S5 |
| S7 | 用户协议 + 隐私政策页面 | 前端新增页面 | 合规要求，公网部署必须 |
| S8 | 维护模式开关 | `index.ts` + `.env` | `MAINTENANCE_MODE=true` → 返回 503 + 维护页面 |
| S9 | 404/500 友好错误页面 | 前端 + 后端中间件 | 统一错误页 |
| S10 | Audit 中间件 | 新增 `middleware/auditMiddleware.ts` | 所有 admin 操作自动写 audit_logs |

### 7.3 主要任务：灾备与运维

| 任务 ID | 任务 | 位置 | 说明 |
|---------|------|------|------|
| D1 | 数据库自动备份 scheduler | `scheduler.ts` + `backupService.ts` | 注册每日全量备份 + 7 天滚动保留 |
| D2 | 磁盘空间监控告警 | `scheduler.ts` | scheduler 每小时 check df，>80% 写入 user_notifications |
| D3 | 备份恢复文档化 | `docs/ops-manual.md` | 恢复流程 + 演练记录 |
| D4 | 故障 Runbook 文档 | `docs/troubleshooting.md` | daemon 不可达/DB 失败/磁盘满/实例启动失败/WS 断开 |

### 7.4 主要任务：业务正确性回归

| 任务 ID | 任务 | 说明 |
|---------|------|------|
| V1 | Daemon 重启后 Panel 自动重订阅 WS 事件 | 验证 + 如需修复则修 |
| V2 | 实例异常崩溃后 DB 状态自动变为 stopped | 验证 daemon `child.on('exit')` 是否强制更新 |
| V3 | 五个游戏完整启动验证 | 含 SteamCMD 依赖安装 + app_update 初始化 |
| V4 | 商店订单端到端验证 | 创建物品→下单→领取→入库 |
| V5 | CDK 兑换端到端验证 | 生成 CDK→兑换→物品送达 |
| V6 | VIP 折扣 + 投票踢人 + 聊天触发器端到端验证 | 实测 |

### 7.5 预期成果

- 公网部署满足基本安全要求（HTTPS 虽需 nginx 配合，但 Helmet + Rate Limit + 密码策略已在应用层就位）
- 用户可注册→邮箱验证→登录→忘记密码全流程畅通
- 数据库每日自动备份 + 7 天滚动保留
- 磁盘 >80% 自动通知管理员
- 维护模式一键切换
- 全部管理员操作可审计

### 7.6 数据契约变更

- 新增 `password_resets` 表类型
- 新增 `email_verifications` 表类型
- 新增 `audit_logs` 记录类型完善

### 7.7 DB 迁移

- `20260728000000_create_password_resets.ts`
- `20260728000001_create_email_verifications.ts`
- `20260728000002_add_maintenance_mode_support.ts`

---

## 八、v4.0.0：历史包袱大清理

### 8.1 目标

从 v3.0.0 到 v3.9.0 积累的技术债务一次性偿还——重整模块编号、归档历史注释、清理编译产物、统一双目录、移除废弃迁移。

**不新增功能，只清理代码和文档**。

### 8.2 主要任务

| 任务 ID | 任务 | 说明 |
|---------|------|------|
| C1 | 模块编号重整 | `modules/模块0→模块0_全局调度面板/` → 重整为连续序列（当前 0/7/10/11/12/13 有断号），废弃空号，assign 当前使用的模块新编号 |
| C2 | TypeScript 编译产物清理 | `modules/` 下的 `.js` / `.d.ts` 统一移到 `dist/modules/` |
| C3 | 双目录结构文档化 | `/home/airxw/.../` vs `/opt/gameserver-panel/` 的分工在 README + deploy.sh 注释中明确 |
| C4 | deploy.sh 端口统一 | `DAEMON_PORT=8080` 全文件统一（消除历史 `18432` 残留） |
| C5 | 废弃 migration 的 down() 清理 | 保留 up，移除无用 down（dropTable 但表在后续迁移重新创建 → 只留 upsert 语义的 down） |
| C6 | env 变量整理 | 生成 `.env.example` 为所有实际使用的环境变量提供文档 |
| C7 | 死代码确认删除 | 确认 v3.6.0-v3.9.0 已激活所有死代码，无遗漏 |
| C8 | 全部 package.json 版本号 + README + deploy.sh 同步 | 统一为 4.0.0 |
| C9 | vsix 归档 | 所有历史分析文档移到 `docs/archive/`，当前活跃文档保留在 `docs/` |

### 8.3 预期成果

- 模块编号连续，新开发者不困惑"模块 1-6 去哪了"
- `modules/` 目录干净（只有 `.ts` 源码，无编译产物）
- deploy.sh 端口统一为 8080
- `.env.example` 覆盖所有环境变量
- 历史文档归档，当前 `docs/` 目录精简

### 8.4 DB 迁移

仅清理废弃 migration 的 `down()` 方法，不新增表。

---

## 九、整体质量提升路线

### 9.1 代码质量

| 版本 | 动作 |
|------|------|
| v3.6.0 | 激活死代码（chatLogService.cleanupOldLogs）+ 抽取公共 safeRemoveService |
| v3.7.0 | 消除 Tab 平铺 + 状态联动 + pack.yaml schema 扩展 |
| v3.8.0 | 诊断精准化 + KV 编辑器→结构化设置面板 + 历史注释归档 |
| v3.9.0 | 安全中间件标准化（Rate Limit/Helmet/Audit） |
| v4.0.0 | 模块编号重整 + 编译产物清理 + 死代码确认删除 |

### 9.2 安全提升

| 版本 | 动作 |
|------|------|
| v3.8.0 | 注册开关 + 游戏开关 + 实例数上限（防滥用） |
| v3.8.0 | 非默认 admin 密码诊断告警 |
| v3.9.0 | Helmet + Rate Limit + 密码强度 + 邮箱验证 + 密码找回 |
| v3.9.0 | 维护模式 + Audit 中间件 |

### 9.3 用户体验提升

| 版本 | 动作 |
|------|------|
| v3.6.0 | versions 页显示大小 + 可删除 |
| v3.6.1 | 全站磁盘占用可视化 |
| v3.6.2 | maintenance 聚合页 + 子目录清理 |
| v3.7.0 | 详情页折叠+分组+二级页面+底部栏+侧边栏精简 |
| v3.8.0 | 诊断精准化（不再误判）+ 设置面板（开/关功能） |
| v3.9.0 | 密码找回 + 邮箱验证 + 维护模式 + 友好错误页 |

### 9.4 运维提效

| 版本 | 动作 |
|------|------|
| v3.6.0 | chat_logs 自动清理 |
| v3.6.1 | scheduler disk_usage 每日刷新 |
| v3.6.2 | 三张表 retention + scheduler 自动清理 |
| v3.8.0 | 一键部署 + 部署前诊断 + 回滚 |
| v3.9.0 | DB 自动备份 + 磁盘告警 + 故障 Runbook |

---

## 十、版本间被依赖关系与不可提前项

| 如果先做 | 依赖 | 原因 |
|---------|------|------|
| v3.7.0 侧边栏分组 | v3.8.0 设置面板 | 设置面板的"面板设置"菜单项依赖 v3.7.0 的侧边栏分组（放入"运维清理"或新"面板管理"组） |
| v3.8.0 诊断路径回退 | - | 无依赖，可独立 |
| v3.9.0 Nodemailer 集成 | - | 无依赖，但需要 v3.8.0 设置面板暴露 SMTP 配置 |
| v4.0.0 模块重整 | v3.9.0 | 重整在所有功能落地后进行，避免整完编号又加新模块 |

---

## 十一、验收清单总览

### 11.1 v3.6.0

- [ ] versions DELETE 在 daemon rm 成功后才删 DB
- [ ] versions/cleanup DELETE daemon rm 失败时 DB 不动，返回 500
- [ ] 路径白名单校验生效（防穿越攻击）
- [ ] `file_size_bytes` 下载完成后回填（不再为 null）
- [ ] chat_logs scheduler 每日自动清理
- [ ] 前端 versions 页显示大小+删除按钮+确认框
- [ ] 被实例引用时删除按钮 disabled + tooltip

### 11.2 v3.6.1

- [ ] 节点/实例/版本池三层磁盘统计 API 正常
- [ ] 前端三处（列表/详情/versions 页面）正确渲染磁盘占用
- [ ] scheduler 每日刷新 disk_usage_bytes
- [ ] formatBytes 工具函数全站复用

### 11.3 v3.6.2

- [ ] 三张表 retention 清理 scheduler 正常
- [ ] `/admin/maintenance` 页面四张表 + scheduler 状态可查可操作
- [ ] 实例子目录清理 API 正常 + 前端按钮组正常

### 11.4 v3.7.0

- [ ] 实例详情页信息卡片折叠（移动端默认折叠）
- [ ] Tab 折叠抽屉分组正确
- [ ] 状态联动（require_state 不匹配的 Tab 隐藏，activeTab 被隐藏时自动切换）
- [ ] 业务运营二级页面路由正常
- [ ] 底部固定操作栏 3 按钮
- [ ] ShopOrders/Shop/CdkRedeem 返回 Tab 保留
- [ ] SystemHealth+Diagnostics 合并正确
- [ ] 侧边栏分组（10→6）正确

### 11.5 v3.8.0

- [ ] systemd_service 诊断规则替换 pgrep 后无误判
- [ ] 诊断结果包含 environment 标记
- [ ] port 冲突/僵尸实例/状态卡死等新规则正常
- [ ] 设置面板表单式 UI 替换 KV 编辑器
- [ ] 注册/游戏/实例数开关生效
- [ ] VIP/管理员到期自动降级
- [ ] 备份 scheduler 正常
- [ ] `deploy.sh one-click` 9 步全自动通过
- [ ] index.ts 注释已归档

### 11.6 v3.9.0

- [ ] Helmet + Rate Limit 中间件生效
- [ ] 密码强度校验生效
- [ ] 密码找回 + 邮箱验证全流程正常
- [ ] 用户协议 + 隐私政策页面存在
- [ ] 维护模式 503 正常
- [ ] DB 自动备份 scheduler 正常
- [ ] 磁盘 >80% 通知管理员
- [ ] 五个游戏完整启动验证通过

### 11.7 v4.0.0

- [ ] 模块编号连续，无断号
- [ ] `modules/` 目录下无 `.js`/`.d.ts` 编译产物
- [ ] `deploy.sh` 端口统一为 8080
- [ ] `.env.example` 覆盖全部环境变量
- [ ] 历史文档已归档
- [ ] 全部 package.json/README/deploy.sh 版本号统一为 4.0.0
