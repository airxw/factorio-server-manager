# 游戏内绑定验证码（admin 基座内）

## 1. 页面定位
> 用户在 admin 基座内申请「游戏内绑定验证码」的页面——选择服务器 + 填写游戏内玩家名 → 生成 5 分钟有效期的验证码，用户在游戏控制台输入 `!verify <code>` 完成账号与游戏玩家身份绑定。该组件跨基座共享，同时挂在 `/admin/profile/verify`、`/store/profile/verify`、`/guild/profile/verify`。

## 2. 入口与路由
- `[ROUTE]` 路由路径：`/admin/profile/verify`
- 浏览器入口（公网）：`https://gsp.ecsrz.com:3001/admin/profile/verify`
- 浏览器入口（局域网）：`https://192.168.5.14:3001/admin/profile/verify`
- 进入方式：登录后从 `/admin` 侧边栏或个人设置相关入口进入；或直接输入 URL。
- 退出方式：点击侧边栏其他菜单；浏览器返回；点击退出登录。
- 跨基座共享：同一组件 `PlayerVerify.tsx` 同时挂在三个基座下，行为一致。

## 3. 角色与权限
- 允许角色：`server_admin` / `system_admin` / `admin`（在 `/admin` 基座下由 `RequireRole` 门控）
- 守卫组件：
  - 路由级：`RequireRole allow={['server_admin', 'system_admin', 'admin']}`（`/admin` 基座 + 系统管理子路由双层套用）
  - 组件级：**无 `isAdminRole` 守卫**（组件本身不限制角色，任何已登录用户均可使用）
- 未登录行为：被 `RequireRole` 上游的 `RequireAuth` 拦截，重定向到 `/login?redirect=/admin/profile/verify`
- 越权行为：路由级 401/403 由后端 `authenticateToken` 中间件拒绝；接口仅需 JWT，不强制 requireAdmin
- 备注：在 `/guild` 基座下普通 `user` 角色也可访问（无 `RequireRole` 门控）；admin 基座下仅管理员可见

## 4. 核心功能点
- **申请新验证码**：服务器选择下拉（自动选中第一个）+ 游戏内玩家名输入（maxLength 64）+ 生成按钮（disabled 当 serverId 或 gamePlayerName 为空）。
- **验证码展示卡片**（生成后）：高亮卡片展示验证码（`verify-code-display` 大字体）+ 服务器 + 玩家名 + 过期时间（绝对时间 + 剩余分秒倒计时）+ 使用方法提示（`!verify <code>` 命令）。
- **我的有效验证码列表**：表格展示当前用户未使用且未过期的验证码（验证码 / 服务器 / 玩家名 / 过期时间 / 状态 badge：有效绿 / 已使用黄 / 已过期灰）。
- **倒计时计算**：`formatExpiry(expiresAt)` 计算 `exp - now` 的剩余分秒；`now` 通过 `useEffect` 设置，避免 render 中调用 impure 的 `Date.now()`。

## 5. 交互流程
1. 页面挂载 → 两个 `useEffect` 并行：
   - 加载服务器列表：`api.listServers()` → 设置 servers + 默认选中第一个；失败 setError。
   - 加载我的验证码：`api.listMyVerifyCodes()` → 设置 myCodes；失败静默（`setMyCodes([])`）。
2. 用户选择服务器 + 填写玩家名 → 点击「生成验证码」→ 前端校验非空 → `api.createVerifyCode({ server_id, game_player_name })` → 设置 generated + setNotice + 刷新 myCodes。
3. 用户在游戏内输入 `!verify <code>` → 游戏服务端调用后端确认接口（不在本页范围内）→ 验证码标记 `used_at`。
4. 用户点击「刷新」→ 重新 `refreshCodes()`。
5. 5 分钟后验证码自动过期，列表中 badge 变为「已过期」。
6. 任意错误 → setError 渲染顶部 alert；按钮 disabled 防重复提交（`generating` / `loading`）。

