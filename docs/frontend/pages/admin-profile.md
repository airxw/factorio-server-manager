# 个人设置（admin 基座内）

## 1. 页面定位
> 用户在 admin 基座内查看账户信息、编辑资料、修改密码、管理实例绑定、查看钱包余额与领取每日点券的页面（v4.14.2 起挂载到 `/admin`，避免跨基座跳转）。该组件跨基座共享，同时挂在 `/admin/profile`、`/store/profile`、`/guild/profile`。

## 2. 入口与路由
- `[ROUTE]` 路由路径：`/admin/profile`
- 浏览器入口（公网）：`https://gsp.ecsrz.com:3001/admin/profile`
- 浏览器入口（局域网）：`https://192.168.5.14:3001/admin/profile`
- 进入方式：登录后从 `/admin` 侧边栏「个人设置」入口进入；或从其他 admin 子页面点击用户头像下拉；或直接输入 URL。
- 退出方式：点击侧边栏其他菜单；浏览器返回；点击退出登录。
- 跨基座共享：同一组件 `Profile.tsx` 同时挂在 `/admin/profile` / `/store/profile` / `/guild/profile`，通过 `useBasePath()` hook 动态计算路径前缀（`/admin` / `/store` / `/guild`）。

## 3. 角色与权限
- 允许角色：`server_admin` / `system_admin` / `admin`（在 `/admin` 基座下由 `RequireRole` 门控）
- 守卫组件：
  - 路由级：`RequireRole allow={['server_admin', 'system_admin', 'admin']}`（`/admin` 基座 + 系统管理子路由双层套用）
  - 组件级：**无 `isAdminRole` 守卫**（组件本身不限制角色，由挂载基座决定可见性）
- 未登录行为：被 `RequireRole` 上游的 `RequireAuth` 拦截，重定向到 `/login?redirect=/admin/profile`
- 越权行为：路由级 401/403 由后端 `authenticateToken` 中间件拒绝（bindings / wallet 等接口仅需 JWT，不强制 requireAdmin）
- Demo 账号限制：
  - `admin@local.dev` / `manager@local.dev` / `user@local.dev` 三个 Demo 邮箱禁用改密（`isPasswordChangeDisabled`）
  - `admin@local.dev` 禁用编辑 display_name（`isDemo`）

## 4. 核心功能点
- **账户信息卡**：用户名 / 邮箱 / 邮箱验证状态（已验证绿 / 未验证红 + 重发按钮 / 未知灰）/ 角色 badge；「编辑资料」「查看我的资产」按钮（跳转 `${basePath}/me`）。
- **编辑资料**：内联表单——display_name（留空则使用用户名）；Demo 账号 disabled；保存后调用 `refreshUser()` 同步全局 user。
- **修改密码**（v3.4.0）：
  - 当前密码 + 新密码 + 确认新密码三字段
  - 前端校验：长度 ≥ 6 / 两次一致 / 新旧不同
  - 后端校验：zxcvbn 强度 ≥ 3 / 不与最近 5 次历史重复 / `token_version + 1` 使旧 JWT 失效
  - 错误码映射：INVALID_CREDENTIAL / AUTH_PWD_002 / AUTH_PWD_003 / BUILT_IN_ACCOUNT_PASSWORD_READONLY
- **我的实例绑定**：表格展示已绑定实例（实例名 / VIP 等级 / 绑定时间 / 解绑按钮）；解绑前 `window.confirm` 二次确认。
- **可绑定实例**：表格展示所有实例（实例名 / 游戏 / 状态 / 绑定状态 / 绑定/解绑按钮）；不要求 running 状态。
- **我的钱包**（经济系统）：按已绑定实例展示点券余额 / 累计获得 / 累计消费 / 今日可领 / 领取按钮；`can_claim_daily` 为 false 时按钮显示「今日已领取」并 disabled。
- **邮箱验证**（v3.9.0-S5）：best-effort 加载 `getEmailVerifyStatus()`，后端未实现时静默忽略；未验证时显示「重发验证邮件」按钮。

## 5. 交互流程
1. 页面挂载 → `useEffect` 触发 `refresh()`：
   - `Promise.all` 并行加载 `listMyBindings()` + `listServers()`
   - 加载完成后，对每个 active binding 并行查询 `getWallet(serverId)`（失败不阻塞主流程）
