---
type: plan
title: 生产环境 /setup 初始化向导修复方案
date: 2026-07-25
status: deployed
deployed_in: v4.19.1
related:
  - panel/frontend/src/pages/SetupWizard.tsx
  - panel/backend/src/api/routes/settings.ts
  - panel/backend/src/services/passwordPolicy.ts
  - panel/backend/src/db/seed.ts
  - panel/backend/src/index.ts
  - .trae/rules/0.md
  - .trae/rules/bb.md
  - version.md
tags: [setup-wizard, init, preflight, password-policy, build-footer, demo-mode, contract-change]
---

# 生产环境 /setup 初始化向导修复方案

## 一、问题现状

生产入口 `https://gsp.ecsrz.com:3001/setup` 当前实现位于：

- 前端：[panel/frontend/src/pages/SetupWizard.tsx](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/SetupWizard.tsx)
- 后端：[panel/backend/src/api/routes/settings.ts](file:///home/airxw/Documents/gsp/gameserver-panel/panel/backend/src/api/routes/settings.ts#L172-L381)（`createPublicInitRouter`）
- 密码策略：[panel/backend/src/services/passwordPolicy.ts](file:///home/airxw/Documents/gsp/gameserver-panel/panel/backend/src/services/passwordPolicy.ts)
- Seed 脚本：[panel/backend/src/db/seed.ts](file:///home/airxw/Documents/gsp/gameserver-panel/panel/backend/src/db/seed.ts)
- 启动入口：[panel/backend/src/index.ts](file:///home/airxw/Documents/gsp/gameserver-panel/panel/backend/src/index.ts#L67-L126)

当前流程为 3 步：站点名称 → 管理员密码 → 启用游戏 Pack → 完成。用户反馈"这个初始化的功能没办法走下去"，需修复。

---

## 二、根因分析

### 2.1 上来就强制改密，没有环境/配置预检

`SetupWizard` 进入后直接调 `GET /api/init/status` 拿 `needs_init`，随后立即进入 Step 1（站点名称），完全不做任何环境检查：

- 数据库连通性（`DATABASE_URL` 是否有效、migrations 是否就绪）
- Daemon 连通性（`DAEMON_URL` 是否可达）
- Pack 加载状态（`PACKS_DIR` 是否存在、加载到几个 Pack）
- HTTPS 证书 / nginx 跳转是否生效
- 磁盘剩余空间
- 当前是否演示模式（仅由 `VITE_ENABLE_DEMO` env 决定，向导不感知）

**后果**：用户在生产环境根本不知道底层依赖是否就绪，即使配置错了也能走到改密步骤，最后因其他依赖缺失而功能不可用。

### 2.2 没有运行模式选择

演示模式完全由环境变量 `VITE_ENABLE_DEMO` 决定：

- [settings.ts#L200-L202](file:///home/airxw/Documents/gsp/gameserver-panel/panel/backend/src/api/routes/settings.ts#L200-L202)：`detectInitStatus` 中演示模式直接 `return false`，跳过向导
- [settings.ts#L326-L336](file:///home/airxw/Documents/gsp/gameserver-panel/panel/backend/src/api/routes/settings.ts#L326-L336)：`POST /api/init` 中演示模式仅"走过场"，不真正写库
- [index.ts#L107-L126](file:///home/airxw/Documents/gsp/gameserver-panel/panel/backend/src/index.ts#L107-L126)：演示实例 seed 仅在 `VITE_ENABLE_DEMO=true` 时执行

用户无法在向导中选"演示模式 vs 生产模式"，只能通过 SSH 改 `.env` 后重启服务——这与"首次访问 /setup 完成初始化"的产品定位冲突。

### 2.3 管理员账号硬编码不可改

- 前端 [SetupWizard.tsx#L220-L223](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/SetupWizard.tsx#L220-L223) 写死文案"将更新默认管理员账号 `admin@local.dev` 的密码"
- 后端 [settings.ts#L177](file:///home/airxw/Documents/gsp/gameserver-panel/panel/backend/src/api/routes/settings.ts#L177) `DEFAULT_ADMIN_EMAIL = 'admin@local.dev'` 固定
- 后端 [settings.ts#L342-L354](file:///home/airxw/Documents/gsp/gameserver-panel/panel/backend/src/api/routes/settings.ts#L342-L354) 只更新该 email 对应记录的 `password_hash`，不接受邮箱/用户名变更

**后果**：生产环境用户无法将管理员账号改成真实邮箱（如 `ops@example.com`），登录凭据长期绑定 `@local.dev` 域。

### 2.4 密码强度前后端校验不一致（核心阻塞点）

| 校验项 | 前端 `step2Valid` | 后端 `checkPasswordStrength` |
|--------|------|------|
| 长度 | `>= 8 && <= 128` | `>= 8 && <= 128` |
| 字母数字组合 | ❌ 不校验 | ✅ 必含字母 + 数字 |
| zxcvbn 评分 | ❌ 不校验 | ✅ `score >= 2` |
| 两次输入一致 | ✅ | ❌（不属密码强度范畴） |

用户输入 `admin123`（与 seed 默认密码相同的"不变"操作）：

1. 前端 `step2Valid = true` → 允许进入 Step 3
2. 提交时后端 `checkPasswordStrength('admin123')` 返回 `ok: false`（zxcvbn score = 0，且是常见弱密码）
3. 后端返回 `WEAK_PASSWORD` 错误，`details.failures` 含具体原因
4. 前端 [SetupWizard.tsx#L126-L131](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/SetupWizard.tsx#L126-L131) 仅 `toast.error(err.message)`，**不展示 `details.failures` 与 `suggestions`**
5. 用户只看到"管理员密码强度不足"一个红字，不知具体不满足哪条规则，"没办法走下去"

### 2.5 数据库配置入口完全缺失

- 当前 `DATABASE_URL` 仅在 `.env` / `panel.env.template` 中配置
- SetupWizard 没有数据库相关步骤
- 用户期望"数据库的配置也没有要求"——意指生产环境初始化时应让用户感知/选择数据库（即便是 SQLite 也应明确告知路径，不能完全沉默）

### 2.6 BUILD 标识缺失（违反全局规则）

[SetupWizard.tsx](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/SetupWizard.tsx) 全文无 `app-footer-build` 也无 `BUILD_ID` 引用。

对比同目录其他公开页面均已落地：
- [Login.tsx#L354-L357](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/Login.tsx#L354-L357)
- [IdentitySelector.tsx#L190-L193](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/IdentitySelector.tsx#L190-L193)
- [SelectIdentity.tsx#L184-L188](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/SelectIdentity.tsx#L184-L188)
- [DemoExperience.tsx#L279-L283](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/DemoExperience.tsx#L279-L283)

违反 `.trae/rules/1.md`："页面底部规范化 footer span 显示唯一 BUILD 序列"。

**关于"加在 span 位置下方"的口径校正**：用户提议"如果没有合适位置，加在 Step 1 站点名称 hint span 下方"。但全局规则明确"禁止在页面顶端、侧边栏等其他位置冗余渲染 BUILD 编号"——表单字段下方属冗余位置。SetupWizard 实际有合适的 footer 落点（`.setup-page` 容器底部），应与其他公开页一致，在页面底部添加 `<footer className="app-footer-build">`，不在表单 span 下方重复渲染。

### 2.7 演示账号 seed 无门控（安全隐患）

[index.ts#L77](file:///home/airxw/Documents/gsp/gameserver-panel/panel/backend/src/index.ts#L77) `seedAdminIfEmpty(db)` 调用**没有**任何环境变量门控，无论 `VITE_ENABLE_DEMO` 是否为 true，都会 seed `admin@local.dev / manager@local.dev / user@local.dev` 三个账号，密码统一 `admin123`。

生产环境 `/setup` 出现"上来就强制改密"的根本原因正是这三个账号已存在，且 `password_changed_at IS NULL`。这是**安全风险**——任何知道默认账号的人都可能在用户完成初始化前先用 `admin123` 登录。

### 2.8 `detectInitStatus` 检测条件过窄

[settings.ts#L196-L217](file:///home/airxw/Documents/gsp/gameserver-panel/panel/backend/src/api/routes/settings.ts#L196-L217)：

```ts
return adminStillDefault || siteNameStillDefault;
```

仅检测"admin 是否改密"与"site.name 是否默认"两项。改了 admin 密码 + 改了 site.name 即视为已初始化，但实际生产初始化还应包含：

- 是否选择了运行模式
- 是否配置了数据库
- 是否完成关键依赖检查

当前检测无法区分"用户跳过向导"与"用户完整完成向导"——`SetupWizard` 提供"跳过初始化"按钮（[L190-L196](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/SetupWizard.tsx#L190-L196)），点击后直接 `/login`，但 `needs_init` 仍为 `true`，下次访问 `/setup` 又会再次进入向导，体验割裂。

---

## 三、设计目标

1. **预检先行**：进入向导前先做服务器环境/依赖预检，让用户一眼看到"哪些就绪、哪些缺失"
2. **模式可选**：在向导中显式选择"演示模式 / 生产模式"，对应不同的初始化路径
3. **账号可改**：允许用户自定义管理员邮箱/用户名（生产模式必填，演示模式保留默认）
4. **密码策略前后端一致**：前端实时反馈 zxcvbn 评分与具体失败项，与后端规则完全对齐
5. **数据库可感知**：展示当前 `DATABASE_URL` 类型（SQLite/PostgreSQL）与路径，生产模式允许配置
6. **BUILD 落地**：SetupWizard 页面底部添加规范化 footer，与其他公开页一致
7. **Seed 门控**：生产模式（`VITE_ENABLE_DEMO != true`）下不再默认 seed manager/user 两个演示账号，仅 seed 一个待初始化的 admin
8. **检测条件扩展**：`detectInitStatus` 增加运行模式、关键依赖完成情况等检测维度

---

## 四、解决方案

整体改造分前端、后端、Seed、BUILD 四块。所有变更均为**新增字段/接口**或**扩展校验**，属 [rules-3 §六](file:///home/airxw/Documents/gsp/gameserver-panel/.trae/rules/rules-3.md) 的 **MINOR** 级契约变更，需更新 `public/schema/panel-api-types.ts` 与 `public/interface_stub/panel-rest.ts`，并同步通知依赖模块。

### 4.1 后端：新增预检接口 `GET /api/init/preflight`

**文件**：[panel/backend/src/api/routes/settings.ts](file:///home/airxw/Documents/gsp/gameserver-panel/panel/backend/src/api/routes/settings.ts#L231)

在 `createPublicInitRouter` 中新增路由：

```ts
router.get('/preflight', async (req, res) => {
  const service = req.app.locals.settingSchemaService as SettingSchemaService;
  const db: Knex = req.app.locals.db;
  const registry = req.app.locals.packRegistry as PackRegistry;

  const checks: PreflightCheck[] = [];
  // 1. 数据库连通性
  checks.push(await checkDatabase(db));
  // 2. Migrations 是否就绪
  checks.push(await checkMigrations(db));
  // 3. Daemon 连通性（HEAD DAEMON_URL/health）
  checks.push(await checkDaemon(req.app.locals.daemonClient));
  // 4. Pack 加载状态
  checks.push(checkPacks(registry));
  // 5. 数据库类型与路径
  checks.push(checkDatabaseConfig(process.env.DATABASE_URL));
  // 6. 当前运行模式
  checks.push({ key: 'mode', label: '运行模式', status: process.env.VITE_ENABLE_DEMO === 'true' ? 'demo' : 'production', detail: '由 VITE_ENABLE_DEMO 决定（只读）' });
  // 7. 磁盘剩余空间
  checks.push(await checkDiskSpace(process.env.INSTANCES_DIR));
  // 8. HTTPS / 域名（检查 PUBLIC_BASE_URL）
  checks.push(checkPublicBaseURL(process.env.PUBLIC_BASE_URL));

  const allOk = checks.every(c => c.status === 'ok' || c.status === 'warn');
  res.json({ needs_init: await detectInitStatus(db, service), checks, all_ok: allOk });
});
```

**响应契约**（写入 `public/schema/panel-api-types.ts`）：

```ts
export interface InitPreflightResponse {
  needs_init: boolean;
  all_ok: boolean;
  checks: Array<{
    key: string;             // 'database' | 'migrations' | 'daemon' | 'packs' | 'db_config' | 'mode' | 'disk' | 'public_url'
    label: string;           // 中文展示名
    status: 'ok' | 'warn' | 'error';
    detail: string;          // 详情（如 "SQLite at /opt/.../panel.db" / "3 packs loaded"）
    actionable?: boolean;    // 是否可在向导内修复（true=可修复，false=需 SSH）
  }>;
}
```

### 4.2 后端：扩展 `POST /api/init` 请求体

**文件**：[panel/backend/src/api/routes/settings.ts#L251-L378](file:///home/airxw/Documents/gsp/gameserver-panel/panel/backend/src/api/routes/settings.ts#L251-L378)

请求体从 `{ site_name, admin_password, enabled_packs }` 扩展为：

```ts
interface InitRequest {
  site_name: string;
  // 新增：管理员账号配置（生产模式必填，演示模式忽略）
  admin?: {
    email?: string;          // 不填则保留 admin@local.dev
    username?: string;       // 不填则保留 admin
    password: string;        // 必填，与原 admin_password 等价
  };
  // 兼容：旧字段 admin_password 仍接受（向后兼容）
  admin_password?: string;
  enabled_packs: string[];
  // 新增：运行模式确认（只读回显，写入 system_config 'system.mode'）
  mode?: 'demo' | 'production';
  // 新增：数据库配置（仅展示用，不允许通过 API 修改 .env；用户须在向导外手动配置）
  database_ack?: boolean;    // 用户已确认当前数据库配置
}
```

**处理逻辑变更**：

1. **生产模式 + `admin.email` 提供时**：将 `users` 表中 `admin@local.dev` 记录的 `email`/`username` 一并更新（保留 `id`/`role`/`vip_level`）
2. **密码更新**：保持现有 bcrypt 逻辑，但补充"密码不得等于常见弱密码（admin123、12345678 等）"硬拦截
3. **`mode` 写入**：`service.setValue('system.mode', mode)`，作为 `detectInitStatus` 的新增检测维度
4. **`database_ack` 校验**：若 preflight 中 `db_config.status === 'warn'`（如 SQLite 用于生产），必须 `database_ack === true` 才允许提交

### 4.3 后端：扩展 `detectInitStatus` 检测维度

**文件**：[settings.ts#L196-L217](file:///home/airxw/Documents/gsp/gameserver-panel/panel/backend/src/api/routes/settings.ts#L196-L217)

```ts
async function detectInitStatus(db, service): Promise<boolean> {
  if (process.env.VITE_ENABLE_DEMO === 'true') return false;

  // 条件 1：默认 admin 仍存在且未改密
  const adminStillDefault = /* 现有逻辑 */;

  // 条件 2：site.name 仍为默认
  const siteNameStillDefault = /* 现有逻辑 */;

  // 新增条件 3：system.mode 未设置（首次启动）
  const systemMode = await service.getString('system.mode');
  const modeUnset = !systemMode || systemMode === '';

  // 新增条件 4：未完成 preflight（关键依赖缺失）
  //   注：此处不重跑完整 preflight，仅检查 system_config 'system.preflight_passed'
  const preflightPassed = await service.getBoolean('system.preflight_passed');

  return adminStillDefault || siteNameStillDefault || modeUnset || !preflightPassed;
}
```

`POST /api/init` 成功提交时同步写入 `system.preflight_passed = true` 与 `system.mode`。

### 4.4 后端：Seed 门控收紧

**文件**：[panel/backend/src/index.ts#L77](file:///home/airxw/Documents/gsp/gameserver-panel/panel/backend/src/index.ts#L77)

```ts
// 旧：
await seedAdminIfEmpty(db);

// 新：仅在演示模式 seed 全部 3 个演示账号；生产模式仅 seed 一个待初始化 admin
if (process.env.VITE_ENABLE_DEMO === 'true') {
  await seedDemoAccountsIfMissing(db);   // 3 个 *@local.dev 账号
} else {
  await seedProvisionalAdminIfEmpty(db); // 仅 admin@local.dev，待向导改邮箱/密码
}
```

**新增 `seedProvisionalAdminIfEmpty`**（写入 [panel/backend/src/db/seed.ts](file:///home/airxw/Documents/gsp/gameserver-panel/panel/backend/src/db/seed.ts)）：

- 仅插入 `admin@local.dev` 一条，`is_built_in=0`（生产环境可改邮箱/密码/删除）
- 不插入 `manager@local.dev` / `user@local.dev`
- 密码仍为 `admin123`（仅作为初始化前的临时凭据，向导提交后立即覆盖）
- **v4.18.0 适配**：必须同步设置 `roles`、`active_role` 字段（v4.17.0 多角色重构新增）：
  ```ts
  await db('users').insert({
    // ... 现有字段
    role: Role.SERVER_ADMIN,                              // 旧字段，过渡期保留
    roles: JSON.stringify([Role.SERVER_ADMIN]),           // v4.17.0 新增
    active_role: Role.SERVER_ADMIN,                       // v4.17.0 新增
    // ...
  });
  ```
  可复用 [roles.ts](file:///home/airxw/Documents/gsp/gameserver-panel/panel/backend/src/core/auth/roles.ts) 的 `normalizeRoles` 工具确保格式正确

### 4.5 后端：密码策略前端可见

**文件**：[panel/backend/src/services/passwordPolicy.ts](file:///home/airxw/Documents/gsp/gameserver-panel/panel/backend/src/services/passwordPolicy.ts)

新增导出：

```ts
export const PASSWORD_POLICY_RULES = {
  min_length: MIN_PASSWORD_LENGTH,
  max_length: MAX_PASSWORD_LENGTH,
  min_zxcvbn_score: MIN_ZXCVBN_SCORE,
  require_letter: true,
  require_digit: true,
  forbidden_passwords: ['admin123', '12345678', 'password', '123456789'],
} as const;
```

新增接口 `GET /api/auth/password-policy`（公开）返回该常量，前端可拉取后做实时校验，与后端规则 1:1 对齐。

### 4.6 前端：SetupWizard 改造为 5 步流程

**文件**：[panel/frontend/src/pages/SetupWizard.tsx](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/SetupWizard.tsx)

新流程：

| Step | 名称 | 内容 |
|------|------|------|
| 0 | 环境预检 | 调 `GET /api/init/preflight`，展示 8 项检查结果，全部 `ok`/`warn` 才允许下一步 |
| 1 | 运行模式 | 选择"演示模式 / 生产模式"（生产模式禁用演示账号 seed，演示模式直接跳到 Step 4 提交） |
| 2 | 站点信息 | 站点名称（与原 Step 1 相同） |
| 3 | 管理员账号 | 邮箱（生产模式必填可改，演示模式只读）+ 用户名 + 密码 + 确认密码 |
| 4 | 启用游戏 | 与原 Step 3 相同 |
| 5 | 完成 | 展示总结（站点名/管理员邮箱/模式/启用 Pack 数），引导登录 |

**关键改造点**：

1. **Step 0 预检**：
   - 调 `getInitPreflight()`，渲染列表（icon + label + status + detail）
   - `error` 项禁止继续，展示"需在服务器执行：xxx"提示
   - `warn` 项允许继续但需用户勾选确认（如 SQLite 用于生产）
2. **Step 1 模式选择**：演示模式选中后展示"将创建 5 个演示实例 + 3 个演示账号"说明；生产模式展示"将仅创建 1 个待初始化管理员账号"说明
3. **Step 3 密码实时校验**：
   - 调 `getPasswordPolicy()` 拉取规则
   - 输入时实时计算 zxcvbn score 并展示评分条（0-4）
   - 显示具体失败项（"密码必须包含字母"/"zxcvbn 评分不足，建议加数字符号"等）
   - **禁止 `admin123` 等弱密码**：前端硬拦截并提示"该密码为默认密码，必须修改"
4. **错误展示**：`POST /api/init` 失败时，若返回 `WEAK_PASSWORD` 错误，必须展示 `details.failures` 全部条目，不再只 `toast.error(err.message)`
5. **BUILD footer**：在 `.setup-page` 容器最底部（`setup-card` 之外）添加：
   ```tsx
   <footer className="app-footer-build">
     © {new Date().getFullYear()} GSP · Game Server Panel · BUILD {BUILD_ID}
   </footer>
   ```
   - 引入 `import { BUILD_ID } from '../buildInfo';`
   - **不在表单字段 span 下方重复渲染**（避免违反 rules-0/1 的"唯一 BUILD 序列"约束）

### 4.7 前端：API client 扩展

**文件**：[panel/frontend/src/api/client.ts#L1850-L1863](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/api/client.ts#L1850-L1863)

```ts
getInitPreflight() {
  return request<InitPreflightResponse>('/init/preflight');
},
getPasswordPolicy() {
  return request<PasswordPolicyResponse>('/auth/password-policy');
},
submitInit(req: {
  site_name: string;
  admin?: { email?: string; username?: string; password: string };
  admin_password?: string;   // 向后兼容
  enabled_packs: string[];
  mode?: 'demo' | 'production';
  database_ack?: boolean;
}) {
  return request<InitSubmitResponse>('/init', { method: 'POST', body: JSON.stringify(req) });
},
```

### 4.8 契约同步

**文件**：

- [public/schema/panel-api-types.ts](file:///home/airxw/Documents/gsp/gameserver-panel/public/schema/panel-api-types.ts)：新增 `InitPreflightResponse` / `PasswordPolicyResponse` / `InitSubmitResponse`，扩展 `InitRequest`
- [public/interface_stub/panel-rest.ts](file:///home/airxw/Documents/gsp/gameserver-panel/public/interface_stub/panel-rest.ts)：新增 `getInitPreflight` / `getPasswordPolicy` 签名，更新 `submitInit` 签名
- [public/schema/CHANGELOG.md](file:///home/airxw/Documents/gsp/gameserver-panel/public/schema/CHANGELOG.md)：MINOR 级变更记录

**注意**：以上均为 `public/` 目录下文件，按 [rules-0 §四-10](file:///home/airxw/Documents/gsp/gameserver-panel/.trae/rules/rules-0.md) 与 [rules-4 §4.3](file:///home/airxw/Documents/gsp/gameserver-panel/.trae/rules/rules-4.md) 受保护，**修改前需经人类显式授权**（本方案审批即视为授权）。

### 4.9 数据库 migration

新增 migration `20260808000001_system_mode_and_preflight.ts`（时间戳必须晚于 `20260807000001_unify_bindings_and_multi_role.ts`，确保多角色重构先执行）：

- `system_config` 表无需结构变更（KV 表，直接写入新 key 即可）
- 仅在 migration 中 seed `system.mode = 'production'`（演示模式由 env 覆盖）
- seed `system.preflight_passed = false`

**注意**：现有部署升级时，`system.mode` 与 `system.preflight_passed` 缺失会导致 `detectInitStatus` 误判为"需要初始化"。需在 migration 中检测：

- 若 `users` 表中已有非默认 admin（`email NOT LIKE '%@local.dev'`）或 `password_changed_at IS NOT NULL`，则同步写入 `system.mode = 'production'` 与 `system.preflight_passed = true`，避免已初始化的部署被强制再次进入向导。
- **v4.18.0 适配**：迁移时若发现 users 表已有 `roles`/`active_role` 字段（v4.17.0 已迁移），跳过 `seedProvisionalAdminIfEmpty` 调用，避免覆盖现有 admin 配置

---

## 五、执行步骤

> 按依赖顺序串行执行；每个步骤完成后必须通过 `npm run verify`（前端/后端各自）+ 人工 browser 验证才能进入下一步。

### 步骤 1：契约层（public/）

1. 编辑 `public/schema/panel-api-types.ts`：新增 `InitPreflightResponse` / `PasswordPolicyResponse` / `InitSubmitResponse` 类型，扩展 `InitRequest`
2. 编辑 `public/interface_stub/panel-rest.ts`：新增 `getInitPreflight` / `getPasswordPolicy` 接口签名，更新 `submitInit` 签名
3. 编辑 `public/schema/CHANGELOG.md`：登记 MINOR 变更
4. 编辑 `public/pre_generated_mock/`：同步生成对应 mock（供前端并行开发）

### 步骤 2：后端 - 密码策略公开化

1. 编辑 `panel/backend/src/services/passwordPolicy.ts`：导出 `PASSWORD_POLICY_RULES` 与 `FORBIDDEN_PASSWORDS`
2. 在 `panel/backend/src/api/routes/auth.ts`（或新建 `passwordPolicy.ts` 路由）中添加 `GET /api/auth/password-policy` 公开接口
3. 编辑 `panel/backend/src/api/routes/settings.ts`：在 `POST /api/init` 中追加"禁止弱密码"校验（在 `checkPasswordStrength` 之后）
4. 运行 `npm run verify`（后端）

### 步骤 3：后端 - Seed 门控收紧

1. 编辑 `panel/backend/src/db/seed.ts`：新增 `seedProvisionalAdminIfEmpty`，仅 seed 一条 `admin@local.dev`，**同步设置 `roles`/`active_role` 字段**
2. 编辑 `panel/backend/src/index.ts#L77`：按 `VITE_ENABLE_DEMO` 分流 seed
3. 编写 migration `20260808000001_system_mode_and_preflight.ts`：seed `system.mode` 与 `system.preflight_passed`，含已初始化部署的兼容性检测
4. 运行 `npm run verify`（后端）

### 步骤 4：后端 - Preflight 接口实现

1. 编辑 `panel/backend/src/api/routes/settings.ts`：新增 `GET /api/init/preflight` 路由
2. 在 `panel/backend/src/services/` 下新建 `initPreflightService.ts`：实现 8 项检查（数据库、migrations、daemon、packs、db_config、mode、disk、public_url）
3. 在 `panel/backend/src/app.ts` 或 `services-init.ts` 中将 `packRegistry` / `daemonClient` 注入 `req.app.locals`
4. 编辑 `panel/backend/src/api/routes/settings.ts#L196-L217`：扩展 `detectInitStatus` 增加 `system.mode` 与 `system.preflight_passed` 检测
5. 编辑 `panel/backend/src/api/routes/settings.ts#L251-L378`：扩展 `POST /api/init` 处理 `admin.email/username`、`mode`、`database_ack`，成功提交时写入 `system.preflight_passed = true`
6. 运行 `npm run verify`（后端）

### 步骤 5：前端 - API client 与类型同步

1. 编辑 `panel/frontend/src/api/client.ts#L1850-L1863`：新增 `getInitPreflight` / `getPasswordPolicy`，扩展 `submitInit` 签名
2. 运行 `npm run verify`（前端 type-check）

### 步骤 6：前端 - SetupWizard 改造

1. 编辑 `panel/frontend/src/pages/SetupWizard.tsx`：
   - 重构为 5 步流程（Step 0 预检 → Step 1 模式 → Step 2 站点 → Step 3 管理员 → Step 4 Pack → Step 5 完成）
   - Step 0：调 `getInitPreflight()`，渲染检查列表
   - Step 1：模式选择（演示/生产）
   - Step 3：邮箱/用户名可编辑（生产模式），密码实时 zxcvbn 评分展示
   - 错误展示：`WEAK_PASSWORD` 时展示 `details.failures` 全部条目
   - 添加 `<footer className="app-footer-build">` 到 `.setup-page` 底部
   - 引入 `import { BUILD_ID } from '../buildInfo';`
2. 更新 `panel/frontend/src/styles/` 下 SetupWizard 相关 CSS：新增 preflight 列表样式、zxcvbn 评分条样式、模式选择卡片样式
3. 运行 `npm run verify`（前端 type-check + build）
4. 浏览器手动验证：`https://gsp.ecsrz.com:3001/setup` 走通全流程

### 步骤 7：测试

1. 后端单元测试：`initPreflightService` 8 项检查各自通过/失败场景
2. 后端集成测试：`POST /api/init` 接受新字段、拒绝弱密码、扩展 `detectInitStatus` 行为
3. 前端组件测试：SetupWizard 5 步流程渲染、密码实时校验、错误展示
4. E2E（Playwright）：`/setup` 全流程 PASS（生产模式 + 演示模式各跑一次）
5. `npm run check`（项目根统一校验）

### 步骤 8：版本与文档

1. 编辑 `version.md`：当前 `4.16.3` → `4.18.0`（中版本号递增：新增功能 + 契约 MINOR 变更；v4.17.0 已被统一绑定+多角色重构占用）
2. 编辑 `package.json` / `version.json` / `README.md` / `DEPLOY_VERSION`：同步版本号（参考 `npm run check` 校验）
3. 在 `version.md` 中追加 `4.18.0` 变更说明（含本方案 8 个改造点）
4. 若 `README.md` 需要更新初始化流程描述，同步更新

### 步骤 9：部署

1. SSH 到服务器，关闭现有部署：`sudo systemctl stop gameserver-panel gameserver-daemon`
2. 拉取最新代码到 `/opt/gameserver-panel/`
3. 执行 `deploy.sh`（含前端 build + 后端 build + migration + systemd 重启）
4. 验证 `https://gsp.ecsrz.com:3001/setup` 走通全流程
5. 验证 `https://gsp.ecsrz.com:3001/login` 用新管理员账号登录成功
6. 验证页面底部 `BUILD` 编号已更新（与 `version.md` 中 `4.17.0` 对应的 BUILD YYYYMMDD-XXX 一致）

---

## 六、开发事项清单

### 6.1 后端

- [ ] `panel/backend/src/services/passwordPolicy.ts` 导出 `PASSWORD_POLICY_RULES` 与 `FORBIDDEN_PASSWORDS`
- [ ] `panel/backend/src/api/routes/auth.ts` 或新建 `passwordPolicy.ts` 添加 `GET /api/auth/password-policy`
- [ ] `panel/backend/src/db/seed.ts` 新增 `seedProvisionalAdminIfEmpty`
- [ ] `panel/backend/src/index.ts` Seed 分流（演示 vs 生产）
- [ ] `panel/backend/src/db/migrations/20260808000001_system_mode_and_preflight.ts` 新建
- [ ] `panel/backend/src/services/initPreflightService.ts` 新建（8 项检查）
- [ ] `panel/backend/src/app.ts` 或 `services-init.ts` 注入 `packRegistry` / `daemonClient` 到 `req.app.locals`
- [ ] `panel/backend/src/api/routes/settings.ts` 新增 `GET /api/init/preflight`
- [ ] `panel/backend/src/api/routes/settings.ts` 扩展 `detectInitStatus`（`system.mode` + `system.preflight_passed`）
- [ ] `panel/backend/src/api/routes/settings.ts` 扩展 `POST /api/init`（`admin.email/username`、`mode`、`database_ack`、弱密码硬拦截）
- [ ] 后端单元测试 + 集成测试

### 6.2 前端

- [ ] `panel/frontend/src/api/client.ts` 新增 `getInitPreflight` / `getPasswordPolicy`，扩展 `submitInit`
- [ ] `panel/frontend/src/pages/SetupWizard.tsx` 重构为 5 步流程
- [ ] `panel/frontend/src/pages/SetupWizard.tsx` 添加 `<footer className="app-footer-build">` + `BUILD_ID` 引入
- [ ] `panel/frontend/src/styles/` 新增 preflight 列表 / zxcvbn 评分条 / 模式选择卡片样式
- [ ] 前端组件测试 + E2E 测试

### 6.3 契约

- [ ] `public/schema/panel-api-types.ts` 新增 `InitPreflightResponse` / `PasswordPolicyResponse` / `InitSubmitResponse`，扩展 `InitRequest`
- [ ] `public/interface_stub/panel-rest.ts` 新增接口签名
- [ ] `public/schema/CHANGELOG.md` 登记 MINOR 变更
- [ ] `public/pre_generated_mock/` 同步生成 mock

### 6.4 版本与文档

- [ ] `version.md` `4.16.3 → 4.18.0` + 变更说明
- [ ] `package.json` / `version.json` / `README.md` / `DEPLOY_VERSION` 同步
- [ ] `npm run check` 通过

---

## 七、风险与建议

### 7.1 风险

1. **已初始化部署的兼容性**：现有部署升级后，`system.mode` 与 `system.preflight_passed` 缺失会被 `detectInitStatus` 误判为"需要初始化"，强制用户重新走向导。**已在 migration 中通过"检测现有 admin 状态自动 seed 配置项"缓解**。
2. **Seed 门控收紧的破坏性**：生产环境若已依赖 `manager@local.dev` / `user@local.dev` 账号做演示或测试，升级后这两个账号不再自动 seed。**建议**：在 migration 中检测这两个账号是否存在，存在则保留，不存在则不创建（不主动删除已有数据）。
3. **管理员邮箱变更的副作用（v4.18.0 适配）**：用户在向导中改邮箱后，原 `admin@local.dev` 记录被更新。v4.17.0 多角色重构后 JWT payload 含 `email` / `roles` / `active_role` 三个字段，邮箱变更会导致旧 JWT 中的 `email` 与数据库不一致。**应对策略**：
   - 邮箱变更时同步 `users.token_version = token_version + 1`，利用现有 `token_version` 机制使旧 JWT 失效（[jwt.ts](file:///home/airxw/Documents/gsp/gameserver-panel/panel/backend/src/core/auth/jwt.ts) 已实现 token_version 校验）
   - `roles` / `active_role` 在向导中不暴露修改入口（admin 角色固定为 `server_admin`），避免用户误改角色导致权限丢失
4. **`public/` 目录修改需授权**：本方案涉及 `public/schema/` 与 `public/interface_stub/` 修改，按 [rules-0 §四-10](file:///home/airxw/Documents/gsp/gameserver-panel/.trae/rules/rules-0.md) 必须经人类显式授权。**本方案审批即视为授权**。
5. **Preflight 接口性能**：8 项检查若同步执行可能拖慢首次访问。**建议**：用 `Promise.all` 并发执行，整体响应时间控制在 2s 内。
6. **zxcvbn 前端体积**：zxcvbn 库 + 字典约 400KB，前端打包会变大。**建议**：使用 `zxcvbn-ts` 的按需加载，或仅在 SetupWizard / 改密页 lazy import。
7. **v4.17.0 并行实施的依赖**：v4.17.0"统一绑定+多角色重构"实施中（[current-note.md#L13](file:///home/airxw/Documents/gsp/gameserver-panel/current-note.md#L13)），本方案 v4.18.0 必须等 v4.17.0 部署完成后才能发布，否则 migration 顺序冲突（`20260808000001` 必须晚于 `20260807000001`）。**建议**：v4.18.0 实施期间若 v4.17.0 还未部署，需协调发布顺序，避免开发库中两个 migration 同时未上生产。

### 7.2 建议

1. **不在向导内允许修改 `.env`**：数据库连接、JWT_SECRET、DAEMON_URL 等敏感配置项仍需 SSH 修改 `.env`，向导仅做"展示 + 确认"，避免引入"通过 Web 改后端配置"的安全风险。
2. **演示模式向导"轻量化"**：演示模式下向导仅展示 preflight + 模式确认两步，不进入改密/邮箱/Pack 选择，避免用户误改演示数据。
3. **`system.mode` 写入后只读**：在管理后台设置页中展示 `system.mode` 但禁止修改（修改需 SSH 改 env 后重启）。
4. **BUILD footer 与版本号联动**：建议将 `BUILD_ID` 生成脚本与 `version.md` / `package.json` 版本号联动，避免 BUILD 与版本不一致。
5. **向导"跳过初始化"按钮移除**：当前 [SetupWizard.tsx#L190-L196](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/SetupWizard.tsx#L190-L196) 提供"跳过初始化"按钮，跳过后 `needs_init` 仍为 true，下次访问又进入向导。**建议**：移除跳过按钮，或跳过时同步写入 `system.preflight_passed = true` + `system.mode = 'production'`，并提示"跳过后请通过 SSH 修改 admin 密码"。

---

## 八、验证清单

部署完成后必须逐项验证：

- [ ] `https://gsp.ecsrz.com:3001/setup` 打开后先展示 preflight 检查列表（8 项）
- [ ] preflight 中 `database` / `migrations` / `daemon` / `packs` 4 项 status 为 `ok`
- [ ] 模式选择步骤可选"演示/生产"，生产模式选中后下方说明文字正确
- [ ] 管理员邮箱字段可编辑（生产模式），输入 `ops@example.com` 后提交成功
- [ ] 密码字段输入 `admin123` 时实时显示"该密码为默认密码，必须修改"
- [ ] 密码字段输入弱密码（如 `qwerty12`）时显示 zxcvbn 评分条 + 具体失败项
- [ ] 提交成功后 `system_config` 表中 `system.mode` / `system.preflight_passed` 已写入
- [ ] `users` 表中原 `admin@local.dev` 记录的 `email` 已更新为用户输入值
- [ ] `users` 表中 `manager@local.dev` / `user@local.dev` 不存在（生产模式）
- [ ] 页面底部展示 `© 2026 GSP · Game Server Panel · BUILD YYYYMMDD-XXX`
- [ ] `version.md` 显示 `4.18.0`，与 `package.json` / `version.json` / `README.md` / `DEPLOY_VERSION` 一致
- [ ] `npm run check` 通过
- [ ] 已初始化的旧部署升级后不会被强制再次进入向导（migration 兼容性）

---

## 九、版本影响

- 当前版本：`4.16.3`（v4.17.0 统一绑定+多角色重构实施中，未发布）
- 目标版本：`4.18.0`（中版本号递增：新增功能 + 契约 MINOR 变更；v4.17.0 已被占用，本方案递增到 v4.18.0）
- 不调整大版本号（遵循 [bb.md](file:///home/airxw/Documents/gsp/gameserver-panel/.trae/rules/bb.md)）
- 小版本号重置为 0
- **依赖**：v4.18.0 必须在 v4.17.0 部署完成后发布（migration 时间戳依赖）

---

## 十、参考

- [rules-0 §四-7.2 ec7_action_gate](file:///home/airxw/Documents/gsp/gameserver-panel/.trae/rules/rules-0.md)（public/ 保护）
- [rules-0 §四-10 public/ 保护](file:///home/airxw/Documents/gsp/gameserver-panel/.trae/rules/rules-0.md)
- [rules-3 §六 契约版本化规则](file:///home/airxw/Documents/gsp/gameserver-panel/.trae/rules/rules-3.md)
- [rules-1.md 页面底部 BUILD 规范](file:///home/airxw/Documents/gsp/gameserver-panel/.trae/rules/1.md)
- [bb.md 版本号规则](file:///home/airxw/Documents/gsp/gameserver-panel/.trae/rules/bb.md)
