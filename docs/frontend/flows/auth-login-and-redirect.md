# 流程：登录与角色分流

- 范围：`/login → / → RootRedirect → (admin/store/guild)`
- 状态：已完成（2026-07-25）

## 1. 流程目标

在用户未登录或会话失效时，统一引导进入 `/login` 完成鉴权；登录成功后一律回跳根路由 `/`，再由 `RootRedirect` 按角色分流到对应基座，避免“各页面各自决定登录后跳转”的混乱。

## 2. 前置条件

- 前端路由已注册 `/login` 与根路由 `/`
- 后端提供鉴权端点：
  - `[API] POST /api/auth/login`
  - `[API] GET /api/auth/me`
- 首启动初始化门控端点可用：
  - `[API] GET /api/init/status`

## 3. 主流程（成功路径）

1. 用户访问受保护页面（例如 `/admin/*`、`/store/*` 等）
2. `ProtectedRoute` 检测未登录，重定向到 `/login`，并携带 `state.from = <原路径+query>`
3. `/login` 页面根据 `from` 显示不同上下文标题（服主控制台/玩家门户等）
4. 用户提交邮箱+密码
5. 前端调用 `[API] POST /api/auth/login` 获取 `{ token, user }` 并写入存储
6. 登录页 `navigate('/', { replace: true })`
7. `RootRedirect` 根据 `user.role` 分流：
   - `server_admin` → `/admin`
   - `instance_admin` → `/store`
   - `user` → `/guild`

## 4. 失败与回退路径

- 字段校验失败：阻止提交，在字段下显示错误（如“密码至少 8 位”）；邮箱格式问题可能触发浏览器原生校验提示
- 账号密码错误：显示“邮箱或密码不正确”
- `GET /api/init/status` 返回 `needs_init=true`：在 `/login` 加载阶段跳转 `/setup`
- 会话失效 / 401：
  - API client 触发 `onUnauthorized`：清理 token 与缓存 user
  - 自动跳转回 `/login` 并携带来源路径用于回跳与上下文展示
- 503 且错误码为 `MAINTENANCE_MODE`：强制跳转 `/maintenance`

## 5. 关键接口（[API]）

- `GET /api/init/status`（匿名）：初始化门控
- `POST /api/auth/login`（匿名）：获取 JWT 与 user
- `GET /api/auth/me`（鉴权）：恢复会话与刷新用户信息（token 存在时自动执行）
## 6. 关键页面引用

- 登录页：[pages/login.md](../pages/login.md)

## 7. 风险与待办


- [RISK] 若生产环境长期开放“演示账号一键登录”，需要评估数据隔离与权限隔离策略
- [TODO] 增补“登出”行为梳理：从各基座登出后如何传递 `from`，以及返回按钮的预期落点