2. 同时 `useEffect` best-effort 加载 `getEmailVerifyStatus()`（失败静默）。
3. 用户点击「编辑资料」→ `openEditProfile()` 调用 `getUser(user.id)` 加载当前 display_name → 显示表单。
4. 用户点击「修改密码」→ 显示密码表单 → 填写后前端校验 → `changePassword()` → 成功提示「旧登录已失效，请重新登录」。
5. 用户点击「绑定」→ `bindInstance(serverId)` → 成功后 `refresh()` → 409 ALREADY_BOUND 时 toast「已绑定该实例」。
6. 用户点击「解绑」→ `window.confirm` → `unbindInstance(serverId)` → 成功后 `refresh()`。
7. 用户点击「领取每日点券」→ `claimDailyReward(serverId)` → 成功后局部更新 wallets + toast。
8. 用户点击「重发验证邮件」→ `requestEmailVerify()` → 成功 toast / 已验证 toast / 未知 toast。
9. 任意错误 → setError / setNotice / toast；按钮 disabled 防重复提交（`actioningId` / `claimingId` / `savingProfile` / `savingPassword` / `resendingVerify`）。

## 6. 接口与数据
| `[API]` 接口 | 方法 | 鉴权 | 用途 | 错误码 |
|------|------|------|------|------|
| `/api/profile/bindings` | GET | JWT | 用户查看自己的绑定列表，返回 `{ bindings: BindingRecord[] }`（snake_case，前端 `snakeToCamel` 转换） | 401 PANEL_UNAUTHORIZED |
| `/api/servers` | GET | JWT | 列出所有实例（用于「可绑定实例」表格），返回 `{ servers: ServerSummary[] }` | 401 |
| `/api/servers/:id/wallet` | GET | JWT | 查询钱包余额（balance/total_earned/total_spent/daily_reward_amount/can_claim_daily） | 401 / 404 WALLET_NOT_FOUND |
| `/api/servers/:id/wallet/claim-daily` | POST | JWT | 领取每日点券，返回 `{ wallet, claimed_amount }` | 409 WALLET_ALREADY_CLAIMED / 404 WALLET_NOT_FOUND |
| `/api/instances/:serverId/bindings` | POST | JWT | 用户绑定实例（自动 VIP1） | 409 ALREADY_BOUND（前端转换为 PanelApiError） |
| `/api/instances/:serverId/bindings` | DELETE | JWT | 用户解绑实例 | 404 BINDING_NOT_FOUND |
| `/api/auth/email-verify/status` | GET | JWT | 返回当前登录用户的 `email_verified` 状态 | 401 / 501（未实现，前端静默忽略） |
| `/api/auth/email-verify/request` | POST | JWT | 重发验证邮件（限流 3 次/小时/用户），返回 `{ sent, reason? }` | 429 EMAIL_VERIFY_RATE_LIMITED |
| `/api/auth/change-password` | POST | JWT | 修改密码，返回 `{ tokenVersion }` | 401 INVALID_CREDENTIAL / 400 AUTH_PWD_002 / 409 AUTH_PWD_003 / 403 BUILT_IN_ACCOUNT_PASSWORD_READONLY |
| `/api/users/:id` | GET | JWT + requireAdmin | 查询单个用户详情（编辑资料时加载 display_name） | 401 / 403 / 404 USER_NOT_FOUND |
| `/api/users/:id` | PATCH | JWT + requireAdmin | 更新用户（display_name），返回 `{ user: UpdateUserResponse }` | 401 / 403 / 404 |

> 后端挂载点：
> - `routes-registry.ts#L906` `app.use('/api', authenticateToken(JWT_SECRET), createBindingsRouter())`（含 `/profile/bindings` + `/instances/:serverId/bindings`）
> - `routes-registry.ts#L899` `app.use('/api/auth', authenticateToken(JWT_SECRET), createPasswordChangeRouter())`（change-password）
> - `routes-registry.ts#L898` `app.use('/api/auth/email-verify', createEmailVerifyPublicRouter(...))`（status / request 公开但需 JWT）
> - `routes-registry.ts#L828` `/api/servers` 钱包路由（authenticateToken）
> - `routes-registry.ts#L884` `/api/users`（JWT + requireAdmin）

