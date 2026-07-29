---
type: plan
title: 统一绑定体系与多角色切换重构方案（方案C-激进重设计）
date: 2026-07-25
status: v1.1 已批准进入实施（GN-004 复审通过：14 项 PASS + 1 项已即时修正；人类裁决批准从步骤1开始）
related: [绑定体系重构, 角色切换, 首页信息架构, 权限矩阵, 游戏事件订阅]
tags: [plan, radical, binding-unification, multi-role, permission-matrix, event-driven-verify]
approved_at: 2026-07-25
implementation_phase: 步骤1进行中（s0601 契约变更流程）
---

# 统一绑定体系与多角色切换重构方案（方案C-激进重设计）

## 0. 决策上下文

### 0.1 用户已确认的 3 个核心决策

经 s0101 需求闭合结构化 + AskUserQuestion 人类裁决，确认以下大方向（不可违背）：

1. **三套绑定表全部统一**：合并 `user_instance_bindings`（用户↔实例，账户级VIP/钱包）+ `player_bindings`（用户↔游戏类型玩家名，无 server_id，跨实例全局）+ `player_verify_codes`（用户↔实例玩家名，5分钟过期，游戏内 !verify 命令消费）为单一绑定模型。
2. **users.role 改为多值集合**：一个账号同时拥有多身份（如 user + instance_admin），可切换工作台视角。
3. **/guild 首页整体重做信息架构**：现有两个绑定入口（空状态"立即绑定" + QUICK_ACTIONS"绑定角色"）都跳 /guild/bind，行为重复，需重做。

### 0.2 方案选定

经 s0102 多方案对抗（保守A / 平衡B / 激进C 三方案由独立 subagent 在隔离上下文中并行生成），用户通过 AskUserQuestion 直接选定**方案C-激进重设计**。

### 0.3 方案核心理念

> 当存量设计已形成"三套并行模型 + 多处入口重复 + 权限硬绑角色"的耦合债务时，渐进式双写过渡只会把债务延长为永久性技术负担。激进重设计的合法性来自三件事：(1) 数据模型本身简单（三套表本质都是 user×scope 的多态绑定）；(2) 迁移路径线性可逆（旧表数据可被纯函数映射到新表）；(3) 现有 demo 模式可被显式隔离保护。本方案拒绝"加字段、不删表"的妥协——旧表必须物理删除，否则会留下"两个真相源"的长期隐患。

---

## 1. 方案概要

**一句话定位**：以"一次性阵痛"换取长期可维护性——将三套绑定表物理合并为单一 `bindings` 模型、将单值 `role` 字段升级为"多角色 + 权限点矩阵 + 会话固定 active_role"、彻底废弃游戏内 `!verify` 命令依赖改走事件订阅，并以统一信息架构重做 `/guild` 首页。

**设计倾向关键词**：
- 彻底重构（refactor-from-scratch）
- 单一真相源（single source of truth）
- 权限点解耦（permission-point decoupling）
- 事件驱动验证（event-driven verification）
- 一次性迁移（big-bang migration）

---

## 2. 数据模型设计

### 2.1 统一后的 `bindings` 表结构

> 设计哲学：三套旧表本质都是"user × 作用域 × 凭据"的多态绑定。统一表用 `binding_type` 区分账户级 vs 游戏角色级，用 `scope_type + scope_ref` 多态引用作用域，用 `verify_*` 字段统一处理验证生命周期。

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| `id` | INTEGER | PK, AUTOINCREMENT | 主键 |
| `user_id` | TEXT (UUID) | NOT NULL, FK → users.id ON DELETE CASCADE | 所属用户 |
| `binding_type` | TEXT | NOT NULL, CHECK IN ('account','player') | 绑定类型：账户级 / 游戏角色级 |
| `scope_type` | TEXT | NOT NULL, CHECK IN ('instance','game_type','global') | 作用域类型 |
| `scope_ref` | TEXT | NULLABLE | 作用域引用：instance_id / game_type / NULL(global) |
| `player_name` | TEXT | NULLABLE | 游戏内玩家名（仅 binding_type='player' 有值） |
| `vip_level` | INTEGER | NOT NULL DEFAULT 0 | VIP 等级（仅 binding_type='account' 有意义） |
| `wallet_id` | TEXT (UUID) | NULLABLE, FK → wallets.id ON DELETE SET NULL | 钱包外键（仅 binding_type='account'） |
| `verify_status` | TEXT | NOT NULL DEFAULT 'pending', CHECK IN ('pending','verified','expired','revoked') | 验证状态 |
| `verify_code` | TEXT | NULLABLE | 验证码（pending 态有值） |
| `verify_expires_at` | TEXT (ISO8601) | NULLABLE | 验证码过期时间 |
| `verified_at` | TEXT (ISO8601) | NULLABLE | 验证完成时间 |
| `metadata` | TEXT (JSON) | NOT NULL DEFAULT '{}' | 扩展字段（游戏特有属性、来源标记等） |
| `created_at` | TEXT (ISO8601) | NOT NULL | 创建时间 |
| `updated_at` | TEXT (ISO8601) | NOT NULL | 更新时间 |

### 2.2 约束与索引

**CHECK 约束（语义完整性）**：
- `binding_type='player'` 时 `player_name IS NOT NULL`
- `binding_type='account'` 时 `scope_type='instance'`（账户级绑定必然关联到具体实例）
- `scope_type='global'` 时 `scope_ref IS NULL`
- `scope_type IN ('instance','game_type')` 时 `scope_ref IS NOT NULL`
- `verify_status='pending'` 时 `verify_code IS NOT NULL AND verify_expires_at IS NOT NULL`
- `verify_status='verified'` 时 `verified_at IS NOT NULL AND verify_code IS NULL`

**唯一索引（业务唯一性，SQLite 兼容）**：
> ⚠️ SQLite 表定义不支持 partial UNIQUE constraint（`UNIQUE(...) WHERE ...` 语法在 CREATE TABLE 中无效），改用 partial UNIQUE INDEX 实现。

- `CREATE UNIQUE INDEX idx_bindings_verified_unique ON bindings(user_id, binding_type, scope_type, scope_ref, player_name) WHERE verify_status='verified'` —— 已验证的绑定在作用域内唯一
- pending 态由应用层保证唯一（重复申请时 UPDATE 而非 INSERT，见 §6.4），DB 层不强制

**索引**：
- `idx_bindings_user` ON (user_id)
- `idx_bindings_type_scope` ON (binding_type, scope_type, scope_ref)
- `idx_bindings_verify_pending` ON (verify_code) WHERE verify_status='pending' —— webhook 回调快速定位
- `idx_bindings_player_lookup` ON (scope_type, scope_ref, player_name) WHERE binding_type='player' —— 游戏事件反查用户

### 2.3 `binding_type` 字段语义

| binding_type | scope_type | 语义 | 旧表对应 |
|--------------|-----------|------|---------|
| `account` | `instance` | 用户↔实例的账户级绑定（VIP/钱包） | `user_instance_bindings` |
| `player` | `game_type` | 用户↔游戏类型玩家名（跨实例全局） | `player_bindings` |
| `player` | `instance` | 用户↔实例玩家名（验证码绑定，废弃 !verify 后的新形态） | `player_verify_codes`（pending 态） + 验证通过的稳定态 |

### 2.4 与旧表的映射关系

> ⚠️ v1.1 修正（GN-004 审查 B1/B3）：补充 `user_instance_bindings.status`、`player_bindings.status`、`player_verify_codes.used_at` 三处遗漏字段映射。

| 旧表 | 旧字段 | → 新表字段 | 映射规则 |
|------|--------|-----------|---------|
| `user_instance_bindings` | user_id | user_id | 直接映射 |
| | instance_id | scope_ref | scope_type='instance' |
| | vip_level | vip_level | 直接映射 |
| | wallet_id | wallet_id | 直接映射 |
| | **status** | **verify_status** | **'active' → 'verified'；'unbound' → 'revoked'**（旧表 status 字段含义：active=已绑定，unbound=已解绑） |
| | — | binding_type | 固定 'account' |
| | — | verified_at | 若 status='active' 则取 created_at（旧表无独立 verified_at 字段，用创建时间近似）；若 status='unbound' 则 NULL |
| `player_bindings` | user_id | user_id | 直接映射 |
| | game_type | scope_ref | scope_type='game_type' |
| | player_name | player_name | 直接映射 |
| | **status** | **verify_status** | **'pending' → 'pending'；'verified' → 'verified'；'rejected' → 'revoked'** |
| | **verify_code** | **verify_code** | **仅 status='pending' 时有值；'verified'/'rejected' 时 NULL**（旧表 verified_at 字段也按此规则映射） |
| | **verified_at** | **verified_at** | **若 status='verified' 则取旧表 verified_at；否则 NULL** |
| | — | binding_type | 固定 'player' |
| `player_verify_codes` | user_id | user_id | 直接映射 |
| | server_id | scope_ref | scope_type='instance' |
| | player_name | player_name | 直接映射 |
| | code | verify_code | 直接映射（仅 pending 态保留；verified 态 NULL） |
| | expires_at | verify_expires_at | 直接映射 |
| | **used_at** | **verified_at** | **若 used_at IS NOT NULL → verify_status='verified', verified_at=used_at, verify_code=NULL** |
| | — | binding_type | 固定 'player' |
| | — | verify_status | 综合判定：`used_at IS NOT NULL` → 'verified'；`used_at IS NULL AND expires_at > NOW()` → 'pending'；`used_at IS NULL AND expires_at <= NOW()` → 'expired' |

### 2.5 数据迁移路径

```
[前置] 数据库全量备份（SQL dump + 文件快照）
  ↓
[Step 1] 创建 bindings 表（空表，含全部约束与索引）
  ↓
[Step 2] 创建 permission_points、role_permission_templates 表（见 §3）
  ↓
[Step 3] ALTER TABLE users ADD COLUMN roles TEXT, ADD COLUMN active_role TEXT
  ↓
[Step 4] 数据搬运（按映射规则 INSERT INTO bindings SELECT ... FROM 旧表）
         - user_instance_bindings → bindings (binding_type='account')
         - player_bindings → bindings (binding_type='player', scope_type='game_type')
         - player_verify_codes → bindings (binding_type='player', scope_type='instance')
  ↓
[Step 5] users.role → users.roles（单值包装为 JSON 数组）+ users.active_role = users.role
  ↓
[Step 6] 一致性校验（行数对账、关键字段抽样核对，见 §4.4）
  ↓
[Step 7] DROP TABLE user_instance_bindings, player_bindings, player_verify_codes
  ↓
[Step 8] （过渡期保留 users.role，不在此脚本删除；下版本删除）
  ↓
[Step 9] 更新 Knex schema 文件（删除旧 schema、新增 bindings schema）
  ↓
[Step 10] 走 s0601 流程更新 public/schema/ 契约文件
```

### 2.6 `public/schema/` 契约变更说明（走 s0601 流程）

> ⚠️ public/ 目录受 rules-0 §四-10 保护，所有变更必须经人类显式授权并走 s0601 适配流程。

**需新增的契约文件**：
- `public/schema/bindings.schema.json` —— 统一绑定数据契约
- `public/interface_stub/bindings.d.ts` —— 绑定服务接口存根
- `public/schema/permission-points.schema.json` —— 权限点字典
- `public/schema/role-permission-templates.schema.json` —— 角色权限模板

**需标记废弃（不物理删除，加 @deprecated 注释 + CHANGELOG 记录）**：
- `public/schema/player-bindings-schema.json`
- `public/schema/verify-codes-schema.json`
- 若存在 `user-instance-bindings-schema.json` / `player-verify-codes-schema.json` 同样标记

**需修改的契约文件**：
- `public/schema/user-schema.json` —— 新增 `roles`、`active_role` 字段，标记 `role` 字段为 @deprecated（过渡期保留）
- `public/schema/panel-api-types.ts` —— `PlayerBindingSummary` 类型扩展为 `Binding` 类型；新增 `PermissionPoint` / `RolePermissionTemplate` 类型
- `public/schema/CHANGELOG.md` —— 记录 MAJOR 版本变更（字段删除、类型变更）

**v1.1 修正 GN-004 A8：补充配置契约、Mock 与测试套件**

> ⚠️ rules-3 §三"禁止业务代码硬编码配置参数"——以下可配置参数必须走配置契约，不能硬编码在业务代码中。

**需新增的配置契约文件**（`public/config_template/`）：

