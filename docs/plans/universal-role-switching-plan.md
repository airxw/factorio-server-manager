---
type: plan
title: 全员服主——玩家↔服主快捷切换方案
date: 2026-07-27
status: reviewed
related:
  - panel/frontend/src/components/Layout.tsx
  - panel/frontend/src/components/RoleSwitcherModal.tsx
  - panel/frontend/src/api/auth.tsx
  - panel/backend/src/routes-registry.ts
  - panel/backend/src/services/userService.ts
  - panel/backend/src/core/auth/roles.ts
  - public/schema/panel-api-types.ts
tags: [role-switching, multi-role, guild, store, auth]
---

# 全员服主——玩家↔服主快捷切换方案

## 一、背景与目标

### 1.1 问题现状

- 玩家门户（/guild）顶部头像下拉菜单**没有「切换角色」入口**，仅有「个人设置 / 平台大盘* / 服主工作台* / 退出登录」（* 仅管理员角色可见）。
- 已有的 RoleSwitcherModal（v4.17.0）只接在 /guild 首页用户卡片上（GuildDock.tsx），且仅对 `roles.length > 1` 的账号显示。
- 线上纯玩家账号（如 air，roles=["user"]）**没有任何路径获得服主身份**：头像菜单无切换入口，/store 与 /instances/new 均被 active_role 门控拦截。
- RoleSwitcherModal 当前要求重新输入密码（二次校验），与「切换应该很快捷」冲突。

### 1.2 产品决策（已经人类裁决）

1. **全员服主**：玩家和腐竹是同层级的两面——玩家自己开服就是服主，玩别人的服就是玩家。注册即得 `roles=['user','instance_admin']`，存量用户数据迁移补齐。身份自由切换，核心是玩家想不想开服。
2. **分级免密**：玩家 ↔ 服主互切**免密**（同级身份切换，JWT 会话内直接完成）；切换到 `server_admin`（平台管理员）仍要求密码二次校验（防 session hijack 提权）。
3. 充值钱包共享：玩家可买 VIP（付给目标实例服主），也可买实例自己开服（付给平台）。本方案不涉及支付改动，仅记录为背景。

### 1.3 目标

- 任何登录用户在**任意基座**（/guild 顶部头像、/store 与 /admin 侧边栏用户菜单）都能 1-2 次点击完成 玩家↔服主 切换。
- 纯玩家切换到服主后可直接创建自己的第一个实例（受每用户实例配额约束）。
- 权限门控代码零改动：requireRole / requirePermission 判定逻辑维持现状（两者判定语义差异见 §2.1 修正），切换本身走签发新 JWT 的既有机制。

## 二、总体设计

### 2.1 核心思路

不改动任何权限门控代码。「全员服主」通过**角色集合成员资格**落地：让每个账号的 `roles` 都包含 `user` 与 `instance_admin`，切换 active_role 即完成身份变更——既有门控自然放行/拦截，无需反转 v4.15.2 的任何代码。

> **独立审查修正（SB-1）——两类门控的判定语义不同，须如实区分**：
> - `requireRole(...)`（含前端 `RequireRole`）：按 **active_role 单值**判定（middleware/auth.ts:357；前端读 `user.role` = active_role）。/store 前端基座、store-gm 系后端路由（store-gm.ts:108/254/342/430）走此语义——**切换身份仍是访问服主工作台的硬前提**。
> - `requirePermission('instance.*')`：按 **JWT roles 全集 OR 语义**判定（middleware/auth.ts:308/331；permissions.ts:163-178）。servers.ts 创建实例走此语义。
>
> 由此产生一个必须知情接受的安全语义：全员补齐 roles 后，`active_role=user` 的用户可直接调 `requirePermission` 类端点（如 `curl POST /api/servers` 创建实例），无需先切换。定性为**能力等价、非漏洞**——免密切换端点本身使任何用户可合法取得 instance_admin token，两种路径能力相同；前端 UI 门控不变，store-gm 系（requireRole 语义）仍强制切换。本方案接受此语义并在 §六-风险中登记。

### 2.2 角色集合规范（迁移后）

| 账号类型 | roles（迁移后） | active_role |
|---|---|---|
| 普通玩家 | `["user","instance_admin"]` | `user`（不变） |
| 实例管理员 | `["instance_admin","user"]` | `instance_admin`（不变） |
| 平台管理员 | `["server_admin","instance_admin","user"]` | `server_admin`（不变） |