## 7. 状态管理与副作用
- Context / Store：`useAuth()`（提供 `api`、`user`、`refreshUser`）、`useToast()`、`useNavigate()`、`useLocation()`（用于 `useBasePath`）
- Local state：
  - `[STATE]` `bindings` / `servers` / `loading` / `error` / `notice`：列表加载五态
  - `[STATE]` `actioningId`：绑定/解绑按钮 busy 标记（按 serverId）
  - `[STATE]` `wallets`（Record<serverId, WalletInfo>） / `claimingId` / `walletNotice`：钱包数据 + 领取 busy
  - `[STATE]` `showEditProfile` / `editDisplayName` / `savingProfile`：编辑资料表单
  - `[STATE]` `emailVerified` / `resendingVerify`：邮箱验证状态
  - `[STATE]` `showChangePassword` / `oldPassword` / `newPassword` / `confirmPassword` / `savingPassword`：改密表单
- 派生数据（`useMemo`）：
  - `serverMap`：serverId → ServerSummary 映射，用于在绑定列表中显示实例名
  - `boundServerIds`：当前已绑定 serverId 集合
  - `activeBindings`：仅展示 `unboundAt` 为空的绑定
  - `bindableServers`：所有实例均可绑定（不要求 running）
- 副作用：
  - `useEffect[refresh]`：首屏加载 bindings + servers + wallets
  - `useEffect[emailVerify]`：best-effort 加载邮箱验证状态，含 `cancelled` 标志防内存泄漏
- 工具函数：`instanceStatusLabel` / `instanceStatusBadgeClass` / `roleLabel` / `roleBadgeClass` / `formatDate` / `useBasePath`。

## 8. 错误与边界
| `[EDGE]` 边界 | UI 反馈 | 备注 |
|------|------|------|
| 钱包查询失败 | 静默忽略（`catch → null`） | 不阻塞主流程，钱包列显示 `-` |
| 邮箱验证状态接口未实现 | 静默忽略 | `emailVerified` 保持 `null`，显示「未知」badge |
| 绑定时 409 ALREADY_BOUND | toast「已绑定该实例」 | `PanelApiError.code === 'ALREADY_BOUND'` |
| 改密旧密码错误 | toast「旧密码错误」 | `INVALID_CREDENTIAL` |
| 改密强度不足 | toast「新密码强度不足，请使用更复杂的密码」 | `AUTH_PWD_002`（zxcvbn < 3） |
| 改密与历史重复 | toast「新密码与近期使用过的密码重复，请更换」 | `AUTH_PWD_003` |
| Demo 账号改密 | 表单不渲染，显示提示文字 | `isPasswordChangeDisabled` |
| Demo 账号编辑资料 | input disabled + 提示 | `isDemo` |
| 新密码 < 6 位 | setError「新密码至少 6 位」 | 前端校验 |
| 两次新密码不一致 | setError「两次输入的新密码不一致」 | 前端校验 |
| 新旧密码相同 | setError「新密码不能与旧密码相同」 | 前端校验 |
| 解绑前 confirm | `window.confirm` 二次确认 | 浏览器原生弹窗 |
| 今日已领取点券 | 按钮 disabled + 显示「今日已领取」 | `!wallet?.can_claim_daily` |
| 邮箱已验证时点重发 | toast.info「邮箱已验证，无需重发」 + 局部 setEmailVerified(true) | `res.reason === 'already_verified'` |
| 列表为空 | EmptyState 组件 | `activeBindings.length === 0` |
| 网络错误 | setError + toast.error | 通用兜底 |

## 9. 体验与一致性检查
- `[UX]` 设计语言：使用 `info-card` / `card-title` / `info-row` / `data-table` / `badge` 等通用 CSS 类（与 guild / store 系列页面同款）；不使用 lucide-react 图标（与 admin 子页面风格略有差异）；符合「苹果清新设计、非电竞风」要求。
- `[UX]` 移动端适配：表格使用 `table-wrap` 容器（可横向滚动）；info-card 卡片竖排堆叠；按钮使用 `btn-sm` 紧凑模式。
- `[UX]` 跨基座一致性：通过 `useBasePath()` 动态计算路径前缀，「查看我的资产」按钮在 admin 下跳 `/admin/me`，在 store 下跳 `/store/me`，在 guild 下跳 `/guild/me`——避免跨基座跳转破坏上下文。
- `[UX]` 一致性瑕疵：v4.17.0 注释提到「游戏内绑定验证码入口已移除——pending 验证码统一在 /guild 首页卡片内展示」，但 admin / store 基座下无对应入口；用户在 admin 下若需查看 pending 验证码需手动切换到 `/guild`。
- `[UX]` 改密成功提示「旧登录已失效，请重新登录」但**不强制跳转 `/login`**——用户需手动退出后重新登录；可考虑 `setTimeout` 自动跳转。
- `[UX]` Demo 账号限制使用 `email` 硬编码列表（`DEMO_EMAILS`），若后续增加新 Demo 账号需同步修改代码。