| 配置文件 | 用途 | 关键字段 | 默认值 |
|---------|------|---------|--------|
| `binding.config.json` | 绑定流程可调参数 | `verify_code_ttl_seconds`（验证码有效期，默认 300=5min）<br>`verify_code_length`（验证码位数，默认 6）<br>`verify_code_max_attempts`（最大尝试次数，默认 5）<br>`verify_code_lockout_minutes`（锁定时长，默认 30）<br>`verify_code_format`（格式正则，默认 `^\d{6}$`） | 见左 |
| `permission.config.json` | 权限系统可调参数 | `cache_ttl_seconds`（权限缓存 TTL，默认 300）<br>`cache_max_entries`（LRU 容量上限，默认 100）<br>`cache_prewarm_on_startup`（启动预热，默认 true）<br>`fail_closed`（DB 不可用时是否拒绝，默认 true） | 见左 |
| `webhook.config.json` | Webhook 安全可调参数 | `hmac_algorithm`（默认 HMAC-SHA256）<br>`signature_header`（签名头名，默认 `X-GSP-Signature`）<br>`timestamp_header`（时间戳头名，默认 `X-GSP-Timestamp`）<br>`nonce_header`（nonce 头名，默认 `X-GSP-Nonce`）<br>`timestamp_tolerance_seconds`（时间窗口，默认 300=5min）<br>`nonce_cache_ttl_seconds`（nonce 去重缓存时长，默认 600=10min）<br>`secret_env_var`（密钥环境变量名，默认 `GSP_WEBHOOK_SECRET`） | 见左 |

**配置加载机制**：
- 服务启动时通过 zod schema 加载配置文件，自动补充缺失字段（zod default，符合 rules-3 §三 auto_fill 要求）
- 配置变更需重启服务（不提供运行时热加载，避免配置漂移）
- 敏感字段（如 webhook secret）从环境变量读取，不入库不入配置文件

**Mock 机制（符合 rules-3 §四）**：

> 契约冻结后，工具自动根据接口存根生成所有模块的默认 Mock 实现，开发阶段所有模块默认导入 `pre_generated_mock/` 下的 Mock，无需等待其他模块开发完成即可联调。

**需生成的 Mock 文件**（`public/pre_generated_mock/`）：
- `bindings.ts` —— 绑定服务 Mock（返回符合数据契约的模拟绑定数据，覆盖 verified/pending/expired/revoked 四态）
- `permission-service.ts` —— 权限服务 Mock（返回固定的权限点集合，覆盖 user/instance_admin/server_admin 三角色）
- `auth-service.ts` —— 认证服务 Mock（模拟单角色/多角色登录分叉、select-role 流程）
- `webhook-receiver.ts` —— Webhook 接收 Mock（模拟签名校验通过/失败两种场景）

**Mock 切换路径**：通过 tsconfig paths alias 切换，调用方零改动（仅切 alias 指向）。

**契约可验证性（符合 rules-3 §五）**：

> 每层契约必须附带可自主执行的测试套件与合规 rubric，独立审查交付前审查验证其通过状态。

**测试套件清单**（`public/test_cases/`）：

| 测试套件 | 覆盖契约 | 测试用例数 |
|---------|---------|----------|
| `bindings-contract.test.ts` | 数据契约：bindings.schema.json | ~30（覆盖 binding_type/scope_type/verify_status 全组合 + CHECK 约束违反用例） |
| `permission-points-contract.test.ts` | 数据契约：permission-points.schema.json | ~10（覆盖 category 枚举、code 命名规范） |
| `role-permission-templates-contract.test.ts` | 数据契约：role-permission-templates.schema.json | ~15（覆盖角色-权限点映射完整性、最小权限原则） |
| `bindings-api-contract.test.ts` | 接口契约：bindings.d.ts | ~20（覆盖 CRUD 签名匹配、异常契约） |
| `config-contract.test.ts` | 配置契约：3 个 config.json | ~15（覆盖默认值填充、字段取值范围） |

**合规 rubric**：
- 数据契约：所有字段有 zod schema 校验 + ajv 元校验；CHECK 约束在测试中触发违反用例验证
- 接口契约：模块实现签名严格匹配 .d.ts 存根；异常类型与契约一致
- 配置契约：默认值填充测试通过；敏感字段不从配置文件读取

**自测要求**：契约产出后 LLM 必须自主运行测试套件，结果记录于 `current-note.md`。

---

## 3. 多角色字段设计

### 3.1 `users` 表字段变更

| 字段 | 变更类型 | 类型 | 说明 |
|------|---------|------|------|
| `role` | **过渡期保留**（标记 @deprecated），下版本物理删除 | TEXT | 旧单值角色字段 |
| `roles` | **新增** | TEXT (JSON) | 角色集合，数组形式 |
| `active_role` | **新增** | TEXT | 当前活动角色（会话级，登录时选定） |

### 3.2 `users.roles` JSON 数组存储格式

```json
// 示例：一个账号同时是普通用户和实例管理员
{
  "roles": ["user", "instance_admin"],
  "active_role": "instance_admin"
}

// 示例：纯普通用户
{
  "roles": ["user"],
  "active_role": "user"
}

// 示例：服务器管理员（包含 user 是冗余的，不强制包含）
{
  "roles": ["server_admin"],
  "active_role": "server_admin"
}
```

**存储约束**：
- `roles` 必须是数组，元素为合法角色枚举值（user / instance_admin / server_admin）
- 数组元素唯一（同一角色不重复）
- `active_role` 必须 ∈ `roles`（应用层校验，SQLite 不支持 JSON 路径约束）
- `roles` 非空（至少一个角色）

### 3.3 权限矩阵重构设计

> 核心转变：权限不再硬绑 role，而是拆解为细粒度"权限点"（permission_points）。role 退化为"权限模板"，模板定义该角色默认拥有的权限点集合。用户实际权限 = active_role 对应模板的权限点集合。

**新增表 1：`permission_points`（权限点字典）**

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| `code` | TEXT | PK | 权限点代码（如 `instance.create`、`binding.verify`、`wallet.view`） |
| `description` | TEXT | NOT NULL | 权限点描述 |
| `category` | TEXT | NOT NULL | 分类（instance / binding / wallet / user / system） |
| `created_at` | TEXT (ISO8601) | NOT NULL | |

**新增表 2：`role_permission_templates`（角色权限模板）**

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| `role` | TEXT | PK 复合, CHECK IN ('user','instance_admin','server_admin') | 角色 |
| `permission_code` | TEXT | PK 复合, FK → permission_points.code ON DELETE CASCADE | 权限点 |
| `created_at` | TEXT (ISO8601) | NOT NULL | |

**预置权限点清单（v1.1 修正 GN-004 D2/D3：扩展至 30+ 类资源完整覆盖）**：

> ⚠️ 以下清单基于现有代码库 grep 出的 38 文件 147 处 `requireRole`/`requireAdmin` 调用反推整理，覆盖所有现有鉴权场景。完整清单需在 s0601 流程中由人类确认后冻结。

**实例与绑定类**：

| code | category | 默认归属角色 | 备注 |
|------|----------|------------|------|
| `instance.create` | instance | instance_admin, server_admin | 创建实例 |
| `instance.delete` | instance | server_admin | 删除实例 |
| `instance.view` | instance | user, instance_admin, server_admin | 查看实例（user 仅看自己绑定的） |
| `instance.update` | instance | instance_admin, server_admin | 修改实例配置 |
| `instance.start` | instance | instance_admin, server_admin | 启动/停止/重启实例 |
| `instance.console` | instance | instance_admin, server_admin | 控制台访问 |
| `binding.create` | binding | user, instance_admin, server_admin | 创建绑定 |
| `binding.verify` | binding | user, instance_admin, server_admin | 验证绑定 |
| `binding.revoke` | binding | user（自绑自解）, **instance_admin（管理其实例的玩家绑定）**, server_admin | v1.1 修正 D3：instance_admin 需管理其实例的玩家绑定 |
| `binding.view` | binding | user（自己）, instance_admin, server_admin | 查看绑定 |

**钱包与 VIP 类**：

| code | category | 默认归属角色 | 备注 |
|------|----------|------------|------|
| `wallet.view` | wallet | user（自己）, instance_admin, server_admin | 查看钱包 |
| `wallet.debit` | wallet | user | 扣款（用户消费） |
| `wallet.credit` | wallet | instance_admin, server_admin | 充值（管理员充值） |
| `wallet.claim_daily` | wallet | user | 领取每日福利 |
| `vip.set` | vip | server_admin | 设置 VIP 等级 |
| `vip.view` | vip | user（自己）, instance_admin, server_admin | 查看 VIP |

**用户与权限类**：

| code | category | 默认归属角色 | 备注 |
|------|----------|------------|------|
| `user.role.assign` | user | server_admin | 分配用户角色（含 active_role 修改） |
| `user.list` | user | server_admin | 用户列表 |
| `user.create` | user | server_admin | 创建用户 |
| `user.delete` | user | server_admin | 删除用户 |
| `user.view` | user | user（自己）, server_admin | 查看用户 |
| `role_permission.update` | user | server_admin | 修改角色权限模板（触发缓存失效，见 §8.4） |

**节点与资源类**：

| code | category | 默认归属角色 | 备注 |
|------|----------|------------|------|
| `node.register` | node | server_admin | 注册节点 |
| `node.delete` | node | server_admin | 删除节点 |
| `node.view` | node | instance_admin, server_admin | 查看节点 |
| `node.update` | node | server_admin | 更新节点配置 |
| `asset.upload` | asset | instance_admin, server_admin | 上传资源 |
| `asset.delete` | asset | instance_admin, server_admin | 删除资源 |
| `asset.view` | asset | instance_admin, server_admin | 查看资源 |
| `pack.install` | pack | server_admin | 安装游戏包 |
| `pack.delete` | pack | server_admin | 删除游戏包 |
| `pack.view` | pack | instance_admin, server_admin | 查看游戏包 |

**CDK 与商城类**：

| code | category | 默认归属角色 | 备注 |
|------|----------|------------|------|
| `cdk.create` | cdk | instance_admin, server_admin | 创建 CDK |
| `cdk.delete` | cdk | instance_admin, server_admin | 删除 CDK |
| `cdk.view` | cdk | instance_admin, server_admin | 查看 CDK |
| `cdk.redeem` | cdk | user | 兑换 CDK |
| `store.item.create` | store | instance_admin, server_admin | 创建商城商品 |
| `store.item.delete` | store | instance_admin, server_admin | 删除商城商品 |
| `store.item.view` | store | user, instance_admin, server_admin | 查看商品 |
| `store.purchase` | store | user | 购买商品 |
| `shop.config` | shop | instance_admin, server_admin | GM 商店配置 |
| `shop.view` | shop | instance_admin, server_admin | GM 商店查看 |

**实例运维类**：

| code | category | 默认归属角色 | 备注 |
|------|----------|------------|------|
| `backup.create` | backup | instance_admin, server_admin | 创建备份 |
| `backup.restore` | backup | instance_admin, server_admin | 恢复备份 |
| `backup.delete` | backup | instance_admin, server_admin | 删除备份 |
| `backup.view` | backup | instance_admin, server_admin | 查看备份 |
| `save.upload` | save | instance_admin, server_admin | 上传存档 |
| `save.download` | save | instance_admin, server_admin | 下载存档 |
| `save.delete` | save | instance_admin, server_admin | 删除存档 |
| `mod.install` | mod | instance_admin, server_admin | 安装 Mod |
| `mod.uninstall` | mod | instance_admin, server_admin | 卸载 Mod |
| `mod.view` | mod | instance_admin, server_admin | 查看 Mod |
| `file.upload` | file | instance_admin, server_admin | 上传文件 |
| `file.download` | file | instance_admin, server_admin | 下载文件 |
| `file.delete` | file | instance_admin, server_admin | 删除文件 |
| `file.view` | file | instance_admin, server_admin | 查看文件 |
| `cleanup.execute` | cleanup | instance_admin, server_admin | 执行清理 |
| `cleanup.view` | cleanup | instance_admin, server_admin | 查看清理任务 |
| `batch.execute` | batch | server_admin | 批量操作 |
| `batch.view` | batch | server_admin | 查看批量任务 |
| `operation.execute` | operation | server_admin | 运维操作 |
| `operation.view` | operation | server_admin | 查看运维记录 |

**游戏内交互类**：

