# Test3 — Mock 回归核对表 — Forbidden Page Fix v4.37.1

**执行时间**: 2026-07-30 12:43 (Asia/Shanghai)

## 适用性判定

本次改动范围:
- `panel/frontend/src/pages/Forbidden.tsx` — 视觉重做（保留全部业务逻辑）
- `panel/frontend/src/pages/Register.tsx` — 跳转目标 `/dashboard` → `/`
- `panel/frontend/src/pages/NotFound.tsx` — 链接 `/dashboard` → `/`
- `panel/frontend/src/pages/ServerError.tsx` — 链接 `/dashboard` → `/`
- `panel/frontend/src/App.tsx` — `/dashboard` redirect target `/admin` → `/`
- `panel/frontend/src/styles.css` — 新增 `.forbidden-page` 系列样式

**Mock 路径触发判定**: 本次改动不涉及 API 契约变更、不涉及 WS 事件、不涉及数据契约、不涉及 Mock 实现切换。Forbidden.tsx 仅消费 `useAuth()`（user/switchActiveRole）与 `useToast()`，这些 hook 的契约未变。Register.tsx 仅改 `navigate()` 目标字符串，不涉及 API 调用签名变更。

因此 Test3 为「不适用」(N/A) — 无 Mock 回归路径需要验证。本次改动通过 Test1（单测）+ Test2（内置浏览器端到端）已完整覆盖。

## Mock 回归核对清单（结构性 N/A 说明）

| # | 检查项 | 状态 | 说明 |
|---|--------|------|------|
| 1 | API 契约签名变更 | N/A | 无 API 签名变更 |
| 2 | WS 事件类型变更 | N/A | 无 WS 事件变更 |
| 3 | 数据契约（zod schema）变更 | N/A | 无数据契约变更 |
| 4 | pre_generated_mock/ 更新需求 | N/A | 无新增接口需要 Mock |
| 5 | global_mock/ 覆盖回归 | N/A | 无 Mock 路径改动 |
| 6 | Forbidden.tsx 行为契约（角色切换 CTA） | PASS | Test1 6/6 用例覆盖，行为不变 |
| 7 | Register.tsx 注册后路由契约 | PASS | Test2 端到端验证跳转到 /guild |
| 8 | 路由守卫契约（RequireRole → /forbidden） | PASS | Test2 验证 /admin/users → /forbidden 重定向正常 |

## 结论
Test3 N/A（无 Mock 路径触发）— 本次改动为纯前端视觉 + 路由字符串修正，不涉及任何 Mock 适配层。Test1 + Test2 已完整覆盖改动面。
