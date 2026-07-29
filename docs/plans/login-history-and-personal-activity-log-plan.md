---
type: plan
title: 登录日志与个人活动日志方案
date: 2026-07-29
status: draft
related: auth, audit, user-center, security
tags: [login-history, audit, security, plan, personal-activity]
target_version: 4.31.0
---

# gsp 登录日志与个人活动日志方案

> 本方案旨在修复"没有登录日志、没有个人管理日志、不知道上次在哪登录"的严重缺陷。
>
> 经现状调研，这并非"项目缺少日志系统"，而是"日志系统已完整存在但登录环节断链 + 普通用户无查看入口"。本方案聚焦补齐断链点与用户侧入口，不重建已有审计体系。
>
> 遵循「方案编制不计人力工期与开发投入、不区分优先级，仅输出执行步骤、开发事项与建议」原则。

---

## 0. 用户核心决定与现状对照

### 0.1 用户反馈

> 我发现个很严重的 bug，没有登录日志，没有个人管理日志。不知道自己上次在哪登录的。

### 0.2 现状盘点（已有资产 vs 断链点）

| 维度 | 现状 | 是否断链 |
|------|------|----------|
| `audit_logs` 表 | 已存在（user_id/action/ip_address/details_json/retention_days） | ✅ 完好 |
| `auditLogService.ts` | 已存在（list/create/cleanupOldLogs/updateRetentionDays） | ✅ 完好 |
| `audit.ts` 中间件 | 自动记录 mutating 请求 | ⚠️ 显式排除 `/api/auth/login`（见下） |
| `/api/audit-logs` 路由 | 仅 admin 可访问 | ❌ 普通用户无法查看自己的操作历史 |
| `users.last_login_at` / `last_login_ip` 字段 | 已存在 | ⚠️ 字段在但登录路由未更新 |
| `userService.login()` 方法 | 会更新 last_login 字段 | ⚠️ 方法在但登录路由未调用 |
| 登录路由 `POST /api/auth/login` | 既未调用 auditLogService 也未更新 last_login | ❌ 完全断链 |
| 前端个人中心 `UserCenter.tsx` | 仅有经济系统（余额/点券/VIP/提现） | ❌ 无安全中心/登录历史/我的活动页 |

**4 处断链根因**：