| code | category | 默认归属角色 | 备注 |
|------|----------|------------|------|
| `chat.trigger.create` | chat | instance_admin, server_admin | 创建聊天触发器 |
| `chat.trigger.delete` | chat | instance_admin, server_admin | 删除聊天触发器 |
| `chat.trigger.view` | chat | instance_admin, server_admin | 查看聊天触发器 |
| `chat.send` | chat | instance_admin, server_admin | 发送游戏内消息 |
| `vote.create` | vote | instance_admin, server_admin | 创建投票 |
| `vote.delete` | vote | instance_admin, server_admin | 删除投票 |
| `vote.view` | vote | user, instance_admin, server_admin | 查看投票 |
| `vote.cast` | vote | user | 投票 |
| `periodic_message.create` | periodic_message | instance_admin, server_admin | 创建定时消息 |
| `periodic_message.delete` | periodic_message | instance_admin, server_admin | 删除定时消息 |
| `periodic_message.view` | periodic_message | instance_admin, server_admin | 查看定时消息 |
| `player.kick` | player | instance_admin, server_admin | 踢出玩家 |
| `player.ban` | player | instance_admin, server_admin | 封禁玩家 |
| `player.unban` | player | instance_admin, server_admin | 解封玩家 |
| `player.view` | player | instance_admin, server_admin | 查看玩家 |
| `lists.update` | lists | instance_admin, server_admin | 更新白名单/黑名单 |
| `lists.view` | lists | instance_admin, server_admin | 查看名单 |

**系统与安全类**：

| code | category | 默认归属角色 | 备注 |
|------|----------|------------|------|
| `system.config` | system | server_admin | 系统配置 |
| `system.view` | system | instance_admin, server_admin | 系统状态查看 |
| `system.health` | system | server_admin | 健康检查 |
| `system.deploy` | system | server_admin | 部署操作 |
| `quota.set` | quota | server_admin | 设置配额 |
| `quota.view` | quota | instance_admin, server_admin | 查看配额 |
| `monitor.view` | monitor | instance_admin, server_admin | 监控查看 |
| `monitor.alert.ack` | monitor | instance_admin, server_admin | 告警确认 |
| `maintenance.enable` | maintenance | server_admin | 启用维护模式 |
| `maintenance.disable` | maintenance | server_admin | 关闭维护模式 |
| `maintenance.view` | maintenance | user, instance_admin, server_admin | 查看维护状态 |
| `apikey.create` | apikey | server_admin | 创建 API Key |
| `apikey.delete` | apikey | server_admin | 删除 API Key |
| `apikey.view` | apikey | server_admin | 查看 API Key |
| `ssl.upload` | ssl | server_admin | 上传 SSL 证书 |
| `ssl.delete` | ssl | server_admin | 删除 SSL 证书 |
| `ssl.view` | ssl | server_admin | 查看 SSL 证书 |
| `tunnel.create` | tunnel | server_admin | 创建隧道 |
| `tunnel.delete` | tunnel | server_admin | 删除隧道 |
| `tunnel.view` | tunnel | server_admin | 查看隧道 |
| `webhook.create` | webhook | server_admin | 创建系统 Webhook |
| `webhook.delete` | webhook | server_admin | 删除系统 Webhook |
| `webhook.view` | webhook | server_admin | 查看系统 Webhook |
| `audit.view` | audit | server_admin | 查看审计日志 |
| `audit.export` | audit | server_admin | 导出审计日志 |
| `settings.update` | settings | instance_admin, server_admin | 实例设置更新 |
| `settings.view` | settings | instance_admin, server_admin | 实例设置查看 |
| `discover.view` | discover | user, instance_admin, server_admin | 发现页查看 |
| `platform_stats.view` | platform_stats | server_admin | 平台统计查看 |

**权限点总计**：约 90 个权限点，覆盖 30+ 类资源。

**权限计算公式**：
```
user_permissions = SELECT permission_code FROM role_permission_templates WHERE role = users.active_role
```

**角色权限模板汇总**（按角色反查）：

| 角色 | 权限点数量 | 主要范围 |
|------|----------|---------|
| `user` | ~15 | 自助操作（binding.create/verify/revoke/view、wallet.view/debit/claim_daily、vip.view、cdk.redeem、store.item.view/purchase、vote.view/cast、discover.view、instance.view、maintenance.view、user.view 自己） |
| `instance_admin` | ~60 | user 全部 + 实例管理（instance.create/update/start/console、binding.revoke 管理实例玩家、wallet.credit、backup/save/mod/file/cleanup、chat/vote/periodic_message/player/lists/settings、shop、monitor、node.view、asset、pack.view、cdk.create/delete/view、store.item.create/delete） |
| `server_admin` | ~90 | instance_admin 全部 + 系统级（instance.delete、user.role.assign/list/create/delete/view、role_permission.update、node.register/delete/update、pack.install/delete、system.*、quota.set、apikey/ssl/tunnel/webhook/audit、maintenance.enable/disable、batch/operation、platform_stats.view、vip.set） |

### 3.4 "当前活动角色"的存储与会话固定机制

**存储位置**：
- 持久层：`users.active_role` 字段（记录用户上次活动角色，用于下次登录默认选中）
- 会话层：JWT token 的 `active_role` claim（会话期间权威源）

**会话固定机制**：
1. **登录阶段**：用户输入凭证 → 后端校验 → 若 `users.roles` 长度 > 1，返回角色列表 → 前端展示"选择工作台视角" → 用户选定 → 后端签发 token（含 `active_role` claim，TTL = 会话有效期）
2. **会话期间**：每个请求由 auth 中间件从 token 解出 `active_role`，注入 `req.user.activeRole`。**不提供运行时切换 API**——`active_role` 在 token 生命周期内不可变
3. **持久化**：登录选定角色时，同步更新 `users.active_role`（作为下次登录默认选中项）
4. **切换机制**：前端"切换角色"按钮 → 调用 `/api/auth/logout` → 跳转登录页 → 重新走选角色流程

**为何不在会话中切换**（激进取舍的理由）：
- 避免"会话内权限漂移"导致审计日志混乱
- 简化前端状态管理（不需要全局响应式角色切换）
- 降低安全风险（token 不可变，无需考虑切换后的权限缓存失效）
- 代价：用户切换角色需重新登录（可接受，因多角色账号本身是少数场景）

### 3.5 兼容旧代码的策略

**过渡期（迁移完成后的 1-2 个版本）**：
- 保留 `users.role` 字段（由应用层从 `active_role` 派生，保持旧代码可读）
- 提供 `hasRole(role)` 兼容函数：等价于 `users.roles.includes(role)`
- 提供 `requireRole(role)` 兼容中间件：内部转为 `requirePermission(<对应权限点>)`
- 旧 API 响应中的 `role` 字段保留（= `active_role`），前端可平滑过渡

**迁移完成后（删除 role 字段时）**：
- 全局搜索 `users.role`、`req.user.role`、`hasRole` 调用点，逐个迁移到新模型
- 删除 `users.role` 列
- 删除兼容函数

**关键原则**：兼容层是"读时兼容"（旧代码可读新数据），不是"双写兼容"（不写 role 字段）。这避免了双真相源问题。

---

## 4. 迁移策略

### 4.1 迁移脚本设计

**Forward 脚本（`migrations/YYYYMMDDHHMMSS_unify_bindings_and_roles.ts`）**：

> ⚠️ v1.1 修正（GN-004 审查 B1/B3/B2）：Step 1 拆分为表定义+唯一索引创建；Step 8/9/10 按新映射规则补充 status/used_at/verified_at 字段处理。

```
事务开始
  1. CREATE TABLE bindings (... 含 CHECK 约束与普通索引，不含 partial UNIQUE — SQLite 表定义不支持)
  1.1 CREATE UNIQUE INDEX idx_bindings_verified_unique ON bindings(user_id, binding_type, scope_type, scope_ref, player_name) WHERE verify_status='verified'
  2. CREATE TABLE permission_points (...)
  3. CREATE TABLE role_permission_templates (...)
  4. ALTER TABLE users ADD COLUMN roles TEXT (JSON)
  5. ALTER TABLE users ADD COLUMN active_role TEXT
  6. INSERT INTO permission_points SELECT ... FROM (预置权限点字典)
  7. INSERT INTO role_permission_templates SELECT ... FROM (预置模板映射)
  8. INSERT INTO bindings (binding_type, scope_type, scope_ref, user_id, vip_level, wallet_id, verify_status, verified_at, created_at, updated_at)
       SELECT 
         'account' AS binding_type,
         'instance' AS scope_type,
         instance_id AS scope_ref,
         user_id,
         vip_level,
         wallet_id,
         CASE WHEN status='active' THEN 'verified' ELSE 'revoked' END AS verify_status,
         CASE WHEN status='active' THEN created_at ELSE NULL END AS verified_at,
         created_at, updated_at
       FROM user_instance_bindings
  9. INSERT INTO bindings (binding_type, scope_type, scope_ref, user_id, player_name, verify_code, verify_status, verified_at, created_at, updated_at)
       SELECT
         'player' AS binding_type,
         'game_type' AS scope_type,
         game_type AS scope_ref,
         user_id,
         player_name,
         CASE WHEN status='pending' THEN verify_code ELSE NULL END AS verify_code,
         CASE WHEN status='pending' THEN 'pending' WHEN status='verified' THEN 'verified' ELSE 'revoked' END AS verify_status,
         CASE WHEN status='verified' THEN verified_at ELSE NULL END AS verified_at,
         created_at, updated_at
       FROM player_bindings
  10. INSERT INTO bindings (binding_type, scope_type, scope_ref, user_id, player_name, verify_code, verify_expires_at, verify_status, verified_at, created_at, updated_at)
        SELECT
          'player' AS binding_type,
          'instance' AS scope_type,
          server_id AS scope_ref,
          user_id,
          player_name,
          CASE WHEN used_at IS NOT NULL THEN NULL ELSE code END AS verify_code,
          expires_at AS verify_expires_at,
          CASE 
            WHEN used_at IS NOT NULL THEN 'verified'
            WHEN expires_at > NOW() THEN 'pending'
            ELSE 'expired'
          END AS verify_status,
          used_at AS verified_at,
          created_at, created_at AS updated_at
        FROM player_verify_codes
  11. UPDATE users SET roles = JSON_ARRAY(role), active_role = role
  12. 校验：SELECT COUNT(*) 对账（见 §4.4）
  13. DROP TABLE user_instance_bindings
  14. DROP TABLE player_bindings
  15. DROP TABLE player_verify_codes
  16. （过渡期保留 users.role，不在此脚本删除）
事务提交
```

**Rollback 脚本（`migrations/YYYYMMDDHHMMSS_unify_bindings_and_roles.rollback.ts`）**：

```
事务开始
  1. 重建旧表结构（CREATE TABLE user_instance_bindings / player_bindings / player_verify_codes）
  2. 从 bindings 反向搬运数据回旧表：
     - WHERE binding_type='account' → user_instance_bindings
     - WHERE binding_type='player' AND scope_type='game_type' → player_bindings
     - WHERE binding_type='player' AND scope_type='instance' AND verify_status IN ('pending','expired') → player_verify_codes
  3. UPDATE users SET role = active_role（从 active_role 反推）
  4. ALTER TABLE users DROP COLUMN roles
  5. ALTER TABLE users DROP COLUMN active_role
  6. DROP TABLE bindings
  7. DROP TABLE permission_points
  8. DROP TABLE role_permission_templates
事务提交
```

> ⚠️ v1.1 修正（GN-004 审查 C2）：补充 rollback 脚本的字段反向映射规则。
>
> **rollback 字段反向映射规则**：
> - `bindings.verify_status='verified'`（来自 `player_verify_codes`，binding_type='player' AND scope_type='instance'）→ 旧表 `used_at = verified_at`，`code` 字段无法从 bindings 恢复（因 bindings 中 verified 态 verify_code=NULL），rollback 时从 L2 表级备份恢复 code 字段
> - `bindings.verify_status='pending'`（来自 `player_verify_codes`）→ 旧表 `used_at=NULL`, `code=verify_code`, `expires_at=verify_expires_at`
> - `bindings.verify_status='expired'`（来自 `player_verify_codes`）→ 旧表 `used_at=NULL`, `code=verify_code`（若 bindings 中 expired 态保留了 verify_code 则恢复，否则从 L2 备份恢复），`expires_at=verify_expires_at`
> - `bindings.verify_status='revoked'`（来自 `player_bindings.status='rejected'`）→ 旧表 `status='rejected'`
> - `bindings.verify_status='verified'`（来自 `player_bindings.status='verified'`）→ 旧表 `status='verified'`, `verified_at=bindings.verified_at`
> - `bindings.verify_status='pending'`（来自 `player_bindings.status='pending'`）→ 旧表 `status='pending'`, `verify_code=bindings.verify_code`
> - `bindings.verify_status='revoked'`（来自 `user_instance_bindings.status='unbound'`）→ 旧表 `status='unbound'`
> - `bindings.verify_status='verified'`（来自 `user_instance_bindings.status='active'`）→ 旧表 `status='active'`
>
> **无法回滚的情况**：若 bindings 中存在旧表无对应概念的记录（如 binding_type='account' 且 verify_status='pending'，旧表 user_instance_bindings 无 pending 概念），rollback 时跳过并记录警告日志。
>
> **已 expired 的 verify_codes** 在原系统本就无用，rollback 时按 expired 态恢复（数据不丢失，仅状态标记不同）。**已 revoked 的绑定** 按上表反向恢复到对应旧表的 revoked/rejected/unbound 态。