规则：保留原有序与 active_role，仅**追加缺失项**（幂等）。

### 2.3 切换链路

```
头像菜单「切换为服主」→ POST /api/auth/switch-role {active_role:'instance_admin'}（JWT-only，免密）
  → 后端校验：目标 ∈ roles 且 等级 ≤ 2 → selectActiveRole 签发新 JWT
  → 前端刷新 auth context → navigate('/store')
```

`server_admin` 目标继续走既有 `POST /api/auth/select-role`（email+password 二次校验），契约与行为不变。

## 三、执行步骤

### 步骤 1：后端——注册与迁移补齐角色集合

1. `userService.register()`（约 277 行）：`roles: JSON.stringify([role])` 改为按角色生成全集（user → `['user','instance_admin']`；instance_admin → `['instance_admin','user']`；server_admin → `['server_admin','instance_admin','user']`），`active_role` 仍初始化为注册角色。
2. `userService.registerFromGame()`（约 569 行）：`roles=[Role.USER]` 同步改为 `['user','instance_admin']`。
   - **（SB-2）同点修复存量 bug**：registerFromGame 的 INSERT 仍写入 `role: Role.USER`（约 558 行）——`users.role` 列已被基线迁移 DROP（20260808000000_baseline_v4_post_demo.ts），写入必抛 SQL 错误。本次一并删除该字段写入。
3. **（SB-3）修复 seed.ts 演示账号路径**（seed.ts 约 60-76 行）：INSERT 同样写 `role` 列（已 DROP）且不写 `roles`/`active_role`——demo 账号缺 roles 时 `normalizeRoles(null)` 回退 `['user']`，不会获得 instance_admin。改为：删除 `role` 列写入，按 §2.2 规范写入 roles + active_role。
4. 新增数据迁移 `20260727000000_universal_roles_backfill.ts`：遍历 users 表，复用 `normalizeRoles` 解析 roles JSON（坏 JSON 回退 `['user']` 的既有语义），追加缺失的 `instance_admin` 与 `user`（server_admin 账号三项全齐），active_role 保持不变；迁移幂等（已补齐的行跳过），含回滚说明。
   - 注意：既有会话 JWT 中烧有旧 roles，迁移后**在线用户需重新登录或执行一次切换**才获得新 roles（登录链路 login() 自然输出新 roles，无需改动）。在 version.md 更新说明中注明。
5. 单元测试：注册角色集合初始化、registerFromGame/seed 写入列合规、迁移幂等性、三类账号补齐结果。

### 步骤 2：契约——新增免密切换端点（public/ 变更，需人类授权）

1. `public/schema/panel-api-types.ts` 新增：
   - `SwitchRoleRequest { active_role: UserRole }`
   - `SwitchRoleResponse { token: string; user: UserInfo }`（与 SelectRoleResponse 同构）
2. 契约版本化记录（MINOR：新增端点，无破坏），按 rules-3 §六 登记 CHANGELOG/@version 注释。

### 步骤 3：后端——免密切换端点

1. `routes-registry.ts` 新增 `POST /api/auth/switch-role`（`authenticateToken` 鉴权）：
   - 校验 `active_role` 合法且 ∈ 当前用户 roles；
   - **等级闸门**：`ROLE_LEVEL[target] <= 2`（user / instance_admin）才允许免密；target 为 server_admin 返回 400 并提示走 select-role 密码通道；
   - 调用 `userService.selectActiveRole` 签发新 JWT；
   - 审计日志 `user.switch_role`（与 select_role 区分）。
2. **（SB-4）修正 `selectActiveRole` 降级撤销语义**（userService.ts 约 865-881 行）：现状为 `ROLE_LEVEL[target] < ROLE_LEVEL[old]` 即 `revokeAllUserTokens`——`instance_admin(2)→user(1)` 也算降级，快捷互切会踢掉该用户所有设备会话，与「很快捷」直接冲突。改为：**仅当原 active_role 为 server_admin（level 3）的降级才撤销全部 token**（保留 R3-4 对唯一高权限角色的安全语义）；user ↔ instance_admin 视为同层身份两面（§1.2 决策 2），互切不撤销其他会话。
3. 单元测试：合法切换 200 + 新 JWT 含新 active_role；目标不在 roles → 400；目标 server_admin → 400；未认证 → 401；同级互切不撤销其他会话 token；server_admin 降级仍触发撤销。

