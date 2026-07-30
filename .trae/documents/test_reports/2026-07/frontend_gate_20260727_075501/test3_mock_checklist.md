# Test3 — Mock 回归清单（v4.28.0 全员服主·免密切换）

> 闸门：s0402 前端三重测试闸门 · Test3 Mock 回归
> 时间：2026-07-27 08:05 (Asia/Shanghai)
> Mock 层：MSW（`panel/frontend/src/mocks/handlers.ts`）+ `renderWithProviders` 全上下文隔离

## 1. Mock 路径变更点

| 变更 | 文件 | 说明 |
|---|---|---|
| 新增 | handlers.ts `POST /api/auth/switch-role` | 免密切换 mock：JWT 鉴权 → 等级闸门（server_admin 目标 400 ROLE_SWITCH_REQUIRES_PASSWORD）→ roles 成员校验（400 ROLE_NOT_GRANTED）→ 签发新 token 并登记 RUNTIME_TOKEN_TO_USER |
| 扩展 | handlers.ts DEMO_USERS | 三 demo 账号补 `roles` / `active_role`：admin=[server_admin,instance_admin,user]、manager=[instance_admin,user]、user=[user,instance_admin]（对齐迁移后 §2.2 角色集合规范） |
| 扩展 | handlers.ts requireAuth/getUserFromRequest | 识别 switch-role 运行时签发的新 token，保证切换后 `/api/auth/me` 返回新 active_role |

## 2. Mock 回归核对项

- [x] `POST /api/auth/switch-role` 免密路径返回 `{ token, user }` 与 SwitchRoleResponse 契约同构（public/schema/panel-api-types.ts:706）
- [x] server_admin 目标被闸门拦截（400），密码通道语义不被 mock 绕过
- [x] 目标角色 ∉ roles 时 400，与后端 routes-registry 行为一致
- [x] 切换后新 token 可通过 `/api/auth/me` 反查（RUNTIME_TOKEN_TO_USER），会话连续性成立
- [x] 既有 login/me/servers 等 handlers 未受改动影响：全量 MSW 单测 239/239 通过（test1_scoped_pass.log，21 文件）
- [x] 新增组件单测覆盖 mock 路径：RoleSwitcherModal.test.tsx（免密/密码双通道）、Layout.test.tsx（三基座菜单显隐）、Forbidden.test.tsx（403 切换引导）、GuildBind.test.tsx —— 22/22 通过

## 3. 结论

Mock 回归 **PASS**。mock 行为与后端真实端点语义一致（等级闸门 / roles 校验 / 新 token 签发），
契约字段与 public/schema/panel-api-types.ts v4.28.0 对齐。