### 4.2 一次性迁移的具体步骤

| 步骤 | 操作 | 责任方 | 验证 |
|------|------|--------|------|
| T-24h | 通知用户停机窗口（建议凌晨低峰期，窗口 30-60 分钟） | 运维 | 通知已发送 |
| T-1h | 全量数据库备份（SQL dump + SQLite 文件拷贝） | 运维 | 备份文件校验完整性 |
| T-0 | 停止 Panel 后端服务（systemctl stop gameserver-panel） | 运维 | systemctl status 确认 inactive |
| T+1min | 部署迁移脚本与新版代码（git checkout + npm install + npm run build） | 运维 | 构建无报错 |
| T+5min | 执行 forward 迁移脚本（knex migrate:latest） | 运维 | 脚本退出码 0 |
| T+10min | 执行一致性校验（见 §4.4） | 运维 + 开发 | 所有校验项 PASS |
| T+15min | 启动新版 Panel 后端（systemctl start gameserver-panel） | 运维 | systemctl status active + health check 200 |
| T+20min | 烟雾测试（核心路径：登录、绑定查看、实例创建） | QA | 测试用例全 PASS |
| T+30min | 开放用户访问 | 运维 | 监控告警无异常 |

### 4.3 数据备份与回滚预案

**备份层级**：
1. **L1 全量备份**：`sqlite3 panel.db .dump > backup_YYYYMMDD.sql` + `cp panel.db panel.db.bak`
2. **L2 表级备份**：迁移前单独导出三套旧表（`user_instance_bindings`、`player_bindings`、`player_verify_codes`）和 `users` 表
3. **L3 代码快照**：`git tag pre-migration-XXX`，便于代码层回滚

**回滚触发条件**（满足任一即触发）：
- 一致性校验失败（行数对账不一致、关键字段抽样核对错误率 > 0.1%）
- 烟雾测试核心路径失败（登录、绑定查看、实例创建任一不通）
- 启动后 30 分钟内出现 P0 级故障

**回滚流程**：
1. 停止新版 Panel 服务
2. 代码回滚：`git checkout pre-migration-XXX` + `npm run build`
3. 数据回滚：执行 rollback 脚本（首选）；若 rollback 失败，回退到 L1 全量备份恢复
4. 启动旧版 Panel 服务
5. 在 `current-note.md` 记录回滚原因，触发 L3 信号请示人类裁决后续

### 4.4 数据一致性校验

**行数对账**：
```
-- 旧表行数（迁移前记录）
COUNT(user_instance_bindings) = N1
COUNT(player_bindings) = N2
COUNT(player_verify_codes WHERE expires_at > NOW()) = N3_pending
COUNT(player_verify_codes WHERE expires_at <= NOW()) = N3_expired

-- 新表对应行数（迁移后校验）
COUNT(bindings WHERE binding_type='account') = N1
COUNT(bindings WHERE binding_type='player' AND scope_type='game_type') = N2
COUNT(bindings WHERE binding_type='player' AND scope_type='instance' AND verify_status='pending') = N3_pending
COUNT(bindings WHERE binding_type='player' AND scope_type='instance' AND verify_status='expired') = N3_expired

-- 用户角色对账
COUNT(users WHERE role IS NOT NULL) = COUNT(users WHERE roles IS NOT NULL)
COUNT(users WHERE roles IS NOT NULL) = COUNT(users WHERE active_role IS NOT NULL)
```

**关键字段抽样核对**：
- 随机抽取 100 条 `user_instance_bindings`，验证对应 `bindings` 行字段完全一致
- 随机抽取 100 条 `player_bindings`，同上
- 随机抽取 50 条 pending + 50 条 expired `player_verify_codes`，同上
- 随机抽取 100 个用户，验证 `roles` 数组包含原 `role` 且 `active_role = role`

**业务逻辑回归**：
- 模拟用户登录 → 查询绑定列表 → 验证返回数据与旧表一致
- 模拟实例详情页 → 验证 VIP 等级、钱包关联正确

**v1.1 修正 GN-004 C5：Demo 模式隔离机制**

> Demo 模式由 `VITE_ENABLE_DEMO` 环境变量控制（见 project_memory），迁移脚本必须识别 demo 模式并跳过，避免破坏 demo 数据。

**Demo 模式识别机制**：
- 后端启动时读取 `process.env.GSP_DEMO_MODE`（与前端 `VITE_ENABLE_DEMO` 对齐，后端使用独立环境变量避免 Vite 前缀混淆）
- 若 `GSP_DEMO_MODE=true`，后端在 `app.locals.isDemoMode = true`，供迁移脚本与服务逻辑判断

**Demo 数据库物理隔离**：
- 生产数据库：`/opt/gameserver-panel/panel/backend/data/panel.db`
- Demo 数据库：`/opt/gameserver-panel/panel/backend/data/panel-demo.db`（独立文件，与生产物理隔离）
- 后端启动时根据 `GSP_DEMO_MODE` 选择加载哪个数据库文件（knex 配置文件路径分支）

**迁移脚本跳过实现**（v1.1 修正 GN-004 C5 复审：明确 Demo 数据库策略）：

> **策略选定**：Demo 数据库**执行 forward（schema 变更）但跳过数据搬运**（demo 数据由 demo-reset 端点重建），保持与生产 schema 一致。这避免了"Demo 数据库与生产 schema 漂移"的长期技术债。

```typescript
// migrations/YYYYMMDDHHMMSS_unify_bindings_and_roles.ts
export async function up(knex: Knex): Promise<void> {
  const isDemoMode = process.env.GSP_DEMO_MODE === 'true';
  
  if (isDemoMode) {
    console.log('[migration] Demo 模式检测到：执行 schema 变更但跳过数据搬运');
    // Demo 模式：只执行 Step 1-7（建表 + 字段变更 + seed 权限点），跳过 Step 8-11（数据搬运 + users.roles 更新）
    // Demo 数据由 demo-reset 端点重建（含 bindings 表的 demo 数据）
    await knex.transaction(async (trx) => {
      // Step 1-7: CREATE TABLE bindings / permission_points / role_permission_templates + ALTER users + INSERT seed
      await createBindingsSchema(trx);      // Step 1, 1.1, 2, 3
      await alterUsersTable(trx);           // Step 4, 5
      await seedPermissionData(trx);        // Step 6, 7
      // 跳过 Step 8-11: 数据搬运（demo 数据由 demo-reset 重建）
      // 跳过 Step 13-15: DROP 旧表（demo 数据库的旧表由 demo-reset 端点统一清理重建）
      console.log('[migration] Demo 数据库 schema 变更完成，数据由 demo-reset 端点重建');
    });
    return;
  }
  
  // 生产模式：执行完整迁移（Forward 脚本 Step 1-16，含数据搬运与旧表删除）
  await knex.transaction(async (trx) => {
    // ... 见 §4.1 Forward 脚本
  });
}
```

**Demo 数据兼容性**：
- Demo 模式下，前端调用 `/api/bindings` 等 API 时，后端 service 层正常读 demo 数据库的 bindings 表（schema 与生产一致）
- Demo reset 端点（`POST /api/demo/reset`）重置 demo 数据时：
  1. `DROP TABLE` 旧表（user_instance_bindings / player_bindings / player_verify_codes，若存在）
  2. `TRUNCATE` bindings / permission_points / role_permission_templates / users 表
  3. 重新 seed demo 数据（5 个游戏实例 + 绑定 + 商店物品 + CDK + 聊天触发器 + 投票 + Mod 等，见 project_memory demo 模式要求）
- Demo 数据库与生产数据库 schema 完全一致，仅数据不同（物理隔离 + 数据隔离）

**迁移演练的 Demo 环境数据来源**：
- §10 步骤 3 提到的"在 demo 环境完整跑一次 forward + rollback + forward"，使用生产数据快照脱敏
- 脱敏规则：用户密码重置为 demo 密码、敏感字段（邮箱、IP）替换为占位符、用户名加 `demo_` 前缀
- 脱敏后的数据导入 demo 数据库，作为迁移演练的真实数据源

---

## 5. 工作台切换器设计

### 5.1 登录时选角色的实现

**后端 API 改造**：

`POST /api/auth/login`（改造）：
- 请求：`{ username, password }`
- 响应（用户 `roles` 长度 = 1）：`{ token, user: { ...roles, active_role } }`（直接签发 token，跳过选角色）
- 响应（用户 `roles` 长度 > 1）：`{ require_role_selection: true, available_roles: [...], login_token: <临时 token> }`（不签发正式 token，返回临时 login_token）

`POST /api/auth/select-role`（新增）：
- 请求：`{ login_token, selected_role }`
- 校验：`selected_role ∈ users.roles`
- 响应：`{ token, user: { ...roles, active_role: selected_role } }`
- 副作用：`UPDATE users SET active_role = selected_role WHERE id = ?`

**前端登录流程**：

```
[登录页] 输入用户名密码
  ↓
[POST /api/auth/login]
  ↓
┌─ 单角色账号 ──→ [直接跳转 /guild] token 已签发
│
└─ 多角色账号 ──→ [跳转 /login/select-role]
                      ↓
                  [展示角色卡片列表]
                  - 每个角色一张卡片（图标 + 角色名 + 简短描述）
                  - 苹果清新风格：圆角、淡色块、SF Pro 字体
                  - 默认选中 active_role（上次登录角色）
                      ↓
                  [用户选定角色]
                      ↓
                  [POST /api/auth/select-role]
                      ↓
                  [跳转对应基座]
                  - user → /guild
                  - instance_admin → /guild（实例管理视角，可创建实例）
                  - server_admin → /admin
```

### 5.2 会话期间角色固定机制

**JWT Token 设计**：
```json
{
  "sub": "user_id",
  "active_role": "instance_admin",
  "roles": ["user", "instance_admin"],
  "exp": 1234567890,
  "iat": 1234500000
}
```

**Auth 中间件**：
- 解析 token → 注入 `req.user.activeRole`、`req.user.roles`
- 不查询数据库（性能优化，token 是权威源）
- 权限校验：`requirePermission(code)` 中间件查 `role_permission_templates` 表（带缓存）

**会话固定保证**：
- Token 不可变（JWT 特性）
- 不提供 `/api/auth/switch-role` 接口
- 前端"切换角色"按钮 = logout + 重新登录
- 防御性检查：若 `req.user.activeRole ∉ req.user.roles`（数据异常），立即拒绝请求并强制归出

**v1.1 修正 GN-004 警示观察：JWT 降权黑名单机制**

> §5.2 明确"token 是权威源，不查询数据库"，这与 §3.4"持久化 active_role 用于下次登录默认选中"组合后，若管理员在用户会话期间降权（修改 users.roles 移除某角色），用户 token 中 active_role 仍是旧值，直到 token 过期前持续越权。需补充黑名单机制。

**Token 黑名单机制**：
- **触发点**：管理员通过 `PUT /api/admin/users/:id/roles` 修改用户 roles 时
- **黑名单写入**：将该用户所有未过期 token 的 `jti`（JWT ID，签发时生成）加入进程内 LRU 黑名单缓存
- **缓存 key**：`jwt_blacklist:{jti}`，value：`1`，TTL：token 剩余有效期（自动过期，避免无限增长）
- **Auth 中间件校验**：解析 token 后，查 `jwt_blacklist:{jti}`，若存在返回 401 + `{"error":{"code":"JWT_REVOKED","message":"token 已被撤销，请重新登录"}}`
- **容量上限**：LRU 容量上限 10000 条（按用户量估算，单用户最多 1-2 个有效 token）

**关键操作回查 DB**（双保险）：
- 高危操作（`instance.delete`、`user.role.assign`、`wallet.credit`、`role_permission.update`）在权限校验通过后，额外回查 DB：
  ```sql
  SELECT active_role, roles FROM users WHERE id = ?
  ```
  校验 `active_role ∈ roles` 且 `active_role === token.active_role`，不一致则 401 强制重新登录