### 步骤 4：前端——auth 上下文与 API 客户端

1. `api/modules/auth.ts` + `api/client.ts`：新增 `switchRole(active_role)`（免密，仅 JWT）。
2. `api/auth.tsx`：新增 `switchActiveRole(role)`——调 switchRole，成功后更新本地 token 与 user（与 selectRole 同路径），失败抛 PanelApiError。

### 步骤 5：前端——RoleSwitcherModal 分级免密

1. 选中目标角色为 `user` / `instance_admin` 时：**不再进入密码表单**，点击角色卡片立即调用 `switchActiveRole` → 关闭弹窗 → 跳转目标工作台（user→/guild，instance_admin→/store）。
2. 选中 `server_admin` 时：保持现有密码二次校验表单与 selectRole 链路不变。
3. 弹窗提示文案更新：同级切换说明「无需密码，即刻切换」；管理员切换说明「需密码二次校验」。

### 步骤 6：前端——头像菜单接入切换入口（三个基座）

1. **/guild 顶部头像下拉**（Layout.tsx player variant）：
   - 在用户信息区下方新增「切换为服主」/「切换为玩家」一键项（图标 ArrowLeftRight）：当前 active_role 为 user 时显示「切换为服主」，为 instance_admin 时显示「切换为玩家」，点击直接免密切换并跳转对应工作台，**无需打开弹窗**。
   - 拥有 3 个角色（平台管理员）时，改为显示「切换角色…」打开 RoleSwitcherModal（选择目标，server_admin 走密码）。
   - 保留现有「平台大盘 / 服主工作台」直跳项逻辑不变（仍按 active_role 显隐）。
2. **/store 与 /admin 侧边栏用户菜单**（Layout.tsx sidebar-user-dropdown）：新增同样的切换项，保证服主→玩家、管理员→其他身份同样快捷。
3. GuildDock 用户卡片入口保留，自动获得新免密行为。

### 步骤 7：前端——兜底体验

1. Forbidden 页：若当前用户 roles 中包含可满足目标页面的角色（如 active_role=user 访问 /store，但 roles 含 instance_admin），显示「切换到服主身份继续」按钮（免密切换后回跳原目标页）；否则保持现有 403 文案。
2. 空工作台引导：StoreHome 已有「创建第一个实例」CTA，切换后玩家自然落入该引导，无需额外开发；核验其跳转目标（/instances/new 或 /store/servers）在 active_role=instance_admin 下可用。

### 步骤 8：测试与验证

1. 后端单测（步骤 1/3 所列）全部通过。
2. 前端单测：RoleSwitcherModal 免密分支与密码分支；Layout 两处菜单项显隐逻辑。
3. E2E（Playwright）：注册新玩家 → 头像菜单一键切服主 → 创建实例成功（配额内）→ 切回玩家 → /guild 正常；管理员切 server_admin 需密码。
4. 前端变更走 s0402 三重闸门（单测 → E2E → Mock 回归）。
5. 契约测试：SwitchRole 请求/响应与 public/schema 类型一致。

### 步骤 9：版本与文档

1. 版本号：v4.26.0 → **v4.28.0**（全新能力：全员服主 + 免密切换，中版本号 +1，小版本号归零）。
   - **（SB-5）版本归属协调**：代码中已存在 v4.27.0 注释（userService.ts:283/529，bindings `scope_type='instance'` 进行中工作预定），而 version.md 当前为 4.26.0。本方案顺延 v4.28.0；若两项工作合并发布，可共用 v4.27.0，执行时以 version.md 实际状态重新校准。
2. 更新根目录 version.md（功能说明、存量用户需重新登录获得新 roles 的提示）、package.json/version.json 同步（deploy.sh 五处版本一致性校验）。
3. README.md 补充多角色切换说明（能力面变化，属重大功能）。

## 四、开发事项清单

