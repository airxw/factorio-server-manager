# Panel Backend index.ts 历史注释归档 (v3.9.0-L1)

> 本文件归档 `panel/backend/src/index.ts` 中按版本号标记的历史注释。
> v3.9.0-L1 任务：将分散在 index.ts 中的历史变更注释抽离到本文件，
> 源文件仅保留「当前实现注释」，历史变更追溯统一查阅本归档。

## v3.1.0

- **账号状态扩展**：`status` 字段新增 `deleted` 取值，登录时区分 `disabled` 与 `deleted` 的提示信息
- **注册端点**：新增 `POST /api/auth/register` 公开注册入口

## v3.3.0

- **用户通知系统**：新增 `notificationService` + `createNotificationsRouter`
  - 数据表：`user_notifications`
  - 挂载路径：`/api/notifications`

## v3.4.0

- **token_version 校验**：JWT payload 写入 `token_version`，`authenticateToken` 校验改密后失效旧 JWT
  - 数据表：`users.token_version`（migration 20260717000002 添加，DEFAULT 0）
  - 兼容规则：`token_version = 0` 跳过校验（旧 JWT 向后兼容）
- **版本池**：新增 `versionsRouter`（Pack 级版本下载/列表/删除）
- **实例清理面板**：新增 `/admin/cleanup`（仅 server_admin）
- **模块10-13 路由挂载**：systemUpdate / systemMetrics / systemDiagnostic / passwordChange

## v3.6.0

- **C1 chat_logs 每日清理任务**：scheduler task `CHAT_LOG_CLEANUP`，每 24h 遍历所有实例清理超过 `retention_days` 的 chat_logs
- **A3 安全删除服务**：`safeRemoveService`（versions DELETE / cleanup confirm-delete 共用路径白名单 + daemon rm）
- **C2 启动期即时清理**：`next_run_at` 设为 10s 后，启动时立即跑一次清理历史累积

## v3.6.1

- **A4 DISK_USAGE_REFRESH**：每日遍历所有 servers 调 `du -sb` 更新 `disk_usage_bytes` 缓存
  - `next_run_at` 设为 15s 后（避开 CHAT_LOG_CLEANUP 10s 高峰）
- **节点感知 daemonClient**：传入 `daemonClientService` 以支持 `GET /:id/disk-usage`
- **C2 启动期刷新**：`next_run_at` 设为 15s 后避开高峰

## v3.6.2

- **A1 audit_logs 每日清理任务**：清理超过 `retention_days` 的审计日志
- **A2 user_notifications 每日清理任务**：清理超过 `retention_days` 的用户通知
- **A3 item_sync_log 每日清理任务**：清理超过 `retention_days` 的物品同步日志
- **A7 子目录清理**：`safeRemoveService` 用于 `DELETE /:id/subdir/:subdir`
- **运维清理聚合页**：`/admin/maintenance`（仅 server_admin）

## v3.8.0

- **S1 结构化设置服务**：`settingSchemaService` 包装 `systemConfigService` 提供类型校验 + 默认值 + schema 查询
  - 首次启动时 seed 默认设置值（幂等）
  - 失败时降级 warn 不阻断启动
- **S2 registration.enabled 开关**：关闭后注册返回 403
- **S8 管理员密码过期检查**：`admin.expiry_days` 设置，仅对 server_admin 角色生效
  - 密码已过期时在响应体附加 `password_expired=true`，不阻断登录
  - `password_changed_at` 为 NULL 时视为「未知」，不强制过期
- **S9/S10 AUTO_BACKUP**：每日检查 `backup.auto_enabled`，为所有实例创建备份并按 `max_count` 清理
- **S13 初始化引导向导**：公开路由 `/api/init/status` + `/api/init`，首启动门控
  - 注入 `db` 到 `app.locals`，供公开 init 路由查询 users 表判断首启动
- **手动 CSP（已被 v3.9.0-S1 Helmet 替代）**：v3.8.0 在 index.ts 内联配置 Content-Security-Policy，v3.9.0-S1 改用 helmet 中间件统一管理安全头

## v3.9.0

- **S2 速率限制抽离**：`createLoginRateLimiter` / `createGlobalRateLimiter` / `createCdkRedeemLimiter` / `createPasswordResetLimiter` / `createEmailVerifyLimiter` 抽离至 `src/middleware/rateLimiter.ts`
- **S1 Helmet 安全头**：替代 v3.8.0 手动 CSP，提供完整的 HTTP 安全头
  - contentSecurityPolicy 沿用 v3.8.0 配置（允许 React 内联样式 + WS 连接）
  - crossOriginEmbedderPolicy: false（避免破坏第三方资源加载）
- **S3 密码强度校验**：`checkPasswordStrength`（zxcvbn 评分 + 字母数字组合校验）
- **S4 密码找回**：`/api/auth/password-reset/request` + `/confirm` 公开路由
- **S5 邮箱验证**：`/api/auth/email-verify/status` + `/request` + `/confirm`
  - 注册成功后自动发送邮箱验证邮件（best-effort，失败不阻断注册）
  - 登录时校验 `require_email_verify`，未验证用户禁止登录（server_admin 豁免）
- **S6 邮件服务**：`mailService`（passwordReset / emailVerify 路由依赖）
- **S7 公开法律内容路由**：`/api/legal/terms` + `/privacy`
- **S8 维护模式中间件**：开启后非管理员请求返回 503 + MAINTENANCE_MODE
- **S9 友好错误页面**：API 未匹配路由返回 JSON 404 + 全局错误中间件返回 JSON 500
- **S10 审计中间件**：记录 mutating 请求（POST/PUT/PATCH/DELETE）到 audit_logs
- **D1 数据库自动备份服务**：`dbBackupService`（与实例 backupService 区分——本服务备份 panel.db 全量文件）
- **D2 磁盘空间监控服务**：`diskMonitorService`（每 1h 检查磁盘使用率，超阈值通知管理员）

---

## 归档原则

1. 本文件按版本号升序组织历史变更注释
2. 源文件 `index.ts` 仅保留「当前实现注释」（描述当前行为/参数含义/挂载顺序等）
3. 历史变更注释（"v3.x.x 新增/修改/废弃"等）从源文件移除，统一查阅本归档
4. 涉及行为变更的注释，归档时附加「当前行为」说明
5. 后续版本迭代时，本文件应同步追加新版本变更说明