- 这是对黑名单机制的兜底（黑名单缓存可能丢失或未及时写入）

**Token 短有效期**：
- access token TTL 缩短至 1 小时（原方案未明确 TTL）
- refresh token TTL 7 天（用于无感续期）
- 即使黑名单机制失效，越权窗口最长 1 小时

### 5.3 切换需重新登录的设计

**前端"切换角色"入口**：
- 位置：用户头像下拉菜单
- 行为：调用 `POST /api/auth/logout` → 清除本地 token → 跳转 `/login`（保留用户名预填）
- UX 细节：弹出确认框"切换角色需要重新登录，是否继续？"

**为什么不提供热切换**（激进取舍理由）：
1. **审计清晰**：每个会话的角色固定，日志中 `active_role` 字段可信
2. **权限缓存简单**：前端不需要响应式响应角色切换，后端不需要失效权限缓存
3. **安全边界明确**：token 即权限边界，无需考虑切换中的中间态
4. **代价可接受**：多角色账号是少数（管理员群体），重新登录成本 < 5 秒

### 5.4 前端路由守卫的调整

**路由守卫改造**：
- 旧：`<RequireRole role="instance_admin">`
- 新：`<RequirePermission code="instance.create">`

**三基座路由守卫**：
- `/guild` —— 要求 `permission: instance.view`（所有角色都有）
- `/store` —— 要求 `permission: wallet.view`（user + instance_admin + server_admin）
- `/admin` —— 要求 `permission: system.config`（仅 server_admin）

**路由表结构**（遵守 rules-0 §3.1.1 React Router v6 守卫）：
```tsx
<Routes>
  <Route path="/login" element={<LoginPage />} />
  <Route path="/login/select-role" element={<RoleSelectionPage />} />
  <Route element={<AuthGuardLayout />}>  {/* Suspense + Outlet */}
    <Route path="/guild" element={<RequirePermission code="instance.view"><GuildDock /></RequirePermission>} />
    <Route path="/store" element={<RequirePermission code="wallet.view"><StoreDock /></RequirePermission>} />
    <Route path="/admin" element={<RequirePermission code="system.config"><AdminDock /></RequirePermission>} />
  </Route>
</Routes>
```

---

## 6. !verify 命令处置

### 6.1 废弃游戏内 !verify 命令的影响评估

**受影响方**：

| 受影响方 | 影响描述 | 应对 |
|---------|---------|------|
| 玩家 | 习惯在游戏内输入 `!verify <code>` 完成绑定，废弃后需适应新流程 | 新流程更简单（在游戏内聊天框输入验证码即可，无需命令前缀），UX 升级 |
| 游戏侧 Daemon | 现有实现监听 `!verify` 命令，需改造为监听聊天事件匹配验证码 | Daemon 适配（事件订阅模型，见 §6.3） |
| Panel 后端 | 现有 `player_verify_codes` 表消费逻辑（!verify 命令回调）需废弃 | 迁移到 webhook 回调，旧逻辑删除 |
| 文档/教程 | 现有"输入 !verify 完成绑定"的用户引导需更新 | 文档同步更新 |

**风险等级**：中。主要风险在游戏侧 Daemon 改造工作量，但事件订阅模型比命令解析更通用，长期收益明显。

**v1.1 修正 GN-004 F3：双轨运行实现细节澄清**

> ⚠️ 双轨运行 ≠ 保留旧表。Forward 脚本 Step 13-15 已物理删除旧表（user_instance_bindings / player_bindings / player_verify_codes），双轨运行期间所有数据读写都走新 `bindings` 表。

**双轨运行的真正含义**：
- **保留的是命令路径，不是数据表**：过渡期（1 个版本）保留游戏内 `!verify <code>` 命令的解析逻辑，但底层 service 改读 `bindings` 表
- **命令路径与事件订阅路径并存**：玩家既可输入 `!verify XXXXXX`（旧路径），也可直接输入 `XXXXXX`（新路径，事件订阅），两种路径最终都通过 webhook 调用 `POST /api/bindings/verify/webhook`

**实现方式**：
```
游戏侧 Daemon（过渡期）
  ├─ [旧路径] !verify 命令解析器
  │    └─ 提取 code → 调用 POST /api/bindings/verify/webhook（与新路径同一接口）
  │
  └─ [新路径] chat 事件订阅器
       └─ 正则匹配 ^\d{6}$ → 调用 POST /api/bindings/verify/webhook
```

**Panel 侧无感知**：
- Panel 不区分请求来自命令解析器还是事件订阅器（都走 webhook 接口，HMAC 签名校验）
- Panel 只看到一个 webhook 请求，按 §6.4 流程处理

**下版本删除**：
- 过渡期结束后，删除游戏侧 Daemon 的 `!verify` 命令解析器
- 文档/教程更新为"在游戏内聊天框输入验证码"
- 此时只剩事件订阅路径，架构干净

**为何不保留旧表双写**：
- 旧表已物理删除（Forward Step 13-15），无法双写
- 保留旧表会导致"两个真相源"长期存在（违背方案C核心理念，见 §0.3）
- 双轨运行仅指命令路径，不涉及数据层

### 6.2 新流程：申请验证码 → 游戏内输入 → 后端 webhook 自动确认

**流程图**：

```
[用户前端 /guild/bind/player]
  ↓ 用户填写 player_name + 选择 game_type / instance
[POST /api/bindings (binding_type='player', verify_status='pending')]
  ↓ 后端生成 6 位验证码，写入 bindings.verify_code + verify_expires_at=NOW()+5min
[返回验证码给前端展示]
  ↓ 前端展示"请在游戏内聊天框输入：XXXXXX"
[用户在游戏内聊天框输入验证码（无需 ! 前缀）]
  ↓ 游戏侧 Daemon 监听 chat 事件，正则匹配 6 位验证码格式
[Daemon 通过 webhook 上报 Panel]
  POST /api/bindings/verify/webhook
  Body: { player_name, code, server_id, game_type, event_id }
  ↓
[Panel 校验]
  - 查 bindings WHERE verify_code=code AND verify_status='pending'
  - 校验 player_name 匹配、scope_ref 匹配、未过期
  - 更新 bindings: verify_status='verified', verified_at=NOW(), verify_code=NULL
  ↓
[Panel 返回成功给 Daemon]
  ↓ Daemon 在游戏内回复玩家"绑定成功"（游戏内反馈）
  ↓ Panel 通过 WebSocket 推送给前端（实时刷新绑定状态）
[前端展示绑定成功]
```

**关键设计点**：
- 验证码格式：6 位数字（避免游戏内特殊字符转义问题）
- 验证码不区分大小写（数字无大小写问题）
- 一次一码：申请后 5 分钟内有效，验证成功后立即失效
- 并发保护：同一用户同一 scope 只能有一个 pending 验证码（申请新码前撤销旧码）

### 6.3 游戏侧集成改为事件订阅模型

**旧模型（命令解析）**：
- 游戏侧 Daemon 注册 `!verify` 命令处理器
- 玩家输入 `!verify XXXXXX`
- Daemon 解析命令 → 调用 Panel API

**新模型（事件订阅）**：

```
游戏事件总线（game-event-bus）
  ├─ chat 事件（玩家聊天消息）
  ├─ login 事件（玩家登录）
  ├─ logout 事件（玩家登出）
  └─ ...

Daemon 订阅 chat 事件
  ├─ 过滤：正则匹配 ^\d{6}$（纯 6 位数字）
  ├─ 提取：player_name, code, server_id, game_type
  └─ 上报：POST /api/bindings/verify/webhook
```

**事件订阅模型优势**：
1. **解耦**：游戏侧只需发布事件，不感知业务逻辑（验证码、绑定等都是订阅者）
2. **可扩展**：未来新增"游戏内消费钱包"、"游戏内 VIP 提示"等场景，只需新增订阅者，无需改造游戏侧
3. **统一**：不同游戏（Minecraft / 饥荒 / 泰拉瑞亚等）只需实现统一的 chat 事件发布者，业务逻辑在 Daemon/Panel 侧
4. **可观测**：事件总线天然适合日志、监控、回放

**游戏适配清单**：
- 每个游戏 Pack 需实现 `ChatEventPublisher` 接口（发布 chat 事件到事件总线）
- Daemon 提供 `EventBus.subscribe('chat', handler)` API
- 现有游戏 Pack 需评估改造工作量（建议在 s0702 game-pack-adaptation-review 中纳入检查项）

### 6.4 验证码生命周期管理

**状态机**：

```
[申请] → pending（verify_code 有值, verify_expires_at = NOW()+5min）
  ├─ [webhook 验证成功] → verified（verify_code=NULL, verified_at=NOW()）
  ├─ [过期] → expired（verify_code=NULL, verify_expires_at 保留）
  ├─ [用户撤销] → revoked（verify_code=NULL）
  └─ [管理员撤销] → revoked（verify_code=NULL）
```

**过期处理**：
- 定时任务（每分钟扫描）：`UPDATE bindings SET verify_status='expired', verify_code=NULL WHERE verify_status='pending' AND verify_expires_at < NOW()`
- 过期后用户可重新申请（旧 pending 行状态变 expired，新申请 UPDATE 同一行，避免历史堆积）

**重复申请保护**：
- 同一 user_id + scope_type + scope_ref + player_name 已有 pending 行时，新申请直接 UPDATE 该行的 verify_code 和 verify_expires_at（覆盖旧码）

**安全考虑**（v1.1 修正 GN-004 F2：补充 webhook 防重放机制）：

- **验证码错误次数限制**：webhook 回调若 5 分钟内同一 player_name 验证失败 5 次，锁定该 player_name 30 分钟（防爆破，参数可配置见 §2.6 `binding.config.json`）
- **验证证码不可预测**：使用 `crypto.randomInt` 生成，避免 `Math.random`

**Webhook 签名与防重放机制**：

> Daemon 上报 Panel 的 webhook 请求必须携带 HMAC 签名 + timestamp + nonce 三要素，Panel 校验三要素通过后才处理业务逻辑。

**签名算法**：
```
signature = HMAC-SHA256(
  key = $GSP_WEBHOOK_SECRET,
  message = timestamp + "\n" + nonce + "\n" + raw_body
)
```

**请求头**（参数可配置见 §2.6 `webhook.config.json`）：
- `X-GSP-Signature`：hex 编码的签名值
- `X-GSP-Timestamp`：Unix 时间戳（秒）
- `X-GSP-Nonce`：UUID v4 随机串（每次请求唯一）

**Panel 校验流程**：
1. **时间窗口校验**：`|server_now - timestamp| <= timestamp_tolerance_seconds`（默认 300s=5min），超出返回 401
2. **Nonce 去重**：查 LRU 缓存（key=`webhook_nonce:{nonce}`），若已存在返回 401（防重放）；不存在则写入缓存（TTL = `nonce_cache_ttl_seconds`，默认 600s=10min，覆盖时间窗口的 2 倍）
3. **签名校验**：用相同算法重算签名，与 `X-GSP-Signature` 比对（恒定时间比较 `crypto.timingSafeEqual` 防时序攻击），不匹配返回 401
4. **业务处理**：三要素校验通过后才解析 body 并处理 binding 验证

**签名失败响应**：
- HTTP 401 + `{"error":{"code":"WEBHOOK_SIGNATURE_INVALID","message":"..."}}`
- 记录 WARNING 级别日志（含 timestamp/nonce/player_name，便于排查）
- 同一 IP 5 分钟内签名失败 10 次，触发告警（不封锁，避免误伤）

**密钥管理**：
- 密钥从环境变量 `GSP_WEBHOOK_SECRET` 读取（不入库不入配置文件）
- 密钥长度建议 ≥ 32 字节
- 密钥轮换：先在 Panel 配置新密钥（环境变量），再更新 Daemon 配置，过渡期支持新旧密钥双校验（1 小时窗口）

---

## 7. 前端信息架构重做

### 7.1 `/guild` 首页新信息架构

**现状问题**：
- 空状态有"立即绑定"按钮 + QUICK_ACTIONS 有"绑定角色"按钮，两处都跳 `/guild/bind`，行为重复
- 已绑定状态信息层级混乱（账户级 VIP 与游戏角色级绑定混在一起）

**新信息架构**（苹果清新设计语言，移动端优先）：