| # | 事项 | 涉及文件 | 说明 |
|---|---|---|---|
| 1 | 注册角色集合初始化 | panel/backend/src/services/userService.ts | register / registerFromGame（SB-2：同点删除已 DROP 的 role 列写入） |
| 1b | seed 演示账号路径修复 | panel/backend/src/db/seed.ts | SB-3：删 role 列写入，补 roles/active_role |
| 2 | 存量角色补齐迁移 | panel/backend/src/db/migrations/20260727000000_universal_roles_backfill.ts | 幂等，热更新友好；复用 normalizeRoles 解析语义 |
| 3 | SwitchRole 契约 | public/schema/panel-api-types.ts | **public/ 变更，执行前需人类显式授权** |
| 4 | 免密切换端点 + 降级撤销语义修正 | panel/backend/src/routes-registry.ts、services/userService.ts | 等级闸门 ≤2，审计 user.switch_role；SB-4：仅 server_admin 降级撤销 token |
| 5 | 前端 switchRole API | panel/frontend/src/api/modules/auth.ts、client.ts、auth.tsx | 免密通道 |
| 6 | RoleSwitcherModal 分级免密 | panel/frontend/src/components/RoleSwitcherModal.tsx | user/instance_admin 一键切换 |
| 7 | /guild 头像下拉切换项 | panel/frontend/src/components/Layout.tsx | 一键切换 / 3 角色开弹窗 |
| 8 | 侧边栏用户菜单切换项 | panel/frontend/src/components/Layout.tsx | 覆盖 /store、/admin 基座 |
| 9 | Forbidden 页身份切换引导 | panel/frontend/src/pages/Forbidden.tsx | roles 可满足时给切换按钮 |
| 10 | 测试（单测/E2E/契约） | 各层测试文件 | 含三重闸门 |
| 11 | 版本与文档 | version.md、README.md、package.json、version.json | v4.28.0（SB-5：v4.27.0 已被进行中 bindings 工作预定，可协商合并） |

## 五、建议

1. **配额默认值复核**：`games.max_instances_per_user` 现状默认值需在全员服主上线前确认（建议保持小额默认值，如 3），防止节点资源被无限开服耗尽；server_admin 不受限的既有逻辑不变。
2. **审计可观测**：`user.switch_role` 与 `user.select_role` 在审计日志中分开统计，便于观察免密切换的使用频率与异常模式。
3. **管理员角色管理界面**：/admin/users 的角色编辑保留对 roles 集合的完全控制权（可移除某用户的 instance_admin），作为滥用回收手段；全员服主是默认值而非强制值。
4. **后续商业化衔接**：「买实例自己开服（付给平台）」落地时，可在创建实例流程中接入支付确认节点，本方案的配额与权限结构无需改动即可承接。
5. **切换后页面刷新策略**：免密切换签发新 JWT 后，前端整页跳转（replace）到目标工作台，避免旧 active_role 下的缓存数据残留；WS 连接随 token 更换自动重连（既有 sessionKey 机制）。

## 六、风险与登记语义

> 本节登记经独立审查核实、由方案显式接受的语义与风险，执行与验收时不得再视为未知项。

1. **requirePermission 集合语义（SB-1）**：全员补齐 roles 后，`active_role=user` 的用户可直调 `requirePermission('instance.*')` 类端点（如 POST /api/servers），无需先切换。定性为能力等价（免密端点本即可合法换取 instance_admin token），非漏洞；store-gm 系路由（requireRole / activeRole 语义）与前端 UI 门控仍强制切换。若后续要求 API 层也强制切换，需将 requirePermission 改为 activeRole 语义——属另一独立决策，不在本方案内。
2. **降级撤销收窄（SB-4）**：`selectActiveRole` 改为仅 server_admin 降级触发全量 token 撤销。user ↔ instance_admin 互切不再踢掉其他设备会话——这是「快捷互切」的必要条件，安全性影响可接受（两级均为低权限同层身份，JWT 本身已含全量 roles）。
3. **存量会话刷新延迟**：迁移不刷新已签发 JWT，在线用户在下次登录或切换前仍持旧 roles。接受此延迟，不强制全量下线。
4. **免密端点滥用面**：等级闸门 ≤2 + server_admin 保留密码通道 + 审计 `user.switch_role` 独立动作；token 泄露场景下攻击者本已拥有该账号全部自有角色，边际风险为零。
5. **资源滥用面**：全员可创建实例后，唯一防线为 `games.max_instances_per_user` 配额与 `games.enabled_packs` 白名单——上线前必须确认二者已配置（见 §五-1）。