## 6. 接口与数据
| `[API]` 接口 | 方法 | 鉴权 | 用途 | 错误码 |
|------|------|------|------|------|
| `/api/servers` | GET | JWT | 列出所有服务器（用于下拉选择），返回 `{ servers: ServerSummary[] }` | 401 PANEL_UNAUTHORIZED |
| `/api/verify-codes` | POST | JWT | 生成验证码，body `{ server_id, game_player_name }`；返回 `{ code: VerifyCodeSummary }`（code 含 5 位字符串 + expires_at） | 400 VERIFY_CODE_SERVER_REQUIRED / 400 VERIFY_CODE_NAME_REQUIRED / 409 VERIFY_CODE_ACTIVE_EXISTS（同一服务器+玩家名已有有效码） |
| `/api/verify-codes/mine` | GET | JWT | 查询当前用户未使用且未过期的验证码，返回 `{ codes: VerifyCodeSummary[] }` | 401 |

> 后端挂载点：`routes-registry.ts#L907` `app.use('/api/verify-codes', authenticateToken(JWT_SECRET), createVerifyCodesRouter())`。
> 审计分类：`middleware/audit.ts#L56` `path.startsWith('/api/verify-codes') → 'verify_code'`（所有 verify-codes 操作记入审计日志）。

## 7. 状态管理与副作用
- Context / Store：`useAuth()`（提供 `api`）
- Local state：
  - `[STATE]` `servers` / `serverId` / `gamePlayerName` / `serversLoading`：服务器选择四态
  - `[STATE]` `generated`（VerifyCodeSummary | null）：生成的验证码卡片数据
  - `[STATE]` `myCodes`（VerifyCodeSummary[]） / `loading`：我的验证码列表
  - `[STATE]` `generating`：生成按钮 busy
  - `[STATE]` `error` / `notice`：错误 + 成功提示
  - `[STATE]` `now`（number | null）：当前时间戳，通过 `useEffect` 设置避免 render 中调用 `Date.now()`
- 副作用：
  - `useEffect[listServers]`：首屏加载服务器列表，含 `cancelled` 标志防内存泄漏
  - `useEffect[refreshCodes]`：首屏加载我的验证码
- 类型来源：`CreateVerifyCodeResponse` / `ListMyVerifyCodesResponse` / `ServerSummary` / `VerifyCodeSummary` 来自 `@public/schema/panel-api-types`（公共契约）。

## 8. 错误与边界
| `[EDGE]` 边界 | UI 反馈 | 备注 |
|------|------|------|
| 服务器列表加载失败 | setError「加载服务器列表失败」 | `serversLoading` 控制 select disabled |
| 服务器列表为空 | 下拉显示「暂无服务器」option | `servers.length === 0` |
| 未选服务器 | 生成按钮 disabled | `!serverId` |
| 玩家名为空 | 生成按钮 disabled | `!gamePlayerName.trim()` |
| 玩家名超长 | input maxLength=64 | 浏览器原生限制 |
| 我的验证码加载失败 | 静默 `setMyCodes([])` | `void err` 忽略错误 |
| 验证码生成失败 | setError + 顶部 alert-error | PanelApiError 优先 |
| 验证码生成成功 | setNotice「验证码已生成，请在 5 分钟内于游戏内使用」 + 高亮卡片 | 同时刷新 myCodes |
| 验证码已过期 | 列表 badge 灰色「已过期」 | `now !== null && expires_at < now` |
| 验证码已使用 | 列表 badge 黄色「已使用」 | `c.used_at` 非空 |
| 验证码列表为空 | 「暂无有效验证码。」空态 | `myCodes.length === 0` |
| 网络错误 | setError + 顶部 alert | 通用兜底 |

## 9. 体验与一致性检查
- `[UX]` 设计语言：使用 `page` / `page-header` / `info-card` / `card-highlight` / `form-row` / `form-field` / `data-table` 等通用 CSS 类；不使用 lucide-react 图标（与 admin 子页面风格略有差异）；`verify-code-display` 大字体展示验证码便于复制；符合「苹果清新设计、非电竞风」要求。
- `[UX]` 移动端适配：`form-row` 双列表单在窄屏下自动堆叠；表格使用 `table-wrap` 容器；验证码卡片 `verify-code-usage` 等宽字体便于阅读。
- `[UX]` 跨基座一致性：组件本身无 `basePath` 依赖（无内部跳转），三个基座下行为完全一致。
- `[UX]` 一致性瑕疵：
  - 倒计时仅计算一次（`now` 在 `useEffect` 中设置一次后不再更新），用户停留页面超过 1 分钟后看到的「剩余分秒」会过期；建议增加 `setInterval` 每秒更新。
  - 验证码列表无手动刷新按钮（仅顶部「刷新」按钮，但该按钮实际调用 `refreshCodes`，刷新的是列表而非验证码卡片状态）。
  - 验证码生成成功后无「复制」按钮，用户需手动选中 `verify-code-display` 文本复制；可参考 ApiKeys 的 `navigator.clipboard.writeText`。