1. [routes-registry.ts:369-480](file:///home/airxw/Documents/gsp/gameserver-panel/panel/backend/src/routes-registry.ts#L369-480) 登录成功/失败均未调用 `auditLogService.create`，也未更新 `last_login_at`/`last_login_ip`
2. [audit.ts:30](file:///home/airxw/Documents/gsp/gameserver-panel/panel/backend/src/middleware/audit.ts#L30) `AUDIT_EXCLUDE_PREFIXES` 显式排除 `/api/auth/login`（理由"登录前无 user"，但登录成功后是有 user 的，应显式记录）
3. [auditLogs.ts](file:///home/airxw/Documents/gsp/gameserver-panel/panel/backend/src/api/routes/auditLogs.ts) 路由挂载时套 `requireAdmin` → 普通用户无法查看自己的操作记录
4. [UserCenter.tsx](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/user-center/UserCenter.tsx) 仅经济系统，无安全/登录历史入口

### 0.3 用户裁决汇总（AskUserQuestion 闭合）

| 决策点 | 裁决 | 影响 |
|--------|------|------|
| 存储方式 | 独立 `login_history` 表 | 新增 1 张表 + 1 个迁移文件 + 1 个服务；与 audit_logs 解耦 |
| 失败记录 | 记录成功+失败 | 完整安全审计；失败但用户存在时 user_id 落目标用户，便于本人查看异常尝试 |
| IP/设备增强 | 解析 UA 为可读设备名 | 引入 `ua-parser-js`；不引入 geoip（IP 不反查地理） |
| 前端形态 | 安全中心页 + 登录后弹窗 | 个人中心新增"安全中心"页；登录成功后弹窗提示上次登录 |

---

## 1. 方案概述

### 1.1 核心思路

在已有审计体系之上，**补齐 4 处断链 + 新增用户侧查看入口**，不重建已有日志系统：

```
┌─ 登录路由 ─→ loginHistoryService.create(成功/失败) ─→ login_history 表
│              └→ 同步更新 users.last_login_at/ip（仅成功时）
│
├─ 审计中间件 ─→ 保持排除 /api/auth/login（登录日志由独立服务记录，避免重复）
│              └→ 其余 mutating 请求照常写入 audit_logs
│
├─ 新增 GET /api/me/login-history ─→ 查本人 login_history（JWT 即可）
├─ 新增 GET /api/me/audit-logs    ─→ 查本人 audit_logs（JWT 即可，按 user_id 过滤）
├─ 新增 GET /api/me/last-login     ─→ 查上次成功登录（供登录后弹窗）
│
└─ 前端个人中心 ─→ 新增"安全中心"页（登录历史 + 我的活动 + 上次登录卡）
                 └→ 登录成功后调用 /api/me/last-login 并弹窗
```

### 1.2 设计原则

1. **补链不重建**：复用 `audit_logs` 表与 `auditLogService`，不重复造轮子
2. **登录日志独立表**：语义清晰（成功/失败/设备/会话维度），与审计日志解耦，保留期可独立配置
3. **用户侧最小契约侵入**：新增 3 个 `/api/me/*` 接口与配套类型；不改 `LoginResponse` 契约（避免触发 public/ MAJOR 变更与全员 token 失效）
4. **失败可追溯**：登录失败但目标用户存在时落 user_id，用户能在安全中心看到"有人尝试用错误密码登录我的账号"
5. **零地理依赖**：不引入 geoip 库，避免 IP 库维护负担；UA 解析用轻量 `ua-parser-js`
6. **向后兼容**：`audit_logs` 表结构不动；`users` 表字段不动；现有 admin 审计页不受影响

### 1.3 适用场景

- 普通用户：查看自己的登录历史、上次登录信息、本人操作记录
- 管理员：原有 `/api/audit-logs` 全量审计不受影响；同样可在个人安全中心查本人活动
- 安全审计：登录失败尝试可追溯，支持人工发现暴力破解/撞库

---

## 2. 数据模型设计

### 2.1 新增表：`login_history`

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| `id` | INTEGER | PK AUTOINCREMENT | 主键 |
| `user_id` | TEXT | NULL | 目标用户 ID。成功=本人；失败但用户存在=目标用户；用户不存在=NULL |
| `login_type` | TEXT | NOT NULL | `success` / `fail_password` / `fail_disabled` / `fail_unverified` / `fail_not_found` |
| `login_input` | TEXT | NULL | 登录输入（email 或 username）。**仅失败且用户不存在时记录**，用于安全审计追溯攻击目标；成功时不记（隐私）。建议脱敏：邮箱保留首字符+域名，用户名保留首尾各 1 字符 |
| `ip_address` | TEXT | NULL | 客户端 IP（优先 `X-Forwarded-For` 首段，回退 `req.ip`） |
| `user_agent` | TEXT | NULL | 原始 UA 字符串（截断 512 字符） |
| `device_summary` | TEXT | NULL | 解析后可读设备名（如 `"Chrome 120 / Windows 10"`），由 `ua-parser-js` 生成 |
| `session_id` | TEXT | NULL | JWT `jti`（若签发），用于关联会话与登出/吊销追溯 |
| `failure_reason` | TEXT | NULL | 失败详情（如 `"account_disabled"` / `"email_not_verified"` / `"password_mismatch"`） |
| `retention_days` | INTEGER | NOT NULL DEFAULT 90 | 保留天数，与 `audit_logs` 对齐 |
| `created_at` | TEXT | NOT NULL | ISO8601 时间戳 |

**索引**：
- `idx_login_history_user_created` ON (`user_id`, `created_at` DESC) — 用户侧查询主索引
- `idx_login_history_created` ON (`created_at`) — 清理任务用
- `idx_login_history_ip` ON (`ip_address`, `created_at` DESC) — 风控查询用（按 IP 聚合异常）

### 2.2 与 `audit_logs` 的关系

| 维度 | `login_history` | `audit_logs` |
|------|----------------|--------------|
| 语义 | 登录尝试流水（含失败） | 业务操作流水（mutating 请求 + 业务事件） |
| user_id | 可为 NULL（用户不存在时） | 通常非 NULL（已认证） |
| 触发点 | 登录路由内部显式记录 | 审计中间件兜底 + 业务路由显式记录 |
| 保留期 | 独立配置（默认 90 天） | 已有 retention_days（默认 90 天） |
| 用户可见 | ✅ 本人可查 | ✅ 本人可查（新增 /api/me/audit-logs） |

**两者不重复**：登录路由的"登录成功"事件只写 `login_history`，不写 `audit_logs`（audit 中间件保持排除 `/api/auth/login`，避免双写）。

### 2.3 保留策略

- 复用 `audit_logs` 的清理机制模式：新增 `cleanupOldLoginHistory()` 方法，与现有 `cleanupOldLogs()` 对齐
- 接入现有定时任务调度器（与 `auditLogService.cleanupOldLogs()` 同周期执行）
- 保留期默认 90 天，与 `audit_logs` 一致；后续可在 `system_config` 加 `login_history.retention_days` 配置项

---

## 3. 后端改造

### 3.1 登录路由改造（`panel/backend/src/routes-registry.ts`）

在 `POST /api/auth/login` 路由内，**所有登录结果分支**均调用 `loginHistoryService.create()`：

| 分支 | login_type | user_id | failure_reason |
|------|-----------|---------|----------------|
| 用户不存在 | `fail_not_found` | NULL | `user_not_found` |
| 密码错误 | `fail_password` | 目标用户 ID | `password_mismatch` |
| 账号禁用/删除 | `fail_disabled` | 目标用户 ID | `account_disabled` / `account_deleted` |
| 邮箱未验证 | `fail_unverified` | 目标用户 ID | `email_not_verified` |
| 登录成功 | `success` | 本人 ID | NULL |

**同时恢复 `last_login_at`/`last_login_ip` 更新**：登录成功后，在签发 JWT **之前**记录旧值（用于返回上次登录），然后更新为当前值。改造方式：

- 方案内联实现：在登录成功分支，先 `SELECT last_login_at, last_login_ip FROM users WHERE id=?` 取旧值，更新 `login_history` success 记录后，再 `UPDATE users SET last_login_at=?, last_login_ip=?`
- 不调用 `userService.login()`（避免双重查询与签名耦合），登录路由现有 `signToken` 逻辑保留

**UA 解析**：通过 `req.app.locals.loginHistoryService` 注入的服务内部调用 `ua-parser-js`，路由层只传原始 UA。

### 3.2 新增 UA 解析能力

**依赖**：`ua-parser-js`（轻量、零原生依赖、广泛使用）

**封装位置**：`panel/backend/src/services/loginHistoryService.ts` 内部私有方法 `parseDevice(ua: string): string`

**输出格式**：`"{browser} {version} / {os} {osVersion}"`，解析失败时回退 `"Unknown"`。

**依赖注入**：在 `routes-registry.ts` 的 `app.locals` 注入 `loginHistoryService`，与 `auditLogService` 同模式。

### 3.3 新增 `LoginHistoryService`

文件：`panel/backend/src/services/loginHistoryService.ts`

```typescript
export class LoginHistoryServiceImpl {
  constructor(private readonly db: Knex) {}

  /** 记录一次登录尝试（成功/失败） */
  async create(req: LoginAttemptInput): Promise<{ id: number }>;

  /** 查询本人登录历史（分页，created_at DESC） */
  async listByUser(userId: string, page: number, pageSize: number): Promise<{
    items: LoginHistoryEntry[];
    total: number;
    page: number;
    page_size: number;
  }>;

  /** 查询本人上次成功登录（排除当前会话，取最近一条 success） */
  async getLastSuccess(userId: string, excludeId?: number): Promise<LoginHistoryEntry | null>;

  /** 清理超过 retention_days 的记录（接入定时任务） */
  async cleanupOldLogs(): Promise<number>;
}
```

**私有方法**：`parseDevice(ua)` 封装 `ua-parser-js` 调用。

### 3.4 新增"我的登录历史"接口

`GET /api/me/login-history?page=1&page_size=20`

- 鉴权：JWT（`authenticateToken`）
- 返回：本人 `login_history` 分页（成功+失败均可见，便于用户发现异常尝试）
- 不暴露 `login_input`（即使是本人，也不展示攻击者输入的猜测值，仅展示 `login_type` 与 `ip_address`/`device_summary`/`created_at`）

### 3.5 新增"我的活动"接口

`GET /api/me/audit-logs?page=1&page_size=20&action=&target_type=&from=&to=`

- 鉴权：JWT
- 实现：复用 `auditLogService.list()`，**强制注入 `user_id = 当前用户 ID`**（路由层覆盖任何客户端传入的 user_id）
- 返回：本人 `audit_logs` 分页
- 用途：用户查看自己执行过的管理操作（修改资料、改密码、创建/删除实例、点券兑换等被审计中间件或业务路由记录的操作）

### 3.6 新增"上次登录信息"接口

`GET /api/me/last-login`

- 鉴权：JWT
- 返回：本人最近一条 `success` 类型 `login_history`（排除当前本次登录）
- 用途：登录成功后前端立即调用，弹窗展示"上次登录时间/IP/设备，若非本人请立即改密"
- 字段：`{ last_login_at, ip_address, device_summary }` 或 `null`（首次登录）

### 3.7 路由注册

在 `routes-registry.ts` 新增 `createMeSecurityRouter(deps)` 工厂，挂载前缀 `/api/me`，统一套 `authenticateToken`：

```
/api/me/login-history   GET   — 本人登录历史
/api/me/audit-logs      GET   — 本人活动记录
/api/me/last-login      GET   — 上次登录信息
```

**与现有 `/api/audit-logs`（admin）解耦**：admin 路由保持不变，新增的 `/api/me/audit-logs` 是用户侧只读视图，强制按当前 user_id 过滤。

### 3.8 审计中间件调整

**不修改** `audit.ts` 的 `AUDIT_EXCLUDE_PREFIXES`（保持 `/api/auth/login` 排除）。理由：
- 登录日志由 `loginHistoryService` 独立记录，语义与设备/失败维度更丰富
- 若中间件也记录，会产生 `audit_logs` 与 `login_history` 双写，语义混杂
- 排除 `/api/auth/login` 的原始理由（登录前无 user）对中间件仍成立

---

## 4. 前端改造

### 4.1 安全中心页（新增）

文件：`panel/frontend/src/pages/user-center/SecurityCenter.tsx`

路由：`/user-center/security`（在 `UserCenter.tsx` 的"快捷操作"区加入口按钮）

**三块内容**：

1. **上次登录信息卡**（顶部醒目）
   - 调用 `GET /api/me/last-login`
   - 展示：上次登录时间 / IP / 设备 / 距今多久
   - 提示文案："若非本人操作，请立即修改密码"
   - 首次登录时显示："这是您的首次登录，无历史记录"

2. **登录历史**（中部表格）
   - 调用 `GET /api/me/login-history?page=1&page_size=20`
   - 列：时间 / 结果(成功/失败徽章) / IP / 设备
   - 失败记录用警示色徽章（如"密码错误""账号禁用"）
   - 支持分页

3. **我的活动**（下部表格）
   - 调用 `GET /api/me/audit-logs?page=1&page_size=20`
   - 列：时间 / 操作(action) / 目标类型 / IP / 状态码(来自 details)
   - 支持按 action / target_type 过滤
   - 支持分页

**设计语言**：遵循 Apple 浅色清新主题（与 `UserCenter.tsx` 一致），KPI 卡片 + 徽章 + 表格，不使用深色/电竞配色。

### 4.2 登录后弹窗

文件：`panel/frontend/src/components/LoginLastLoginModal.tsx`

**触发时机**：登录页 `Login.tsx` 登录成功后，跳转前先调用 `GET /api/me/last-login`，若有历史记录则弹窗展示。

**弹窗内容**：
- 标题："登录成功"
- 正文：
  - 上次登录时间：`{last_login_at}`
  - 上次登录 IP：`{ip_address}`
  - 上次登录设备：`{device_summary}`
- 警示（仅当上次登录设备/IP 与当前不一致时显示）："检测到本次登录与上次不同，若非本人操作请立即修改密码"
- 按钮："知道了"（关闭后跳转首页）/ "立即修改密码"（跳转 `/user-center/security`）

**UX 细节**：
- 首次登录（无历史）：不弹窗或弹"欢迎首次登录"轻提示
- 弹窗仅登录后展示一次，不持久化"已读"状态（每次登录都提醒，强化安全意识）

### 4.3 API 模块

文件：`panel/frontend/src/api/modules/security.ts`

```typescript
export interface LoginHistoryEntry {
  id: number;
  login_type: 'success' | 'fail_password' | 'fail_disabled' | 'fail_unverified' | 'fail_not_found';
  login_type_label: string;  // 后端返回可读标签
  ip_address: string | null;
  device_summary: string | null;
  created_at: string;
}

export interface MyActivityEntry {
  id: number;
  action: string;
  target_type: string | null;
  target_id: string | null;
  ip_address: string | null;
  details: Record<string, unknown> | null;
  created_at: string;
}

export interface LastLoginInfo {
  last_login_at: string;
  ip_address: string | null;
  device_summary: string | null;
}

export async function getMyLoginHistory(token, page, pageSize): Promise<PaginatedResult<LoginHistoryEntry>>;
export async function getMyActivity(token, query): Promise<PaginatedResult<MyActivityEntry>>;
export async function getLastLogin(token): Promise<LastLoginInfo | null>;
```

---

## 5. 数据库迁移

### 5.1 迁移文件

文件：`panel/backend/src/db/migrations/{timestamp}_create_login_history.ts`

遵循项目 Knex 迁移规范（参考 `20260808000000_baseline_v4_post_demo.ts`）：

```typescript
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('login_history', (table) => {
    table.increments('id').primary();
    table.text('user_id').nullable();
    table.text('login_type').notNullable();
    table.text('login_input').nullable();
    table.text('ip_address').nullable();
    table.text('user_agent').nullable();
    table.text('device_summary').nullable();
    table.text('session_id').nullable();
    table.text('failure_reason').nullable();
    table.integer('retention_days').notNullable().defaultTo(90);
    table.text('created_at').notNullable();

    table.index(['user_id', 'created_at'], 'idx_login_history_user_created');
    table.index('created_at', 'idx_login_history_created');
    table.index(['ip_address', 'created_at'], 'idx_login_history_ip');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('login_history');
}
```

### 5.2 热更新前置处理

遵循 `.trae/rules/1.md`："版本更新时要注意数据库字段，字段的变更，需要做迁移脚本的前置处理，方便热更新。"

- **迁移顺序**：先执行 `up()`（建表）→ 再发布后端代码（依赖新表）→ 最后发布前端
- **向后兼容**：迁移 `up()` 仅新增表，不修改任何现有表（`users`/`audit_logs` 字段不动），无破坏性变更
- **回滚安全**：`down()` 直接 `dropTableIfExists`，无外键依赖，回滚无副作用
- **部署步骤**（遵循 `deploy.md`）：关闭现有部署 → 执行迁移 → 启动新版本 → 验证健康检查

---

## 6. 执行步骤

> 按 gsp 规范「渐进式生成」原则，每批次处理 ~5 文件，测通一步再走下一步。
> 每个 Task 闭合判据见第 9 节。

### Task 1：数据库迁移与契约

1. 新增迁移文件 `{timestamp}_create_login_history.ts`
2. 在 `public/schema/panel-api-types.ts` 新增类型（MINOR 变更，非破坏性）：
   - `LoginHistoryEntry` / `LoginHistoryListResponse` / `LoginHistoryListQuery`
   - `MyActivityEntry` / `MyActivityListResponse` / `MyActivityListQuery`
   - `LastLoginInfo` / `LastLoginResponse`
3. 在 `public/schema/CHANGELOG.md` 记录契约 MINOR 变更
4. **闭合判据**：`npx knex migrate:latest` 成功；`tsc --noEmit` 通过

### Task 2：后端服务层

1. 安装依赖：`pnpm add ua-parser-js` + `pnpm add -D @types/ua-parser-js`（在 `panel/backend`）
2. 新增 `panel/backend/src/services/loginHistoryService.ts`：
   - `LoginHistoryServiceImpl` 类（create/listByUser/getLastSuccess/cleanupOldLogs）
   - `parseDevice(ua)` 私有方法
   - `createLoginHistoryService(db)` 工厂
3. 在 `routes-registry.ts` 的 `app.locals` 注入 `loginHistoryService`
4. **闭合判据**：`tsc --noEmit` 通过；服务单元测试通过（create→listByUser→getLastSuccess 链路）

### Task 3：后端路由改造

1. 改造 `POST /api/auth/login`（`routes-registry.ts`）：
   - 5 个结果分支均调用 `loginHistoryService.create()`
   - 成功分支恢复 `last_login_at`/`last_login_ip` 更新
   - 失败分支记录 `login_input`（脱敏）
2. 新增 `createMeSecurityRouter(deps)` 路由工厂（文件：`panel/backend/src/api/routes/meSecurity.ts`）：
   - `GET /api/me/login-history`
   - `GET /api/me/audit-logs`（强制 user_id 过滤）
   - `GET /api/me/last-login`
3. 在 `routes-registry.ts` 注册新路由，挂载前缀 `/api/me`，套 `authenticateToken`
4. **闭合判据**：路由 grep 确认挂载（运行时接入校验，见 rules-0 §四-13）；登录成功后 `login_history` 有 success 行；失败登录有 fail 行；`/api/me/*` 三接口 JWT 鉴权可用

### Task 4：前端安全中心页

1. 新增 `panel/frontend/src/api/modules/security.ts`（类型 + API 函数）
2. 新增 `panel/frontend/src/pages/user-center/SecurityCenter.tsx`
3. 在 `UserCenter.tsx` 快捷操作区加"安全中心"入口按钮
4. 路由注册：`/user-center/security`（在 user-center 路由组下）
5. **闭合判据**：页面可加载；登录历史/我的活动/上次登录三块数据正确展示；分页可用；Apple 浅色主题一致

### Task 5：登录后弹窗

1. 新增 `panel/frontend/src/components/LoginLastLoginModal.tsx`
2. 改造 `panel/frontend/src/pages/Login.tsx`：登录成功后调用 `getLastLogin()`，有历史则弹窗
3. 弹窗按钮：跳转 `/user-center/security` 或关闭
4. **闭合判据**：登录成功后弹窗展示上次登录信息；首次登录无弹窗或轻提示；异常设备/IP 时显示警示文案

### Task 6：清理任务接入与版本记录

1. 在定时任务调度器中接入 `loginHistoryService.cleanupOldLogs()`（与 `auditLogService.cleanupOldLogs()` 同周期）
2. 更新 `version.md`：新增 `4.31.0` 版本记录（中版本号+1，新功能）
3. 评估是否更新 `README.md`：本任务属于新增安全功能，建议在 README 功能清单补充"安全中心：登录历史与个人活动日志"
4. **闭合判据**：清理任务可手动触发并返回删除行数；`version.md` 含 4.31.0 条目

### Task 7：测试与验证

1. 后端单元测试：`loginHistoryService` create/list/getLast/cleanup
2. 后端集成测试：登录成功/失败 5 分支均产生 `login_history` 记录；`/api/me/*` 三接口鉴权与数据隔离
3. 前端三重闸门（s0402）：单测 → E2E → Mock 回归
4. 部署前验证：`grep -r "localhost:3000" panel/frontend/dist/` 无违规（遵循 `0.md`）
5. **闭合判据**：测试套件全 PASS；构建产物无 localhost:3000 引用

---

## 7. 开发事项清单

### 7.1 新增文件

| 文件 | 类型 | 说明 |
|------|------|------|
| `panel/backend/src/db/migrations/{ts}_create_login_history.ts` | 迁移 | 建 login_history 表 |
| `panel/backend/src/services/loginHistoryService.ts` | 服务 | 登录历史 CRUD + UA 解析 |
| `panel/backend/src/api/routes/meSecurity.ts` | 路由 | /api/me/* 三接口 |
| `panel/frontend/src/api/modules/security.ts` | API 模块 | 前端类型与请求函数 |
| `panel/frontend/src/pages/user-center/SecurityCenter.tsx` | 页面 | 安全中心页 |
| `panel/frontend/src/components/LoginLastLoginModal.tsx` | 组件 | 登录后弹窗 |

### 7.2 修改文件

| 文件 | 修改点 |
|------|--------|
| `panel/backend/src/routes-registry.ts` | 登录路由 5 分支接入 loginHistoryService；app.locals 注入；注册 meSecurity 路由 |
| `panel/backend/package.json` | 新增 `ua-parser-js` 与 `@types/ua-parser-js` 依赖 |
| `public/schema/panel-api-types.ts` | 新增 LoginHistory/MyActivity/LastLogin 类型（MINOR） |
| `public/schema/CHANGELOG.md` | 记录契约 MINOR 变更 |
| `panel/frontend/src/pages/user-center/UserCenter.tsx` | 快捷操作区加"安全中心"入口 |
| `panel/frontend/src/pages/Login.tsx` | 登录成功后调用 getLastLogin 并弹窗 |
| `panel/frontend/src/App.tsx` 或路由组 | 注册 `/user-center/security` 路由 |
| `version.md` | 新增 4.31.0 版本记录 |
| `README.md` | 功能清单补充"安全中心"（建议） |

### 7.3 不修改的文件（明确边界）

- `panel/backend/src/middleware/audit.ts` — 保持 `/api/auth/login` 排除，避免双写
- `panel/backend/src/api/routes/auditLogs.ts` — admin 审计路由保持不变
- `panel/backend/src/services/auditLogService.ts` — 复用，不改
- `panel/backend/src/services/userService.ts` — `login()` 方法不强行接入（登录路由已内联处理）
- `users` 表结构 — 不动（last_login 字段已存在）

---

## 8. 风险与建议

### 8.1 风险

| 风险 | 等级 | 缓解 |
|------|------|------|
| `ua-parser-js` 依赖增加包体积 | 低 | 轻量库（< 30KB），无原生依赖，可接受 |
| 失败登录 `login_input` 隐私争议 | 中 | 仅在"用户不存在"时记录且脱敏；密码错误时用户存在，不记 input 只记 user_id；用户侧查询不返回 input 字段 |
| 高频失败登录导致日志膨胀 | 中 | 默认 90 天保留 + 定时清理；可考虑未来加 IP 维度限流（本方案不引入） |
| 前端弹窗打断登录体验 | 低 | 首次登录不弹；异常时才显示警示；正常情况仅 1 次点击关闭 |
| public/ 契约修改触发保护规则 | 中 | 属 MINOR 非破坏性变更；本方案审批即人类授权；遵循 rules-0 §四-10 |

### 8.2 建议

1. **优先级建议**：本缺陷被用户判定为"很严重的 bug"，建议优先实施。Task 1-3（后端）可先行合流，Task 4-5（前端）随后跟进，前端可用 Mock API 并行开发
2. **并行机会**：Task 4（安全中心页）与 Task 5（登录弹窗）可并行，前端依赖仅 API 模块（Task 4 第 1 步）
3. **未来增强方向**（不在本方案范围）：
   - IP 地理位置反查（geoip2 离线库 + 定期更新）
   - 异常登录检测与告警（如短时多 IP 失败 → 邮件/通知）
   - 登录设备指纹与会话管理（活跃会话列表 + 远程登出）
   - 用户侧导出登录历史 CSV（审计合规场景）
4. **配置化**：保留期可后续接入 `system_config`（key=`login_history.retention_days`），本方案先用默认 90 天，不阻塞交付
5. **未来增强方向补充**（独立审查建议，不在本方案范围）：
   - 管理员查全用户登录历史（`GET /api/admin/login-history?user_id=xxx`，套 requireAdmin，排查盗号/暴力破解）
   - 登出日志（`login_type` 扩展 `logout`，完整会话生命周期）
   - token 吊销日志（`login_type` 扩展 `force_logout`，记录管理员强制踢下线事件）

---

## 9. 验收标准

### 9.1 功能验收

- [ ] 登录成功后 `login_history` 表有一条 `success` 记录，含 IP/设备解析
- [ ] 登录失败（密码错误/账号禁用/邮箱未验证/用户不存在）各产生对应 `fail_*` 记录
- [ ] `users.last_login_at` / `last_login_ip` 在登录成功后正确更新
- [ ] `GET /api/me/login-history` 返回本人登录历史（含失败记录）
- [ ] `GET /api/me/audit-logs` 仅返回本人操作记录（user_id 隔离生效）
- [ ] 客户端尝试传 `user_id=他人ID` 时仍只返回本人记录（验证路由层强制覆盖逻辑）
- [ ] `GET /api/me/last-login` 返回上次成功登录信息（排除当前会话）
- [ ] 前端安全中心页三块内容数据正确展示，分页可用
- [ ] 登录成功后弹窗展示上次登录信息；首次登录无弹窗
- [ ] 异常设备/IP 时弹窗显示警示文案

### 9.2 非功能验收

- [ ] `npx knex migrate:latest` 成功；`npx knex migrate:rollback` 可安全回滚
- [ ] `tsc --noEmit`（backend + frontend）通过
- [ ] 后端单元测试 + 集成测试 PASS
- [ ] 前端三重闸门（单测/E2E/Mock 回归）PASS
- [ ] `grep -r "localhost:3000" panel/frontend/dist/` 无违规
- [ ] 路由运行时接入校验（rules-0 §四-13）：`/api/me/*` 三接口在路由表中可查
- [ ] `version.md` 含 4.31.0 版本记录
- [ ] 部署后 SSH 断开 30s 重连，systemctl status 仍 active（遵循 deploy.md）

### 9.3 闭合判据（运行时接入）

每个 Task 闭合必须满足「文件存在 + 测试通过 + 运行时接入」三者之一以上（rules-0 §四-13）：

- Task 1：迁移文件存在 + migrate:latest 成功
- Task 2：服务文件存在 + 单测通过 + app.locals 注入可查
- Task 3：路由文件存在 + 路由表 grep 确认挂载 + 登录路由 5 分支均产生 login_history 记录
- Task 4：页面文件存在 + 路由注册 + 浏览器手动验证三块数据
- Task 5：弹窗组件存在 + Login.tsx 接入 + 浏览器手动验证弹窗触发
- Task 6：清理任务在调度器中可查 + version.md 更新
- Task 7：测试套件全 PASS + 构建产物无违规引用

---

## 10. Subagent 调度台账

> 遵循 rules-0 §四-11，本方案若拆分到 subagent 并行执行，台账如下。

| 阶段标签 | [P]组 | subagent_type | 预期产物 | actual agent id | 第二落点 | 失败回退点 | 状态 |
|----------|-------|---------------|----------|-----------------|----------|------------|------|
| Task 1 迁移+契约 | — | 主线程（非subagent） | 迁移文件 + public/schema 类型 | 待回填 | `public/schema/CHANGELOG.md` | — | 待启动 |
| Task 2 后端服务 | — | 主线程（非subagent） | `loginHistoryService.ts` + 单测 | 待回填 | `.trae/documents/` | Task 1 检查点 | 待启动 |
| Task 3 后端路由 | — | 主线程（非subagent） | `meSecurity.ts` + 登录路由改造 | 待回填 | `.trae/documents/` | Task 2 检查点 | 待启动 |
| Task 4 前端安全页 | [P]-A | general_purpose_task | `SecurityCenter.tsx` + API 模块 | 待回填 | `.trae/documents/` | Task 3 检查点（API 契约） | 待启动 |
| Task 5 登录弹窗 | [P]-A | general_purpose_task | `LoginLastLoginModal.tsx` + Login.tsx 改造 | 待回填 | `.trae/documents/` | Task 3 检查点 | 待启动 |
| Task 6 清理+版本 | — | 主线程（非subagent） | 调度器接入 + version.md | 待回填 | `version.md` | Task 2 检查点 | 待启动 |
| Task 7 测试验证 | — | 主线程（非subagent） | 测试报告 | 待回填 | `current-note.md` | 各 Task 检查点 | 待启动 |

**并行说明**：Task 4 与 Task 5 标记 `[P]-A` 同组并行，依赖 Task 3 的 API 契约冻结。单批并行上限 2，符合 rules-0 §四-4 `MAX_PARALLEL_PER_BATCH`。

---

## 附录 A：现状证据索引

| 证据 | 文件位置 |
|------|----------|
| 登录路由未记录日志 | [routes-registry.ts:369-480](file:///home/airxw/Documents/gsp/gameserver-panel/panel/backend/src/routes-registry.ts#L369-480) |
| 审计中间件排除登录 | [audit.ts:28-37](file:///home/airxw/Documents/gsp/gameserver-panel/panel/backend/src/middleware/audit.ts#L28-37) |
| audit_logs 路由仅 admin | [auditLogs.ts](file:///home/airxw/Documents/gsp/gameserver-panel/panel/backend/src/api/routes/auditLogs.ts) |
| users 表已有 last_login 字段 | [userService.ts:89-90](file:///home/airxw/Documents/gsp/gameserver-panel/panel/backend/src/services/userService.ts#L89-90) |
| userService.login 会更新 last_login | [userService.ts:336-339](file:///home/airxw/Documents/gsp/gameserver-panel/panel/backend/src/services/userService.ts#L336-339) |
| auditLogService 完整能力 | [auditLogService.ts](file:///home/airxw/Documents/gsp/gameserver-panel/panel/backend/src/services/auditLogService.ts) |
| 前端个人中心仅经济系统 | [UserCenter.tsx](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/user-center/UserCenter.tsx) |
| 当前版本 4.30.0 | [version.md](file:///home/airxw/Documents/gsp/gameserver-panel/version.md) |