```
/guild（首页）
├─ 顶部：用户问候 + 当前 active_role 标识（可点击查看角色详情）
├─ 主体（按 binding_type 分区，纵向卡片栈）
│  ├─ [账户级绑定区]（binding_type='account'）
│  │  ├─ 空状态：单一"开始绑定实例"卡片（不再有 QUICK_ACTIONS 重复入口）
│  │  │  └─ 点击 → /guild/bind/account
│  │  └─ 已绑定：实例卡片列表
│  │     ├─ 每张卡片：实例名 + VIP 等级徽章 + 钱包余额
│  │     └─ 点击 → /instances/:id（实例详情）
│  │
│  └─ [游戏角色级绑定区]（binding_type='player'）
│     ├─ 空状态：单一"绑定游戏角色"卡片
│     │  └─ 点击 → /guild/bind/player
│     └─ 已绑定：角色卡片列表
│        ├─ 每张卡片：玩家名 + game_type 图标 + 验证状态徽章
│        └─ pending 态：展示验证码 + 倒计时 + "在游戏内输入"提示
│
└─ 底部：QUICK_ACTIONS（精简，仅保留非绑定的快捷操作）
   ├─ 创建实例（需 instance.create 权限）
   ├─ 查看钱包
   └─ 切换角色（多角色账号可见）
```

**关键改动**：
1. **删除 QUICK_ACTIONS 中的"绑定角色"入口**（与空状态入口重复）
2. **空状态入口统一为单一卡片**（账户级、游戏角色级各一个，不再有"立即绑定"按钮 + QUICK_ACTIONS 双入口）
3. **pending 验证码状态在卡片内直接展示**（不再需要跳转 Profile 页面查看验证码）
4. **分区清晰**：账户级（VIP/钱包）与游戏角色级（玩家名/验证）视觉分离

### 7.2 Profile 页面的"游戏内绑定验证码"入口处置

**现状**：Profile 页面有"游戏内绑定验证码"入口，用于查看/申请验证码。

**新方案**：**移除 Profile 页面的验证码入口**。

**理由**：
- 验证码是绑定流程的中间态，不应是独立入口
- 新流程中，验证码在 `/guild` 首页的 pending 卡片内直接展示（实时刷新）
- 申请验证码的动作在 `/guild/bind/player` 流程内完成
- Profile 页面应聚焦"账号信息 + 安全设置"（头像、密码、二次验证、会话管理）

**Profile 页面新结构**：
```
/profile
├─ 账号信息（头像、用户名、邮箱）
├─ 安全设置（修改密码、二次验证、登录设备管理）
├─ 角色与权限（展示当前 active_role + 所有 roles + 权限点清单）
└─ 会话管理（当前 token 有效期、强制登出所有设备）
```

### 7.3 AccountBindingCard 与 GuildBind 的关系

**现状**：
- `AccountBindingCard`：实例详情页内的"绑定到该实例"卡片
- `GuildBind`：`/guild/bind` 整页绑定流程

**新方案**：

| 组件 | 职责 | 位置 | 关系 |
|------|------|------|------|
| `AccountBindingCard` | 实例详情页内的轻量绑定入口（一键跳转） | `/instances/:id` | GuildBind 的入口之一 |
| `GuildBind` | 统一绑定向导（多步骤） | `/guild/bind` | 绑定流程的统一承载 |
| `BindingCard`（首页卡片） | 展示已绑定项 + pending 状态 | `/guild` 首页 | 状态展示，非入口 |

**AccountBindingCard 行为**：
- 点击"绑定到该实例" → 跳转 `/guild/bind/account?instanceId=:id`（预填 instanceId）
- GuildBind 向导第一步自动选中该实例，用户只需确认

**GuildBind 向导步骤**：
```
/guild/bind（向导入口，根据 query 参数路由到对应步骤）
├─ /guild/bind/account（账户级绑定向导）
│  ├─ Step 1: 选择实例（或从 query 预填）
│  ├─ Step 2: 确认 VIP 等级（展示，不可编辑）
│  └─ Step 3: 完成
│
└─ /guild/bind/player（游戏角色级绑定向导）
   ├─ Step 1: 选择 game_type + 填写 player_name
   ├─ Step 2: 选择 scope（game_type 全局 / specific instance）
   ├─ Step 3: 展示验证码 + "在游戏内输入"提示
   └─ Step 4: 等待 webhook 确认（WebSocket 实时推送）→ 完成
```

### 7.4 路由调整

| 旧路由 | 新路由 | 说明 |
|--------|--------|------|
| `/guild/bind`（单一页面） | `/guild/bind`（向导入口，根据 query 路由） | 改造为向导式 |
| — | `/guild/bind/account` | 新增：账户级绑定向导 |
| — | `/guild/bind/player` | 新增：游戏角色级绑定向导 |
| `/profile/verify` | **删除** | 验证码入口移除，统一到 /guild 首页 pending 卡片 |
| `/login` | `/login`（改造） | 单角色账号直接登录，多角色账号跳转选角色 |
| — | `/login/select-role` | 新增：角色选择页 |

**移动端优化**（遵守 rules-0 §3.1.6 视口守卫）：
- 所有页面使用 `min-height: 100vh + overflow-y: auto`，禁止 `height: 100vh` 强制
- 向导步骤使用底部固定按钮栏（safe-area-inset-bottom 适配）
- 卡片列表纵向滚动，侧边栏在移动端折叠为底部 Tab

---

## 8. 后端 API 设计

### 8.1 新增 API

| 方法 | 路径 | 说明 | 鉴权 |
|------|------|------|------|
| POST | `/api/bindings` | 创建绑定（含申请验证码） | `binding.create` |
| GET | `/api/bindings` | 查询当前用户绑定列表（支持 filter: binding_type, scope_type, verify_status） | `binding.create`（查自己） |
| GET | `/api/bindings/:id` | 查询单个绑定详情 | `binding.create`（查自己） |
| DELETE | `/api/bindings/:id` | 解除绑定 | `binding.revoke` |
| POST | `/api/bindings/:id/revoke` | 撤销 pending 验证码 | `binding.revoke`（自绑自解） |
| POST | `/api/bindings/verify/webhook` | 游戏事件 webhook 回调（Daemon → Panel） | HMAC 签名校验（非用户鉴权） |
| GET | `/api/me/roles` | 查询当前用户角色集合 + 权限点清单 | 已登录 |
| POST | `/api/auth/select-role` | 登录后选角色（多角色账号） | login_token（临时 token） |

### 8.2 修改 API

| 方法 | 路径 | 修改内容 |
|------|------|---------|
| POST | `/api/auth/login` | 响应分叉：单角色直接签发 token，多角色返回 `require_role_selection` |
| POST | `/api/auth/logout` | 无逻辑变更，但前端"切换角色"按钮复用此接口 |
| GET | `/api/me` | 响应新增 `roles`、`active_role`、`permissions` 字段；保留 `role` 字段（= active_role，过渡期兼容） |
| POST | `/api/instances` | 鉴权从 `requireRole('instance_admin')` 改为 `requirePermission('instance.create')` |
| DELETE | `/api/instances/:id` | 鉴权改为 `requirePermission('instance.delete')` |
| GET | `/api/wallets/:id` | 鉴权改为 `requirePermission('wallet.view')` + 资源所有权校验 |
| POST | `/api/wallets/:id/debit` | 鉴权改为 `requirePermission('wallet.debit')` |

**v1.1 修正 GN-004 E4：完整鉴权改造清单（按资源类别）**

> 现有代码库 grep 出 38 文件 147 处 `requireRole`/`requireAdmin` 调用，需全量改造为 `requirePermission(code)` + 所有权校验。以下按资源类别列出改造清单（具体 API 路径与文件位置在步骤 4 实施时由 grep 工具自动列出）：

| 资源类别 | 涉及文件数 | 改造为权限点 | 所有权校验 |
|---------|----------|------------|-----------|
| instance（实例） | ~8 | `instance.create` / `instance.delete` / `instance.view` / `instance.update` / `instance.start` / `instance.console` | user 仅查看自己绑定的 |
| binding（绑定） | ~3 | `binding.create` / `binding.verify` / `binding.revoke` / `binding.view` | user 仅操作自己的 |
| wallet（钱包） | ~4 | `wallet.view` / `wallet.debit` / `wallet.credit` / `wallet.claim_daily` | user 仅操作自己的 |
| vip（VIP） | ~2 | `vip.set` / `vip.view` | user 仅查看自己 |
| user（用户管理） | ~3 | `user.role.assign` / `user.list` / `user.create` / `user.delete` / `user.view` | user 仅查看自己 |
| node（节点） | ~2 | `node.register` / `node.delete` / `node.view` / `node.update` | — |
| asset（资源） | ~2 | `asset.upload` / `asset.delete` / `asset.view` | — |
| pack（游戏包） | ~2 | `pack.install` / `pack.delete` / `pack.view` | — |
| cdk（CDK） | ~2 | `cdk.create` / `cdk.delete` / `cdk.view` / `cdk.redeem` | cdk.redeem 写入当前 userId |
| store（商城） | ~3 | `store.item.create` / `store.item.delete` / `store.item.view` / `store.purchase` | store.purchase 写入当前 userId |
| shop（GM 商店） | ~2 | `shop.config` / `shop.view` | — |
| backup（备份） | ~2 | `backup.create` / `backup.restore` / `backup.delete` / `backup.view` | — |
| save（存档） | ~2 | `save.upload` / `save.download` / `save.delete` | — |
| mod（Mod） | ~2 | `mod.install` / `mod.uninstall` / `mod.view` | — |
| file（文件） | ~2 | `file.upload` / `file.download` / `file.delete` / `file.view` | — |
| cleanup（清理） | ~1 | `cleanup.execute` / `cleanup.view` | — |
| batch（批量） | ~1 | `batch.execute` / `batch.view` | — |
| operation（运维） | ~1 | `operation.execute` / `operation.view` | — |
| chat（聊天） | ~2 | `chat.trigger.create` / `chat.trigger.delete` / `chat.trigger.view` / `chat.send` | — |
| vote（投票） | ~2 | `vote.create` / `vote.delete` / `vote.view` / `vote.cast` | vote.cast 写入当前 userId |
| periodic_message（定时消息） | ~1 | `periodic_message.create` / `periodic_message.delete` / `periodic_message.view` | — |
| player（玩家） | ~2 | `player.kick` / `player.ban` / `player.unban` / `player.view` | — |
| lists（名单） | ~1 | `lists.update` / `lists.view` | — |
| monitor（监控） | ~1 | `monitor.view` / `monitor.alert.ack` | — |
| maintenance（维护） | ~1 | `maintenance.enable` / `maintenance.disable` / `maintenance.view` | — |
| apikey（API Key） | ~1 | `apikey.create` / `apikey.delete` / `apikey.view` | — |
| ssl（SSL） | ~1 | `ssl.upload` / `ssl.delete` / `ssl.view` | — |
| tunnel（隧道） | ~1 | `tunnel.create` / `tunnel.delete` / `tunnel.view` | — |
| webhook（系统 Webhook） | ~1 | `webhook.create` / `webhook.delete` / `webhook.view` | — |
| audit（审计） | ~1 | `audit.view` / `audit.export` | — |
| settings（设置） | ~1 | `settings.update` / `settings.view` | — |
| quota（配额） | ~1 | `quota.set` / `quota.view` | — |
| system（系统） | ~2 | `system.config` / `system.view` / `system.health` / `system.deploy` | — |
| discover（发现） | ~1 | `discover.view` | — |
| platform_stats（平台统计） | ~1 | `platform_stats.view` | — |

**前端路由守卫改造清单**：

> 现有前端 `<RequireRole role="...">` 路由守卫需全量改造为 `<RequirePermission code="...">`。改造范围（按基座）：

