# 登录页（/login）

- [ROUTE] `/login`（入口：`https://gsp.ecsrz.com:3001/login`）
- 状态：已完成（2026-07-28 智能直达改造）
- BUILD：`20260725-013`

## 1. 页面定位

登录页是 Panel 前端的公开入口页，负责：

- 提供邮箱或用户名 + 密码登录（获取 JWT 并建立前端会话）
- 承接“未登录访问受保护路由”的回跳入口（携带 `from` 供智能直达跳深链）
- 作为首启动初始化（`/setup`）的门控入口：未初始化时自动跳转至初始化向导

## 2. 入口与路由

- [ROUTE] 路由注册：`/login` 在前端路由表中是公开路由
- `from` 来源参数优先级：`?from=`（URL） > `location.state.from`（路由 state） > 默认 `/`
- 访问者若已登录：直接跳转到 `/`（再由根路由分流）

## 3. 角色与权限

- 访问权限：公开（未登录可访问）
- 已登录用户访问 `/login`：自动跳转到 `/`
- 登录成功后的跳转（Login 端智能直达，方案 §5.3 L1/L2）：
  - `server_admin` / `system_admin` / `admin` → 直跳 `/admin`
  - 单身份非 admin → `activateIdentity` 后跳 `from` 深链（若匹配基座）或角色默认基座（腐竹→`/store`，玩家→`/guild`）
  - 多身份/无身份 → `/select-identity?from=...`，由选择页选完后落地
  - 预检失败 → 降级跳 `/select-identity`

## 4. 核心功能点

- 邮箱或用户名输入（`type="text"`，自定义校验 `validateLoginIdentifier`，支持邮箱或用户名）
- 密码输入（自定义校验：至少 8 位，且必须包含字母与数字）
- 忘记密码入口：跳转 `/forgot-password`
- 注册入口：跳转 `/register`（携带 `state.from = ctx.path`）
- 法律内容入口：`/terms`、`/privacy`
- 演示账号一键登录（仅开发环境 `import.meta.env.DEV` 显示，生产已关闭）

## 5. 交互流程

**初始化门控**

- 页面加载后调用 `[API] GET /api/init/status`
- 若返回 `needs_init=true`：跳转 `/setup`
- 例外：当 `VITE_ENABLE_DEMO === 'true'` 时跳过 init status 检查

**登录（成功路径）**

1. 输入邮箱/用户名与密码
2. 点击“登录”
3. 前端执行字段校验
4. 调用 `[API] POST /api/auth/login` 获取 `{ token, user, password_expired? }`
5. 前端写入 `localStorage(panel_token)` + `sessionStorage(panel_user_cache)` 并更新 Auth Context
6. 调用 `getLoginRedirectPath(user)` 智能直达：
   - admin 角色 → `/admin`
   - 调 `listIdentities` 预检：单身份 → `activateIdentity` 后跳 `from` 深链或基座；多身份/无身份 → `/select-identity?from=...`
   - 预检失败 → 降级 `/select-identity`
7. `navigate(target, { replace: true })`

**登录（失败路径）**

- 字段校验失败：在对应字段下展示校验错误（如“密码至少 8 位”）
- 账号密码错误：Toast + 页面错误区展示“邮箱或密码不正确”
- 其他 API 错误：优先使用 `PanelApiError.message`，否则回退到 `err.message` 或“登录失败”

## 6. 接口与数据

- [API] `GET /api/init/status`（匿名）→ `{ needs_init: boolean }`
- [API] `POST /api/auth/login`（匿名）→ `LoginResponse`（含 `token`、`user`，可能含 `password_expired`）
- [API] `GET /api/auth/me`（鉴权）→ `MeResponse`
  - AuthProvider 在 token 存在时会拉取 `me()` 保持 user 状态；401 统一触发登出并跳转登录页

## 7. 状态管理与副作用

- 本地状态
  - `email` / `password`
  - `fieldErrors`：字段级错误
  - `error`：表单级错误
  - `submitting`：提交中状态（LoadingButton）
  - `initChecking`：初始化检查中的 loading
- 全局状态：`useAuth()` 提供 `user/token/login/logout`
- 副作用
  - `useEffect`：初始化检查 `getInitStatus()`，必要时重定向 `/setup`
  - `useDocumentTitle('登录')`：固定标题（未读 from，方案 §3.1 漂移点已记录）

## 8. 错误与边界

- [EDGE] 邮箱/用户名字段使用 `type="text"` + 自定义校验 `validateLoginIdentifier`，不触发浏览器原生 email 校验气泡
- [EDGE] 密码字段自定义校验，常见提示：
  - “密码至少 8 位”
  - “密码必须包含字母”
  - “密码必须包含数字”
- [EDGE] 已登录用户访问 `/login` 会被强制跳走，若要调试登录页需要先登出或使用无痕会话
- [EDGE] `GET /api/init/status` 网络失败：当前实现会结束 `initChecking`（允许继续显示登录页）
- [EDGE] 后端 503 且错误码为 `MAINTENANCE_MODE`：API client 会强制跳转到 `/maintenance`

## 9. 体验与一致性检查

- [UX] 页面底部规范化 footer span 展示 BUILD ID（便于部署核对）：`© YYYY GSP · Game Server Panel · BUILD YYYYMMDD-XXX`（类名 `app-footer-build`）
- [UX] 提供“忘记密码 / 注册 / 协议 / 隐私”入口，信息架构完整
- [RISK] 演示账号入口仅开发环境（`import.meta.env.DEV`）显示，生产已关闭（方案 §3.1 决策落地）

## 10. 关键实现定位（代码引用）

- 路由注册 `/login`：[App.tsx:L281-L315](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/App.tsx#L281-L315)
- 未登录重定向到 `/login`（携带 `state.from`）：[ProtectedRoute](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/App.tsx#L127-L145)
- 根路由角色分流（登录后实际落点）：[RootRedirect](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/App.tsx#L147-L170)
- 登录页主体逻辑（from 解析、init status、提交/错误处理）：[Login.tsx](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/Login.tsx#L40-L367)
- Auth Context（token 存储、401 统一回登录、login() 实现）：[auth.tsx](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/api/auth.tsx#L35-L203)
- API 客户端（`POST /auth/login`、`GET /init/status`）：[client.ts](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/api/client.ts#L418-L437) / [client.ts:L1802-L1805](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/api/client.ts#L1802-L1805)
- 字段校验规则（邮箱/密码）：[formValidation.ts](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/utils/formValidation.ts#L25-L49)
- BUILD 常量来源：[buildInfo.ts](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/buildInfo.ts#L1)

## 11. 待办与风险

- [DONE] 演示账号入口策略：生产环境已关闭（`showDemoEntry = import.meta.env.DEV`），仅开发环境显示（方案 §3.1 决策落地）
- [TODO] “返回”按钮当前固定跳 `/`（根路由），未读 from；若需回到来源页，后续可改为 `navigate(fromPath || '/')`
- [TODO] 智能直达的 `listIdentities` 预检若后端未实现 identity 接口，会降级到 `/select-identity`；待 identity API 稳定后可移除降级分支
