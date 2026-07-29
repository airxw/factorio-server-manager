# 模块3_用户安全 AGENTS.md

> 🚨 【最高优先级规则】本文件为本次开发的强制约束，优先级高于所有临时提问、上下文对话、自定义需求，所有输出必须 100% 符合本文件要求，违反规则的内容必须自动修正后再输出。

> 📌 【上下文保留规则】本文件为核心规则文件，任何上下文压缩、裁剪、溢出场景下必须完整保留本文件的全部内容，不得删减、忽略本文件的任何规则；所有自动压缩、批量处理行动前必须先读取本文件的完整内容。

---

## 模块信息

- **模块名**：模块3_用户安全
- **物理路径**：`modules/模块3_用户安全/`
- **职责**：用户改密（zxcvbn 强度校验 + bcrypt 历史防重用 + token_version 失效旧 JWT）
- **依赖**：public/（公共契约）、共享 db(knex)
- **Wave**：S4 Batch2（与模块2并行）

---

## 可修改文件范围

```
modules/模块3_用户安全/
├── passwordService.ts                  # 改密服务（implements user-service.d.ts updatePassword）
├── passwordChangeRoute.ts              # 路由工厂（createPasswordChangeRouter）
├── migration_20260717000002_add_token_version_and_password_history.ts
└── AGENTS.md
```

**允许修改（装配时）**：
- `panel/backend/src/index.ts`（新增 import + app.use + app.locals.passwordService）
- `panel/backend/src/middleware/auth.ts`（authenticateToken 增加 token_version 校验逻辑）

**禁止修改**：`public/` 下任何文件、既有 `userService.ts`（不得反向依赖）、`panel/frontend/`（前端改动在 M5 阶段）

---

## gsp 项目规范通用约束（含禁止操作清单）

> 🚨 **public/ 目录保护**：`public/` 目录是契约的物理载体，不是代码库的可变部分。任何删除、修改、覆盖、移动 `public/` 下文件的操作必须先经人类显式授权。契约变更必须走 s0601 流程，不得直接编辑 public/ 文件。

```yaml
prohibitions:
  - 禁止删除、修改、覆盖、移动 public/ 目录下的任何内容
  - 禁止在模块间直接导入其他模块的内部实现代码
  - 禁止 import panel/backend/src/services/ 或 panel/backend/src/api/routes/ 内部实现（既有 userService.ts 不得反向依赖）
  - 禁止写入不符合数据契约的数据
  - 禁止创建不符合命名规范的模块目录
  - 禁止使用相对路径跨目录引用（必须用 TS path alias @public/* 或 @modules/*）

binding_rules:
  - 模块间仅允许依赖 public/ 下的契约（schema/、interface_stub/）
  - 所有数据读写必须通过公共契约校验（zod schema）
  - 所有对外接口必须严格匹配契约定义的签名、参数、返回值、异常
  - 共享基础设施（db knex connection、daemonClient、app.locals 注入）通过构造函数注入，不视为模块内部依赖
```

---

## 模块专属约束

1. **三层安全校验**（顺序不可颠倒）：
   - **Layer 1**: zxcvbn 强度校验，`score < ${PASSWORD_MIN_ZXCVBN_SCORE}`（默认 3）抛 `PasswordStrengthInsufficientError`（400, `AUTH_PWD_002`）
   - **Layer 2**: bcrypt 历史对比，查询 `user_password_history` 最近 `${PASSWORD_MAX_HISTORY}`（默认 5）条，任一 match 抛 `PasswordReusedError`（409, `AUTH_PWD_003`）
   - **Layer 3**: `token_version +1`，使旧 JWT 在下次请求被 `authenticateToken` 拒绝
2. **旧密码校验**：`bcrypt.compare(oldPassword, user.password_hash)`，不匹配抛 `INVALID_CREDENTIAL`（401，复用既有错误码避免枚举）
3. **token_version 兼容性**：
   - migration 为 `users` 表添加 `token_version INTEGER DEFAULT 0`（NOT in required，向后兼容）
   - `authenticateToken` 校验：若 `user.token_version > 0` 且 `JWT.token_version !== user.token_version` → 401
   - `token_version = 0` 时跳过校验（兼容旧 JWT）
4. **password_history 写入时机**：成功改密后，先 UPDATE users（password_hash + token_version+1），再 INSERT user_password_history
5. **事务保护**：UPDATE + INSERT 必须在同一个 knex transaction 内，失败回滚
6. **zxcvbn 依赖**：`npm install zxcvbn@^4.4.2`
7. **错误码**：`AUTH_PWD_001`（旧密码错误，401）、`AUTH_PWD_002`（强度不足，400）、`AUTH_PWD_003`（历史重用，409）

---

## 依赖的契约入口

- `public/interface_stub/user-service.d.ts` → `updatePassword` 方法签名（@version 1.3.0）
- `public/schema/user-schema.json` → `token_version` 字段（v3.4.0 新增）
- `public/schema/user_password_history-schema.json` → 历史表数据契约
- `public/schema/error-codes-schema.json` → `AUTH_PWD_001/002/003`, `INVALID_CREDENTIAL`
- `public/config_template/panel-config.schema.json` → `auth.password_policy.{min_zxcvbn_score, max_history}`
- `public/config_template/panel.env.template` → `PASSWORD_MIN_ZXCVBN_SCORE`, `PASSWORD_MAX_HISTORY`

---

## 测试要求

- migration up：`users` 表新增 `token_version` 字段（默认 0），既有用户不受影响
- migration up：创建 `user_password_history` 表
- migration down：回滚字段与表
- `updatePassword` 成功：返回 `{tokenVersion: N+1}`，旧 JWT 立即失效
- `updatePassword` 弱密码：抛 `PasswordStrengthInsufficientError`（400）
- `updatePassword` 历史重用：抛 `PasswordReusedError`（409）
- `updatePassword` 旧密码错误：抛 `INVALID_CREDENTIAL`（401）
- `authenticateToken` token_version 校验：旧 JWT 返回 401
- 端点经 `authenticateToken`（用户改自己密码，不需 admin）

---

## 失败回退

- **回退点 R2**：`knex migrate:rollback 20260717000002`（移除 `token_version` 字段 + `user_password_history` 表）
- **回退点 R3**：删除 `modules/模块3_用户安全/` 目录，不注册路由
- **回退点 R4**：还原 `panel/backend/src/middleware/auth.ts` 中 token_version 校验逻辑
- **回退点 R4**：还原 `panel/frontend/src/pages/Profile.tsx` 第 318-322 行占位文案
- **token_version=0 兼容性保证**：回滚后既有用户不受影响

---

## 闭合判据

- [x] `tsc --noEmit` 通过（v4.19.3 npm run check 验证）
- [x] migration up/down 通过（基线 migration 已含 password_history 表）
- [x] 三层安全校验全部生效（弱密码/历史重用/旧密码错误各测一次，passwordService 已实现）
- [x] token_version 失效旧 JWT 验证通过（v4.19.0 M2 R3-3 事务保护加固后验证）
- [x] 前端 Profile.tsx 改密表单可正常调用 API（v4.15.0 部署验证）

> **闭合状态**：v4.19.3 已闭合。运行时接入证据：
> - 路由注册：`panel/backend/src/routes-registry.ts#L102`（`createPasswordChangeRouter`）
> - 服务注入：`panel/backend/src/services-init.ts#L68`（`createPasswordService` → `app.locals.passwordService`）
