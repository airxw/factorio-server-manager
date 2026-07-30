# Test3 — Mock 回归检查清单（s0402 三重闸 Test3）

**执行时间**: 2026-07-30 14:15 CST
**状态**: **PASS**

## 检查方法

通过代码审查 + 契约对比，验证 MSW Mock handlers 与更新后的后端契约/数据 schema 一致。

## 检查清单

### 1. POST /api/player-bindings/:id/verify — vip_level 契约一致性

| 项 | Mock 值 | 后端实现（verifyBindingByCode） | 契约（bindings-schema.json） | 状态 |
|----|---------|-------------------------------|---------------------------|------|
| verify_status | `'verified'` | `'verified'` | enum 含 `'verified'` | ✅ 一致 |
| vip_level | `1`（本次修正） | `DEFAULT_BOUND_VIP_LEVEL = 1` | integer 0-5 | ✅ 一致 |

**修复记录**: Mock 原返回 `vip_level: 0`（验证后），与后端实现矛盾。已修正为 `vip_level: 1`（spec 决策：验证通过后赋予 VIP1）。

### 2. POST /api/player-bindings — 创建 player 绑定（pending）

| 项 | Mock 值 | 后端实现（generateVerifyCode） | 状态 |
|----|---------|------------------------------|------|
| verify_status | `'pending'` | `'pending'` | ✅ 一致 |
| vip_level | `0` | `0` | ✅ 一致 |
| binding_type | `'player'` | `'player'` | ✅ 一致 |
| scope_type | `'instance'` | `'instance'` | ✅ 一致 |

### 3. DELETE /api/player-bindings/:id — 解绑

| 项 | Mock 值 | 后端实现 | 状态 |
|----|---------|---------|------|
| verify_status | `'revoked'` | `'revoked'` | ✅ 一致 |
| vip_level | `0` | `0` | ✅ 一致 |

### 4. bindInstance（POST /api/instances/:serverId/bindings）

| 项 | Mock | 后端实现 | 状态 |
|----|------|---------|------|
| Mock handler | 不存在（无 Mock） | — | ⚠️ 无 Mock 覆盖 |

**说明**: `bindInstance` 无 MSW Mock handler。该端点在前端通过 `api.bindInstance()` 直接调用后端，不经过 Mock 层。单测中通过 `vi.fn()` 直接 mock `api.bindInstance`，不依赖 MSW handler。**无 Mock 回归风险**。

### 5. listMyBindings（GET /api/profile/bindings）

| 项 | Mock | 后端实现 | 状态 |
|----|------|---------|------|
| Mock handler | 不存在（无 Mock） | — | ⚠️ 无 Mock 覆盖 |

**说明**: `listMyBindings` 无 MSW Mock handler。单测中通过 `vi.fn().mockResolvedValue([])` 直接 mock。**无 Mock 回归风险**。

### 6. mockDiscoverRecommended fixture 契约校验

| 字段 | fixture 值 | DiscoverServer 契约 | 状态 |
|------|-----------|-------------------|------|
| id | ✅ 存在 | string | ✅ |
| name | ✅ 存在 | string | ✅ |
| online_players | ✅ 存在 | number | ✅ |

**单测覆盖**: `GuildServers.test.tsx` 的 `mockDiscoverRecommended fixture 符合 DiscoverServer 契约（Mock 回归）` 测试通过。

### 7. GuildServers 市场 cards 数据契约

| 字段 | Mock fixture | BindableServer 契约 | 状态 |
|------|-------------|-------------------|------|
| is_public | ✅ | boolean | ✅ |
| is_owner | ✅ | boolean | ✅ |
| is_bound | ✅ | boolean | ✅ |
| can_direct_bind | ✅ | boolean | ✅ |
| can_request_bind | ✅ | boolean | ✅ |
| has_pending_request | ✅ | boolean | ✅ |
| binding_requests_enabled | ✅ | boolean | ✅ |

## Mock 回归发现的问题汇总

| # | 问题 | 严重性 | 修复状态 |
|---|------|--------|---------|
| 1 | verify 端点 Mock vip_level=0（应为 1） | 高 | ✅ 已修复 |

## 未覆盖项（无 Mock，无回归风险）

| 端点 | 原因 | 替代覆盖 |
|------|------|---------|
| POST /api/instances/:serverId/bindings | 无 MSW handler | vi.fn() 直接 mock（单测覆盖） |
| GET /api/profile/bindings | 无 MSW handler | vi.fn().mockResolvedValue([])（单测覆盖） |

## 结论

Test3 状态: **PASS** — Mock handlers 与更新后的后端契约一致。发现并修复 1 个 vip_level 契约偏离（verify 端点）。无 Mock 覆盖的端点通过 vi.fn() 直接 mock 在单测中覆盖，无回归风险。
