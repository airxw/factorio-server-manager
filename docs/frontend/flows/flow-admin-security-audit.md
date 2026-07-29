# 流程：系统安全与审计

## 目标

系统管理员通过 `/admin/users` → `/admin/audit-logs` → `/admin/webhooks` → `/admin/player-bindings` 完成用户管理、行为审计、事件外发与玩家身份审核的闭环。

## 前置条件

- 角色为 `server_admin` / `system_admin` / `admin`。
- 审计日志已开启（默认开启，由 `audit-logs.ts` 中间件记录）。
- Webhook 目标 URL 可达（建议先在测试环境验证）。

## 主流程

```
[/admin/users]  ← 用户列表 + 新建 + 编辑 + 删除 + 角色分配
        │
        │ GET    /api/users              → 列表（含角色）
        │ POST   /api/users              → 新建
        │ PUT    /api/users/:id          → 编辑（含角色变更）
        │ DELETE /api/users/:id          → 删除（系统内置账号不可删）
        │ 所有写操作 → 自动写入 audit_logs
        ▼
[/admin/audit-logs]  ← 服务器/用户/动作/目标/时间/条数/关键词筛选 + CSV 导出
        │
        │ GET /api/audit-logs?...        → 分页查询
        │ GET /api/audit-logs/export     → CSV 导出
        ▼
[/admin/webhooks]  ← 服务器筛选 + 新建 Webhook（URL/事件/Secret/启用）+ 测试
        │
        │ POST   /api/webhooks           → 新建
        │ PUT    /api/webhooks/:id       → 更新
        │ DELETE /api/webhooks/:id       → 删除
        │ POST   /api/webhooks/:id/test  → 测试投递
        │ 事件触发时 → 后端异步 POST 到目标 URL（HMAC 签名）
        ▼
[/admin/player-bindings]  ← 服务器下拉 + 玩家绑定审核列表
        │
        │ GET    /api/admin/player-bindings?serverId=xxx
        │ PUT    /api/admin/player-bindings/:id  → 审核（通过/拒绝）
        ▼
[闭环]
```

## 失败与回退

| `[EDGE]` 边界 | UI 反应 | 备注 |
|---------------|---------|------|
| 删除系统内置账号 | 后端返回 403 → Toast「系统账号不可删除」 | 见 `users.ts` |
| 修改自己角色 | 后端返回 403 → Toast「不能修改自身角色」 | 防提权 |
| Webhook URL 格式错误 | 前端未做校验直接提交，后端 422 → Toast | 见 [admin-webhooks.md](../pages/admin-webhooks.md) §11 |
| Webhook 投递失败 | 后端 retry 3 次后标记 failed，UI 显示红色状态 | 见 `webhooks-service.ts` |
| 审计日志查询超时 | 30s 超时 → Toast「查询超时，请缩小时间范围」 | 见 `AuditLogs.tsx` |
| 玩家绑定审核通过后角色未生效 | 需用户重新登录刷新 token | 已知限制 |

## 关键接口

| `[API]` 接口 | 方法 | 鉴权 | 用途 |
|--------------|------|------|------|
| `/api/users` | GET/POST | JWT+admin | 用户列表/新建 |
| `/api/users/:id` | PUT/DELETE | JWT+admin | 编辑/删除 |
| `/api/audit-logs` | GET | JWT+admin | 查询 |
| `/api/audit-logs/export` | GET | JWT+admin | CSV 导出 |
| `/api/webhooks` | GET/POST | JWT+admin | 列表/新建 |
| `/api/webhooks/:id` | GET/PUT/DELETE | JWT+admin | 详情/更新/删除 |
| `/api/webhooks/:id/test` | POST | JWT+admin | 测试投递 |
| `/api/admin/player-bindings` | GET | JWT+admin | 列表 |
| `/api/admin/player-bindings/:id` | PUT | JWT+admin | 审核 |

## 页面引用

- [admin-users.md](../pages/admin-users.md)
- [admin-audit-logs.md](../pages/admin-audit-logs.md)
- [admin-webhooks.md](../pages/admin-webhooks.md)
- [admin-player-bindings.md](../pages/admin-player-bindings.md)
- [admin-system-config.md](../pages/admin-system-config.md)
- [admin-settings.md](../pages/admin-settings.md)

## 风险与待办

- `[RISK]` `Webhooks` URL 字段未做格式校验（SSRF 风险），目标 URL 可指向内网。
- `[RISK]` `Webhooks` Secret 以明文 `<input type="text">` 展示，肩窥风险。
- `[RISK]` `SystemConfig` 敏感配置（如 `mail.smtp_password`）在表格明文展示。
- `[RISK]` 确认弹窗风格不统一：Users 用 Modal，SystemConfig/PlayerBindings/Webhooks 用 `window.confirm`。
- `[RISK]` 类型契约漂移：`SettingSchemaItem` 在 `client.ts` 与 `modules/settings.ts` 重复定义且 `group` 集合不一致（6 vs 10）。
- `[TODO]` 审计日志应支持「按目标 ID 反查」入口（如从 `/admin/users/:id` 一键查所有操作）。
- `[TODO]` Webhook 应支持「重试failed 投递」按钮。
- `[TODO]` 移动端双视图不统一：Users/AuditLogs 有 `mobile-card-list`，其余 4 页依赖全局 CSS。