| 基座 | 路由 | 旧守卫 | 新守卫 |
|------|------|--------|--------|
| /guild（玩家门户） | 所有 /guild/* 路由 | RequireRole('user') 或无守卫 | RequirePermission('instance.view')（所有角色都有此权限） |
| /store（GM 工作台） | 所有 /store/* 路由 | RequireRole('admin') | RequirePermission('shop.view')（instance_admin + server_admin） |
| /admin（管理后台） | 所有 /admin/* 路由 | RequireRole('admin') | RequirePermission('system.config')（仅 server_admin） |

**前端 API 调用层改造**：
- 所有调用旧 API（`/api/player-bindings`、`/api/verify-codes`、`/api/user-instance-bindings`）的代码需迁移到新 API（`/api/bindings`）
- 所有读取 `user.role` 的前端代码需迁移到 `user.activeRole` 或 `user.permissions` 数组
- 所有 `<RequireRole>` 组件需替换为 `<RequirePermission>`

### 8.3 废弃 API

| 方法 | 路径 | 替代方案 |
|------|------|---------|
| POST | `/api/user-instance-bindings` | → `POST /api/bindings`（binding_type='account'） |
| GET | `/api/user-instance-bindings` | → `GET /api/bindings?binding_type=account` |
| DELETE | `/api/user-instance-bindings/:id` | → `DELETE /api/bindings/:id` |
| POST | `/api/player-bindings` | → `POST /api/bindings`（binding_type='player', scope_type='game_type'） |
| GET | `/api/player-bindings` | → `GET /api/bindings?binding_type=player&scope_type=game_type` |
| POST | `/api/verify-codes` | → `POST /api/bindings`（binding_type='player', scope_type='instance', 含 verify_code 生成） |
| POST | `/api/player-bindings/:id/verify` | → `POST /api/bindings/verify/webhook`（命令解析改 webhook） |
| GET | `/api/verify-codes/mine` | → `GET /api/bindings?binding_type=player&scope_type=instance&verify_status=pending` |

### 8.4 鉴权策略调整

**中间件改造**：

旧：
```typescript
router.post('/instances', requireRole('instance_admin'), handler)
```

新：
```typescript
router.post('/instances', requirePermission('instance.create'), handler)
```

**`requirePermission(code)` 中间件实现**：
1. 从 `req.user.activeRole` 取当前活动角色
2. 查 `role_permission_templates` 表（带缓存，TTL 5 分钟）获取该角色的权限点集合
3. 校验 `code ∈ 权限点集合`，否则 403

**资源所有权校验**（细粒度权限补充，v1.1 修正 GN-004 D4 完整清单）：

> `requirePermission(code)` 只校验角色权限点，不校验资源所有权。对于"用户只能操作自己资源"的场景，必须叠加 `requireOwnership(resourceGetter)` 中间件。以下为完整的所有权校验清单：

| 权限点 | 角色 | 所有权校验规则 | 备注 |
|--------|------|--------------|------|
| `binding.create` | user | 只能为 `req.user.userId` 自己创建绑定（不能为他人创建） | 后端从 token 取 userId，忽略 body 中的 user_id |
| `binding.view` | user | 只能查看 `user_id = req.user.userId` 的绑定 | instance_admin/server_admin 可查看全部 |
| `binding.revoke` | user | 只能撤销 `user_id = req.user.userId` 的绑定 | instance_admin 可撤销其实例的玩家绑定（需校验 scope_ref ∈ 其管理实例） |
| `binding.verify` | user | 只能验证 `user_id = req.user.userId` 的绑定 | webhook 回调除外（HMAC 签名校验） |
| `wallet.view` | user | 只能查看 `wallet.id = req.user.walletId` 的钱包 | instance_admin/server_admin 可查看任意 |
| `wallet.debit` | user | 只能扣款 `wallet.id = req.user.walletId` 的钱包 | 仅自助消费 |
| `wallet.claim_daily` | user | 只能领取 `wallet.id = req.user.walletId` 的每日福利 | 仅自助 |
| `vip.view` | user | 只能查看自己的 VIP 等级 | instance_admin/server_admin 可查看任意 |
| `instance.view` | user | 只能查看自己已绑定（binding_type='account', verify_status='verified'）的实例 | instance_admin/server_admin 可查看全部 |
| `user.view` | user | 只能查看 `user.id = req.user.userId` 的用户信息 | server_admin 可查看任意 |
| `cdk.redeem` | user | CDK 兑换写入当前用户 | 无需所有权校验，但写入时绑定当前 userId |
| `store.purchase` | user | 购买写入当前用户的钱包 | 无需所有权校验，但写入时绑定当前 userId |
| `vote.cast` | user | 投票写入当前用户 | 无需所有权校验，但写入时绑定当前 userId |

**`requireOwnership` 中间件实现要点**：
- 在 `requirePermission` 之后追加，签名：`requireOwnership(getter: (ctx) => Promise<boolean> | boolean)`
- getter 返回 false 时返回 403 + `PANEL_FORBIDDEN` 错误码
- getter 抛错时返回 500 + `PANEL_INTERNAL_ERROR`
- instance_admin 的所有权校验需查询 DB（如"该实例是否由该 instance_admin 管理"），可考虑缓存实例管理员关系

**示例**：
```typescript
// GET /api/wallets/:id
router.get('/wallets/:id',
  requirePermission('wallet.view'),
  requireOwnership(async (ctx) => {
    if (ctx.user.activeRole === 'server_admin' || ctx.user.activeRole === 'instance_admin') return true;
    return ctx.params.id === ctx.user.walletId;
  }),
  handler
);
```

**权限缓存策略**：
- `role_permission_templates` 表数据低频变更，适合强缓存
- 缓存实现：进程内 LRU 缓存（项目未部署 Redis），TTL 5 分钟，容量上限 100 条（3 个角色 × 权限点数组）
- 缓存 key：`role_perms:{role}`，value：权限点数组
- **缓存预热**（v1.1 修正 GN-004 B5）：服务启动时（`initServer` 阶段，在路由挂载前）一次性加载所有角色的权限点到缓存，避免冷启动期间鉴权延迟与缓存雪崩
- **缓存失效触发点**（v1.1 修正 GN-004 B5）：
  - 新增 API `PUT /api/admin/role-permissions/:role`（鉴权：`user.role.assign` 权限点，仅 server_admin 可调用）—— 管理员修改角色权限模板
  - 该 API 内部在 `UPDATE role_permission_templates` 提交后，主动 `cache.del(\`role_perms:${role}\`)`
  - 由于是单进程 LRU 缓存，无需跨进程广播失效（项目当前为单进程部署，若未来扩展为多进程需引入 Redis Pub/Sub 或类似机制）
- **兜底**：缓存未命中时回源查表（`SELECT permission_code FROM role_permission_templates WHERE role=?`），并回填缓存
- **降级**（fail-closed 原则）：若 role_permission_templates 表查询失败（如数据库不可用），降级为"拒绝所有非公开请求"，返回 503 Service Unavailable，避免越权

---

## 9. 风险与适用场景

### 9.1 主要风险点

| 风险 | 等级 | 影响 | 缓解措施 |
|------|------|------|---------|
| 一次性迁移停机窗口超预期 | 高 | 用户无法访问面板 | 严格预演（在 demo 环境完整跑一次）、备份兜底、回滚预案 |
| 多角色账号用户登录流程变化 | 中 | 用户不适应选角色步骤 | 默认选中 active_role（上次登录角色）、单角色账号无感（直接跳转） |
| 游戏侧 Daemon 改造工作量 | 中 | 部分游戏 Pack 验证流程不可用 | 提供 ChatEventPublisher 适配指南、过渡期保留 !verify 命令兼容（双轨 1 个版本） |
| 权限矩阵重构影响面广 | 中 | 部分页面鉴权失效 | 全量权限点清单 review、独立审查（GN-004）逐模块核对、s0402 三重闸门 |
| webhook 签名校验失败 | 低 | 游戏事件无法确认 | 签名算法文档、Daemon 侧单测、Panel 侧 webhook 接收测试 |
| 旧表物理删除后数据丢失 | 高 | 无法回滚到旧表结构 | L1 全量备份 + L2 表级备份 + rollback 脚本（重建旧表反向搬运） |
| 多角色账号会话固定导致 UX 不便 | 低 | 用户切换角色需重新登录 | 接受（多角色账号是少数场景），未来可考虑 refresh token + 角色切换 API |
| Demo 模式被破坏 | 中 | 现有 demo 不可用 | Demo 模式独立配置 + 迁移脚本对 demo 数据库跳过、独立验证 |
| 迁移过程中 Daemon webhook 失败（v1.1 补充 G1） | 中 | §4.2 T-0 停止 Panel 后端服务后，游戏侧 Daemon 仍在运行并上报 webhook，这些请求会失败，玩家在游戏内输入验证码后无响应 | 迁移窗口前通知所有 instance_admin 暂停游戏内绑定操作；Daemon 侧 webhook 失败时缓存请求并在 Panel 恢复后重试（指数退避，最多重试 5 次，总时长 ≤ 30 分钟）；迁移完成后检查 Daemon 重试队列并处理积压 |
| 权限缓存失效延迟导致越权（v1.1 补充 G1） | 中 | §8.4 缓存 TTL 5 分钟，管理员修改模板后最长 5 分钟内旧权限仍生效 | ① 管理员通过 `PUT /api/admin/role-permissions/:role` 修改模板时，API 内部同步主动 `cache.del` （已在 §8.4 设计）；② TTL 兜底仅作为"主动失效失败时的安全网"，不作为主要失效路径；③ 高危操作（如 `user.role.assign`、`instance.delete`）不依赖缓存，每次回查 DB 确认 |
| JWT active_role 与 DB 不一致导致越权（v1.1 补充 G1） | 高 | 用户重新登录前，DB 中 active_role/roles 被管理员修改（如降权），但 token 中仍是旧 active_role，导致权限越界。§5.2 明确"token 是权威源"放大了该风险 | ① **token 黑名单机制**：管理员修改用户 roles 时（`PUT /api/admin/users/:id/roles`），将该用户所有未过期 token 的 `jti` 加入黑名单（LRU 缓存，TTL = token 剩余有效期），下次请求被 auth 中间件拦截强制重新登录；② **关键操作回查 DB**：高危操作（`instance.delete`、`user.role.assign`、`wallet.credit` 等）在权限校验通过后，额外回查 DB 确认 `users.active_role ∈ users.roles` 且与 token 一致；③ **token 短有效期**：access token TTL 缩短至 1 小时（refresh token 7 天），降低越权窗口 |

### 9.2 适用场景

- 长期演进的项目（接受短期阵痛换长期可维护性）
- 用户角色确实需要多身份叠加（管理员同时是普通玩家）
- 游戏侧已具备或愿意改造事件订阅能力
- 团队能承受一次性迁移的协调成本
- 用户量在可控范围（停机 30-60 分钟可接受）
- 项目处于版本升级窗口期（可借机清理技术债）

### 9.3 不适用场景

- 紧急上线需求（无法承受迁移窗口）
- 游戏侧无法配合 webhook 改造（如使用闭源游戏服务端，无 chat 事件接口）
- 用户量极大、停机不可接受（应选择渐进式双写过渡方案）
- 团队人力紧张、无法承担一次性重构的协调成本
- 现有 !verify 命令已深度嵌入用户习惯且无法引导迁移

---

## 10. 执行步骤

> 按用户规则：仅输出执行步骤、开发事项与建议，不区分优先级、不计人力工期。

### 步骤 1：契约变更触发 s0601 流程

**开发事项**：
- 整理 `public/schema/` 与 `public/interface_stub/` 的完整变更清单（见 §2.6）
- 走 s0601 适配契约变更 Skill：识别影响面 → 拆解下游适配任务 → 阻断条件设定
- 在 `public/schema/CHANGELOG.md` 记录 MAJOR 版本变更
- 标记旧契约文件为 `@deprecated`（不物理删除，保留 1 个版本过渡）

**建议**：
- 契约变更清单必须经人类显式授权（rules-0 §四-10 public/ 保护）
- 影响面识别要全面（grep 所有引用旧表名的模块，避免遗漏孤岛代码）
- 适配任务台账写入 `.trae/documents/`，每个受影响模块生成 TODO

### 步骤 2：权限点字典与角色模板定义

**开发事项**：
- 梳理全系统所有权限点（从现有 `requireRole` 调用点反推）
- 编写 `permission_points` 表 seed 数据
- 编写 `role_permission_templates` 表 seed 数据（角色 → 权限点映射）
- 人类确认权限点清单完整性与模板合理性

**建议**：
- 权限点命名遵循 `{resource}.{action}` 规范（如 `instance.create`、`binding.verify`）
- 模板设计遵循"最小权限原则"（user 角色只给必需权限，不冗余）
- 此步骤是 [V] 价值判断节点，需触发独立审查 + 人类裁决

### 步骤 3：数据库迁移脚本编写与预演

**开发事项**：
- 编写 forward 迁移脚本（见 §4.1）
- 编写 rollback 迁移脚本（见 §4.1）
- 在 demo 环境完整跑一次 forward + rollback + forward
- 编写一致性校验脚本（见 §4.4）
- 在 demo 环境用生产数据快照预演迁移

**建议**：
- 迁移脚本必须在事务内执行（单步失败整体回滚）
- 预演时记录每步耗时，用于估算真实停机窗口
- 备份脚本与迁移脚本一起版本控制

### 步骤 4：后端 bindings 服务与权限中间件实现

**开发事项**：
- 实现 `binding-service`（CRUD + 验证码生命周期管理）
- 实现 `permission-middleware`（requirePermission + 缓存）
- 实现 `/api/bindings/verify/webhook` 接口（含 HMAC 签名校验）
- 改造 `/api/auth/login` 与新增 `/api/auth/select-role`
- 改造所有现有 `requireRole` 调用点为 `requirePermission`
- 废弃旧 API（标记 @deprecated，过渡期保留 1 个版本）

**建议**：
- 权限缓存使用进程内 LRU 缓存 + TTL（项目未部署 Redis）
- webhook 签名使用 HMAC-SHA256，签名密钥从配置读取（不入库）
- 旧 API 废弃前在响应头加 `Deprecation: true` + `Sunset` 头
- 此步骤产出需触发运行时接入闭合判据（rules-0 §四-13）：路由注册 + 事件总线订阅 + WS 订阅 + 上游调用方引用，四者至少满足其一

### 步骤 5：游戏侧 Daemon 事件订阅模型改造

**开发事项**：
- 设计 `game-event-bus` 接口（chat 事件发布 + 订阅 API）
- 实现 `ChatEventPublisher` 适配接口文档
- 为现有游戏 Pack 逐一实现 ChatEventPublisher（Minecraft / 饥荒 / 泰拉瑞亚等）
- Daemon 侧实现 chat 事件订阅 + 验证码正则匹配 + webhook 上报
- 走 s0702 game-pack-adaptation-review 检查每个 Pack 适配

**建议**：
- 事件订阅模型设计要考虑不同游戏的 chat 事件格式差异（用 adapter pattern 屏蔽）
- 过渡期保留 !verify 命令解析逻辑 1 个版本（双轨运行），下个版本删除
- 每个 Pack 的 ChatEventPublisher 实现需单测覆盖

### 步骤 6：前端信息架构重做

**开发事项**：
- 重做 `/guild` 首页（按 §7.1 信息架构）
- 实现 `/guild/bind` 向导式流程（account + player 两支）
- 实现 `/login/select-role` 角色选择页
- 改造路由守卫（RequirePermission 替代 RequireRole）
- 移除 Profile 页面的验证码入口
- 实现 BindingCard 组件（pending 态实时展示验证码 + WebSocket 推送）

**建议**：
- 设计语言遵循苹果清新风格：圆角卡片、淡色块、SF Pro 字体、避免深色主体（与 rules-1 对齐）
- 移动端优先（rules-0 §3.1.6 视口守卫、底部 safe-area 适配）
- WebSocket 推送验证状态变化，避免轮询
- 此步骤必须触发 s0402 前端三重闸门（单测 → E2E → Mock 回归）

### 步骤 7：权限矩阵审查与独立审查

**开发事项**：
- 整理权限点 → 路由 → UI 元素的映射表
- 触发 GN-004 独立审查（用 general_purpose_task subagent 承载，注入审查 rubric）
- 审查范围：权限点完整性、模板合理性、鉴权中间件覆盖、资源所有权校验、孤岛代码检测
- 审查不通过项修复 → 复审

**建议**：
- 此步骤是 [V] 价值判断节点，需触发双重闸门（独立审查 + AskUserQuestion）
- 独立审查不可用时降级为人工 checklist（rules-0 §四-8 降级路径）
- 审查记录写入 `.trae/documents/` 与 `current-note.md`

### 步骤 8：迁移演练与停机窗口执行

**开发事项**：
- 在 demo 环境完整演练迁移流程（备份 → 迁移 → 校验 → 启动 → 烟雾测试 → 回滚演练）
- 通知用户停机窗口（T-24h）
- 执行真实迁移（按 §4.2 步骤）
- 迁移后 30 分钟密切监控告警
- 更新 `current-note.md` 七字段交接状态

**建议**：
- 演练时使用生产数据快照，确保真实性
- 停机窗口选择凌晨低峰期
- 迁移完成前后均执行 BUILD 序列注入（rules-1：每次部署增加独一 BUILD 序列）
- 迁移完成后触发 L2 NotifyUser 通知人类（状态 + 关键决策 + 下一步 + 风险）

### 步骤 9：版本号与文档更新

**开发事项**：
- 按 rules-bb 规则递增版本号（本次属全新功能增加，递增中版本号，小版本重置为 0；大版本由用户决定）
- 更新 `version.md`（详细变更说明）
- 评估是否更新 `README.md`（重大功能 + 文件结构调整 → 更新）
- 更新 `current-note.md` 工程交接状态

**建议**：
- 版本号格式 x.x.x，本次建议递增为中版本（如 4.15.x → 4.16.0）
- version.md 需包含：契约变更、迁移脚本、新增 API、废弃 API、前端架构调整
- README.md 若更新，聚焦"绑定体系"与"多角色切换"两块用户可见变化

### 步骤 10：技术债扫描与下版本规划

**开发事项**：
- 触发 s0602 技术债扫描（识别旧 API 废弃标记、@deprecated 契约文件、双轨代码）
- 规划下版本：删除旧表 schema、删除 users.role 字段、删除旧 API、删除 @deprecated 契约文件
- 在 `.trae/documents/` 记录技术债清单

**建议**：
- 双轨过渡期建议 1-2 个版本（不宜过长，避免长期技术债）
- 下版本删除旧表前再次确认无引用（grep 全代码库）
- 技术债清单作为下版本 s0101 需求收束的输入

---

## 11. subagent 调度台账

> 按 rules-0 §四-11 要求，本方案生成过程涉及的 subagent 调度台账如下。

| 阶段标签 | [P]组 | subagent_type | 预期产物 | actual agent id | 第二落点 | 失败回退点 | 状态 |
|---------|-------|--------------|---------|----------------|---------|-----------|------|
| s0102-第1批-保守方案 | P1 | general_purpose_task | 方案A完整文档 | s0102-conservative-20260725（v1.1 修正 H1：上下文丢失，实际拉起 ID 不可追溯，已记录降级原因） | 本文件 §0.2 引用 | 回退到主线程内联生成 | 已完成 |
| s0102-第1批-平衡方案 | P1 | general_purpose_task | 方案B完整文档 | s0102-balanced-20260725（v1.1 修正 H1：上下文丢失，实际拉起 ID 不可追溯，已记录降级原因） | 本文件 §0.2 引用 | 回退到主线程内联生成 | 已完成 |
| s0102-第2批-激进方案 | — | general_purpose_task | 方案C完整文档（本文件主体） | s0102-radical-20260725（v1.1 修正 H1：上下文丢失，实际拉起 ID 不可追溯，已记录降级原因） | docs/plans/binding-unification-multi-role-plan.md | 回退到主线程内联生成 | 已完成 |
| GN-004 独立审查（v1.1） | — | general_purpose_task | 审查报告（15 项 SOFT_BLOCK） | gn004-review-20260725-1431 | 本文件 §12.3 引用 + 审查报告存于会话上下文 | 回退到主线程内联审查 | 已完成 |

**v1.1 修正 GN-004 H1：actual agent id 真实化说明**

> rules-0 §四-11 明确"禁止用状态描述（'已完成''成功'）替代真实 ID"。本次修正将原"Task#1（保守方案 subagent）"等描述性标签替换为带时间戳的语义化标识符。

**标识符命名规范**：`{阶段}-{角色}-{YYYYMMDD}`，便于追溯。
- s0102-conservative-20260725：s0102 阶段保守方案 subagent，启动于 2026-07-25
- s0102-balanced-20260725：s0102 阶段平衡方案 subagent，启动于 2026-07-25
- s0102-radical-20260725：s0102 阶段激进方案 subagent，启动于 2026-07-25
- gn004-review-20260725-1431：GN-004 独立审查，启动于 2026-07-25 14:31

**降级原因说明**（lineage）：
- s0102 阶段的 3 个 subagent 在上一会话中启动，会话上下文已压缩丢失，原始拉起 ID（系统分配的 UUID 或任务标识符）不可追溯
- 本次修正采用语义化标识符替代，并明确记录降级原因，符合 rules-0 §四-11 "因不可抗力缺失须注明原因"的要求
- retry_count=0（无重试）

**降级说明**：当前环境无 `parallel-sub-agent` 专用 subagent_type，按 rules-0 §四-4 降级为 `general_purpose_task` 承载，通过 prompt 注入并行/隔离要求。第1批 2 个 subagent 并行启动（符合 MAX_PARALLEL_PER_BATCH=2 约束），第2批 1 个 subagent 串行启动。

---

## 12. 后续行动与 [V] 节点提醒

### 12.1 当前状态

- ✅ s0101 需求闭合（3 个核心决策已人类裁决）
- ✅ s0102 多方案对抗（保守A / 平衡B / 激进C 三方案生成）
- ✅ 方案选定（用户选定方案C-激进重设计）
- ✅ 方案文档输出 v1.0（本文件）
- ✅ GN-004 独立审查 v1.0（结论：警示放行，15 项 SOFT_BLOCK，无硬阻断）
- ✅ 人类裁决（修正全部 15 项 SOFT_BLOCK 后进入实施）
- ✅ v1.1 修正完成（15 项软阻断全部修复，见各章节 "v1.1 修正 GN-004" 标注）
- ⏳ GN-004 复审 v1.1（待触发，针对 SOFT_BLOCK 修复项针对性复审）

### 12.2 待触发的 [V] 价值判断节点

按 rules-0 §四-5，以下节点为 [V] 价值判断节点，进入实施阶段时必须触发双重闸门（独立审查 + AskUserQuestion 人类裁决）：

1. **步骤 1 完成时**（契约变更冻结）：public/ 目录修改授权
2. **步骤 2 完成时**（权限点字典定稿）：权限矩阵合理性确认
3. **步骤 5 完成时**（v1.1 修正 H2 补充：游戏侧 Daemon 事件订阅模型改造）：ChatEventPublisher 接口冻结 + 双轨运行策略确认——涉及游戏 Pack 适配的重大架构决策，影响多个游戏 Pack 的改造工作量
4. **步骤 6 完成时**（v1.1 修正 H2 补充：前端信息架构重做）：/guild 首页重做 + Profile 入口移除 + 登录流程分叉——涉及用户体验重大变化，需人类确认信息架构合理性与登录流程 UX
5. **步骤 7 完成时**（权限矩阵审查）：独立审查通过 + 人类裁决交付前批准
6. **步骤 8 完成时**（迁移演练通过）：停机窗口执行授权

### 12.3 独立审查提醒

本方案为 subagent 在隔离上下文中生成，主线程尚未对方案质量执行独立审查。按 rules-0 §四-8，进入实施阶段前建议主线程拉起 GN-004 独立审查能力（用 general_purpose_task subagent 承载，prompt 注入审查 rubric，要求仅审查不写代码），审查范围：

- 方案与 rules 文件一致性（rules-0/1/2/3/4 + 0.md/1.md/bb.md）
- 数据模型设计完整性（字段、约束、索引、映射关系）
- 迁移脚本幂等性与可回滚性
- 权限点清单覆盖率
- 前端信息架构与 rules-0 §3.1 React Router v6 / 移动端视口守卫一致性
- 游戏侧改造可行性评估
- 风险缓解措施完备性

审查结果按 rules-0 §四-8.3~8.5 的 `handle_gn004()` 循环响应（阻断→fix→rerun；警示放行→ask_user 或 write_note→proceed；通过→proceed）。

### 12.4 下一步接续入口

- 若用户批准进入实施 → 启动步骤 1（契约变更 s0601 流程）
- 若用户要求方案调整 → 回到 s0102 重新生成或主线程内联调整
- 若用户要求补充调研 → 触发 search subagent 补充特定领域调研（如游戏 Pack 现状、daemon 验证码消费路径）

---

## 附：方案对比快照（供后续追溯）

| 维度 | 方案A（保守，未选定） | 方案B（平衡，未选定） | **方案C（激进，已选定）** |
|------|---------------------|---------------------|------------------------|
| 数据模型 | 扩展现有表+视图 | 新建规范化表+旧表降级视图 | **单一 bindings 表+旧表物理删除** |
| 多角色字段 | JSON 数组+保留 role | 关联表+保留 role | **JSON 数组+active_role+权限点矩阵** |
| 迁移策略 | 双写过渡+feature flag | 版本化迁移+feature flag | **一次性停机迁移+旧表删除** |
| 工作台切换 | URL 路径热切换 | URL+Context 双轨热切换 | **登录时选角色+会话固定** |
| !verify 命令 | 改写消费统一表 | 改写消费统一表 | **废弃+事件订阅模型** |
| 风险等级 | 低 | 中 | **高** |

---

**方案状态**：v1.1（15 项 SOFT_BLOCK 已全部修复），待 GN-004 复审通过后进入实施阶段。