- `[UX]` 与其他页面一致性：与 Profile 共用 `info-card` / `data-table` 样式；与 guild-bind 页面互补（guild-bind 处理 pending 验证码展示，本页处理生成）。

## 10. 关键实现定位（代码引用）
- 路由入口：[App.tsx#L405-L408](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/App.tsx#L405-L408)（v4.14.2 挂载到 admin 基座）
- 页面组件：[PlayerVerify.tsx](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/PlayerVerify.tsx)
- 关键 hook：[useAuth](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/api/auth.ts)
- API client：
  - [client.ts#L1191-L1199](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/api/client.ts#L1191-L1199)（createVerifyCode + listMyVerifyCodes）
  - [client.ts#L613-L615](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/api/client.ts#L613-L615)（listServers 复用）
- 后端路由：[api/routes/verifyCodes.ts](file:///home/airxw/Documents/gsp/gameserver-panel/panel/backend/src/api/routes/verifyCodes.ts)
- 后端挂载：[routes-registry.ts#L907](file:///home/airxw/Documents/gsp/gameserver-panel/panel/backend/src/routes-registry.ts#L907)
- 审计中间件：[middleware/audit.ts#L56](file:///home/airxw/Documents/gsp/gameserver-panel/panel/backend/src/middleware/audit.ts#L56)（verify_code 审计分类）
- 维护模式豁免：[middleware/maintenance.ts](file:///home/airxw/Documents/gsp/gameserver-panel/panel/backend/src/middleware/maintenance.ts)（未列入豁免清单，维护模式下不可用）

## 11. 待办与风险
- `[TODO]` **倒计时不实时更新**——`now` 仅在 `useEffect` 挂载时设置一次，用户停留页面后看到的剩余时间会逐渐失真；建议改为 `setInterval(() => setNow(Date.now()), 1000)` + 卸载时 `clearInterval`。
- `[TODO]` 验证码卡片无「复制」按钮，用户需手动选中文本；可参考 ApiKeys 的 `navigator.clipboard.writeText` + 复制图标按钮。
- `[TODO]` 服务器下拉仅显示 `name (id)`，无搜索 / 过滤；服务器多时体验差。
- `[TODO]` 验证码列表无分页 / 折叠，历史有效码累积时列表会变长（实际后端只返回未过期未使用，长度有限，但仍可优化）。
- `[RISK]` **验证码 5 分钟有效期较短**——用户需在游戏中快速输入；若游戏卡顿或用户离开键盘，验证码会过期需重新生成。可考虑增加「延长有效期」接口（同时需防滥用）。
- `[RISK]` 同一服务器 + 玩家名若已有有效码，后端可能返回 409 VERIFY_CODE_ACTIVE_EXISTS（契约推测）；前端未做专门错误码映射，会显示英文 code，体验差。
- `[RISK]` 验证码生成后无强制绑定确认——用户生成后未在游戏内使用即离开，验证码会一直有效至过期，可能被他人盗用（若泄漏）；建议生成后增加「我已使用」手动标记接口（或后端在游戏内确认后自动失效）。
- `[RISK]` `listMyVerifyCodes` 失败静默忽略（`void err`），用户无法察觉列表加载失败；建议增加 retry 按钮或 toast 提示。
- `[RISK]` 维护模式下本接口未豁免（`middleware/maintenance.ts` 豁免清单仅含 `/api/auth/email-verify`），维护期间用户无法生成验证码——若维护时间较长，已生成验证码可能过期。

## 梳理元数据
- 梳理日期：2026-07-26
- 梳理方式：代码阅读（组件 / API client / 后端路由 / 路由注册表 / 审计中间件）
- 跨基座备注：本页重点分析 admin 上下文；组件本身在 store / guild 基座下行为一致。