## 10. 关键实现定位（代码引用）
- 路由入口：[App.tsx#L405-L408](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/App.tsx#L405-L408)（v4.14.2 个人设置挂载到 admin 基座）
- 页面组件：[Profile.tsx](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/Profile.tsx)
- 关键 hook：[useAuth](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/api/auth.ts) / [useToast](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/components/ui/index.ts) / [useBasePath](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/Profile.tsx#L18-L23)
- API client：
  - [client.ts#L1245-L1265](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/api/client.ts#L1245-L1265)（bindings 4 个方法，含 `snakeToCamel`）
  - [client.ts#L746-L754](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/api/client.ts#L746-L754)（wallet 2 个方法）
  - [client.ts#L509-L514](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/api/client.ts#L509-L514)（changePassword）
  - [client.ts#L529-L535](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/api/client.ts#L529-L535)（email verify 2 个方法）
  - [client.ts#L613-L630](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/api/client.ts#L613-L630)（getUser / updateUser）
- 后端路由：
  - [api/routes/bindings.ts](file:///home/airxw/Documents/gsp/gameserver-panel/panel/backend/src/api/routes/bindings.ts)（profile/bindings + instances/:id/bindings）
  - [api/routes/emailVerify.ts](file:///home/airxw/Documents/gsp/gameserver-panel/panel/backend/src/api/routes/emailVerify.ts)
  - [api/routes/users.ts](file:///home/airxw/Documents/gsp/gameserver-panel/panel/backend/src/api/routes/users.ts)
- 后端挂载：[routes-registry.ts#L906](file:///home/airxw/Documents/gsp/gameserver-panel/panel/backend/src/routes-registry.ts#L906)（bindings）/ [routes-registry.ts#L899](file:///home/airxw/Documents/gsp/gameserver-panel/panel/backend/src/routes-registry.ts#L899)（change-password）
- 类型定义：`MyBinding` 来自 [api/client.ts](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/api/client.ts)；`ServerSummary` / `WalletInfo` 来自 `@public/schema/panel-api-types`

## 11. 待办与风险
- `[TODO]` 改密成功后不强制跳转 `/login`，用户可能继续使用旧 JWT 操作其他页面（实际后端已使旧 JWT 失效，下次请求会 401）；建议 `setTimeout(1500ms)` 后 `navigate('/login')`。
- `[TODO]` 钱包查询失败静默忽略，用户无法察觉；可考虑在钱包列显示「加载失败」badge + 重试按钮。
- `[TODO]` 「可绑定实例」表格无搜索 / 过滤，实例多时体验差；可参考 `/admin/servers` 的过滤能力。
- `[TODO]` v4.17.0 移除了 pending 验证码入口，但 admin / store 基座下无替代入口；若用户主要在 admin 工作，需手动切换到 `/guild` 查看。
- `[RISK]` **改密后旧 JWT 立即失效**（`token_version + 1`），但页面不强制跳转——用户继续操作会触发 401，体验割裂；且若用户在多个 Tab 登录，其他 Tab 不会自动退出。
- `[RISK]` Demo 账号判定使用 `email` 硬编码列表（`admin@local.dev` / `manager@local.dev` / `user@local.dev`），若生产环境误用这些邮箱，会意外禁用改密；建议改为后端 `user.is_demo` 字段或 `user.metadata.built_in` 标记。
- `[RISK]` 绑定实例无限制（任何 active 用户可绑定任何实例），VIP 等级自动 VIP1；若实例有敏感数据，需后端在 `/instances/:id/bindings` 增加实例级准入控制（如白名单 / 邀请码）。
- `[RISK]` `window.confirm` 解绑确认使用浏览器原生弹窗，UI 不统一且移动端体验差；建议改为 Modal 二次确认（与 SSL / API Keys 一致）。
- `[RISK]` `bindInstance` 在 client 层捕获 409 并转换为 `PanelApiError('ALREADY_BOUND', ...)`，但其他 4xx 错误（如 403 实例禁用绑定）未做映射，直接抛出原始错误，前端 `setError` 显示英文 code。

## 梳理元数据
- 梳理日期：2026-07-26
- 梳理方式：代码阅读（组件 / API client / 后端路由 / 路由注册表）
- 跨基座备注：本页重点分析 admin 上下文；组件本身在 store / guild 基座下行为一致，仅 `basePath` 不同。
