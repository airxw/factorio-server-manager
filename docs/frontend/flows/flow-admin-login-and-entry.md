# 流程：系统管理员登录与基座进入

## 目标

描述系统管理员角色从访问站点到进入 `/admin` 基座完成首次渲染的完整链路，覆盖登录、角色分流、基座门控、Layout 渲染四阶段。

## 前置条件

- 站点已完成首启动初始化（`/api/init/status` 返回 `initialized: true`），否则访问根路径会被引导至 `/setup`。
- 用户已由更高权限管理员分配 `server_admin` / `system_admin` / `admin` 角色之一。
- 浏览器入口仅允许 `https://gsp.ecsrz.com:3001`（公网）或 `https://192.168.5.14:3001`（局域网）。

## 主流程

```
[用户访问任意 /xxx]
        │
        ▼
[AuthProvider.initialize()]  ← 读取 localStorage panel_token + 调用 /api/auth/me
        │
   ┌────┴────┐
   │ 未登录  │ 已登录
   ▼         ▼
[/login]   [RootRedirect]
   │         │
   │   ┌─────┼─────────┐
   │   ▼     ▼         ▼
   │ server_  instance_  user
   │ admin    admin
   │   │     │         │
   │   ▼     │         │
   │ [/admin]│         │
   ▼         ▼         ▼
[Login 表单]  [/store]   [/guild]
   │
   │ 提交 → POST /api/auth/login
   │ 成功：JWT 入 localStorage + setState user
   │ 失败：429/401 → Toast 错误提示
   ▼
[Navigate to state.from || 角色对应基座]
        │
        ▼
[/admin 进入 AdminLayout]
        │
        ▼
[RequireRole allow=['server_admin','system_admin','admin']]
        │
        ▼
[<Layout variant="admin">]  ← 侧栏/面包屑/通知铃铛/命令面板/移动端导航
        │
        ▼
[<Outlet/> 渲染 AdminDashboard]
```

## 失败与回退

| `[EDGE]` 边界 | UI 反馈 | 备注 |
|---------------|---------|------|
| Token 过期 | 401 → axios 拦截器清 localStorage → 下次跳 `/login` | 见 `client.ts` |
| 角色不足 | 进入 `/admin` 时 `RequireRole` 渲染 `<Forbidden />` | 见 [App.tsx#L371](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/App.tsx#L371) |
| 站点维护模式 | 503 → 自动跳 `/maintenance` | 由 API client 拦截 |
| 首启动未初始化 | `/api/init/status.initialized === false` → 跳 `/setup` | 见 `SetupWizard` |
| 登录限流 | 429 → Toast「尝试过多，请稍后再试」 | 见 `PANEL_RATE_LIMITED` |

## 关键接口

| `[API]` 接口 | 方法 | 鉴权 | 用途 |
|--------------|------|------|------|
| `/api/auth/login` | POST | 公开 | 提交账号密码换取 JWT |
| `/api/auth/me` | GET | JWT | 启动时拉取当前用户信息 |
| `/api/init/status` | GET | 公开 | 判断首启动 |
| `/api/system/mode` | GET | JWT | 判断维护模式 |

## 页面引用

- [admin-dashboard.md](../pages/admin-dashboard.md)
- [../../panel/frontend/src/pages/Login.tsx](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/Login.tsx)
- [../../panel/frontend/src/App.tsx](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/App.tsx)
- [../../panel/frontend/src/layouts/AdminLayout.tsx](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/layouts/AdminLayout.tsx)
- [../../panel/frontend/src/components/RequireRole.tsx](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/components/RequireRole.tsx)

## 风险与待办

- `[RISK]` `localStorage` 存 JWT，XSS 可窃取；建议引入 HttpOnly Cookie + CSRF Token 方案。
- `[TODO]` 登录页支持用户名/邮箱双模式已上线，但未做「忘记密码」入口的强引导。
- `[TODO]` `RootRedirect` 角色判断硬编码，未来新增角色需同步修改。
