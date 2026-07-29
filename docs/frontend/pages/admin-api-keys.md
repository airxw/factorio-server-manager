# API Keys

## 1. 页面定位
> 系统管理员在 Panel 内管理 API Key 旁路认证的页面——为 CI/CD、自动化脚本等场景签发可撤销的 API Key（通过 `x-api-key` header 鉴权），明文仅创建时一次性显示（v4.4.0-J1，I3 优化项）。

## 2. 入口与路由
- `[ROUTE]` 路由路径：`/admin/api-keys`
- 浏览器入口（公网）：`https://gsp.ecsrz.com:3001/admin/api-keys`
- 浏览器入口（局域网）：`https://192.168.5.14:3001/admin/api-keys`
- 进入方式：登录后从 `/admin` 侧边栏「API Keys」入口进入；或直接输入 URL。
- 退出方式：点击侧边栏其他菜单；浏览器返回；点击退出登录。

## 3. 角色与权限
- 允许角色：`server_admin` / `system_admin` / `admin`（路由级 `RequireRole` + 组件内 `isAdminRole` 双重门控）
- 守卫组件：
  - 路由级：`RequireRole allow={['server_admin', 'system_admin', 'admin']}`（`/admin` 基座 + 系统管理子路由双层套用）
  - 组件级：`isAdminRole(user?.role)` 不通过 → `<Navigate to="/forbidden" replace />`
- 未登录行为：被 `RequireRole` 上游的 `RequireAuth` 拦截，重定向到 `/login?redirect=/admin/api-keys`
- 越权行为：路由级 401/403 由后端 `authenticateToken + requireAdmin` 中间件拒绝；组件级本地校验后跳 `/forbidden`

## 4. 核心功能点
- **API Key 列表**：表格展示 name / key_prefix（前缀 + `…`）/ 关联用户（用户名 + 邮箱）/ 角色 badge / 创建时间 / 过期时间 / 最后使用时间 / 状态 badge（活跃绿 / 已过期黄 / 已撤销红）/ 操作；已撤销行 opacity 0.6；按「活跃优先 + 创建时间倒序」排序。
- **创建 API Key**：Modal 表单——
  - 名称（必填，≤ 100 字符）
  - 关联用户（必选，下拉仅展示 `status === 'active'` 的用户）
  - 关联角色（user / instance_admin；**前端硬阻断 server_admin 创建**——防提权）
  - 过期时间（可选，`datetime-local`，必须未来时间）
- **明文 API Key 一次性显示**：创建成功后弹出 Modal——红色警告「明文仅此一次显示」+ 等宽字体展示完整 key + 复制按钮；点击「我已保存」关闭后永远不可再查看。
- **撤销 API Key**：Modal 二次确认——明确提示「此操作不可逆，使用此 Key 的所有自动化脚本将立即失效」；软删除（标记 `revoked_at`）。
- **关联用户列表**：从 `GET /api/users` 加载，用于创建表单的下拉选项。

## 5. 交互流程
1. 页面挂载 → `useEffect` 触发 `refresh()` → `Promise.all` 并行加载 `listApiKeys()` + `listUsers()`。
2. 用户点击「创建 API Key」→ `openCreateModal()` 初始化表单（user_id 默认当前用户）。
3. 用户填写表单 → 前端校验：name 非空 + user_id 已选 + role ≠ server_admin + expires_at 解析合法 + 未来时间。
4. 点击「创建」→ `POST /api/api-keys` → 成功后弹出明文 Modal + 静默刷新列表。
5. 用户点击复制按钮 → `navigator.clipboard.writeText(plaintextKey)` → toast「已复制到剪贴板」。
6. 用户点击「我已保存」→ 关闭 Modal + 清空 plaintextKey。
7. 用户点击列表行「撤销」→ 弹出确认 Modal → 确认后 `DELETE /api/api-keys/:id` → 刷新列表。
8. 任意错误 → toast.error；按钮 disabled 防重复提交。

## 6. 接口与数据
| `[API]` 接口 | 方法 | 鉴权 | 用途 | 错误码 |
|------|------|------|------|------|
| `/api/api-keys` | GET | JWT + requireAdmin | 列出所有 API Key（不含明文与 hash），返回 `{ api_keys: ApiKeyInfo[] }` | 401 PANEL_UNAUTHORIZED / 403 PANEL_FORBIDDEN |
| `/api/api-keys` | POST | JWT + requireAdmin | 创建 API Key，body `{ name, user_id, role, expires_at? }`；返回 `{ api_key: <明文> }`（仅此一次） | 400 APIKEY_NAME_REQUIRED / 400 APIKEY_USER_NOT_FOUND / 400 APIKEY_ROLE_FORBIDDEN（防提权）/ 400 APIKEY_EXPIRES_INVALID |
| `/api/api-keys/:id` | GET | JWT + requireAdmin | 查询单个 API Key 详情（前端未使用，仅契约保留） | 404 APIKEY_NOT_FOUND |
| `/api/api-keys/:id` | DELETE | JWT + requireAdmin | 撤销 API Key（软删除，标记 `revoked_at`） | 404 APIKEY_NOT_FOUND |
| `/api/users` | GET | JWT + requireAdmin | 列出所有用户（用于创建表单下拉），返回 `{ users: AdminUserSummary[] }` | 401 / 403 |

> 后端挂载点：`routes-registry.ts#L858` `app.use('/api/api-keys', authenticateToken(JWT_SECRET), requireAdmin, createApiKeysRouter())`；`routes-registry.ts#L884` `app.use('/api/users', authenticateToken(JWT_SECRET), requireAdmin, createUsersRouter())`。

## 7. 状态管理与副作用
- Context / Store：`useAuth()`（提供 `api`、`user`）、`useToast()`
- Local state：
  - `[STATE]` `apiKeys` / `users` / `loading` / `error`：列表加载四态
  - `[STATE]` `createOpen` / `createForm`（name / user_id / role / expires_at） / `creating`：创建表单
  - `[STATE]` `plaintextKey` / `copied`：明文 key 一次性显示 Modal + 复制状态
  - `[STATE]` `revokeTarget`（{id, name}） / `revoking`：撤销确认 Modal
- 派生数据：
  - `sortedKeys = useMemo(...)`：已撤销排最后，活跃按创建时间倒序。
- 副作用：仅 `useEffect` 触发首屏 `refresh()`；无定时器 / WS 订阅。
- 类型来源：`ApiKeyInfo` / `AdminUserSummary` / `UserRole` 来自 `@public/schema/panel-api-types`（公共契约）。

## 8. 错误与边界
| `[EDGE]` 边界 | UI 反馈 | 备注 |
|------|------|------|
| name 为空 | toast.warning「请填写 API Key 名称」 | 不发请求 |
| user_id 未选 | toast.warning「请选择关联用户」 | 不发请求 |
| role === server_admin | toast.warning「不允许创建 server_admin 级 API Key（防提权）」 | 前端硬阻断 |
| expires_at 解析失败 | toast.warning「expires_at 必须为有效的日期时间」 | `Number.isNaN(d.getTime())` |
| expires_at ≤ 当前时间 | toast.warning「expires_at 必须为未来时间」 | 不发请求 |
| 创建失败 | toast.error「创建 API Key 失败」+ 错误消息 | Modal 不关闭 |
| 复制到剪贴板失败 | toast.error「复制失败，请手动选择文本复制」 | `navigator.clipboard` 兼容兜底 |
| 撤销失败 | toast.error「撤销失败」 | Modal 不关闭 |
| 列表为空 | 「暂无 API Key——点击创建 API Key 开始」空态 | `apiKeys.length === 0` |
| 已撤销 Key 行 | opacity 0.6 + 不显示撤销按钮 | `isRevoked` 判定 |
| 已过期 Key 状态 badge | 黄色「已过期」 | `expires_at ≤ Date.now()` |
| `isAdminRole` 不通过 | `<Navigate to="/forbidden" replace />` | 组件级守卫 |

## 9. 体验与一致性检查
- `[UX]` 设计语言：使用 lucide-react 图标（KeyRound / Plus / RefreshCw / Copy / Check / Trash2 / AlertTriangle）；section 卡片 + page-header + 表格模式；与 SSL / Tunnel 同属 I1-I4 优化项，共用样式风格；符合「苹果清新设计、非电竞风」要求。
- `[UX]` 移动端适配：列表使用 `table-wrap` 容器（可横向滚动）；创建 Modal 字段竖排；明文 key 卡片 `wordBreak: break-all` 防溢出。
- `[UX]` 与其他页面一致性：与 `/admin/ssl`、`/admin/tunnel` 同款 `sectionStyle` / `inputStyle` / `useToast` / `Modal`；按钮使用统一的 `btn-primary` / `btn-danger` / `btn-ghost` 类。
- `[UX]` 优秀实践：明文 key 一次性显示 + 复制按钮 + 强警告，符合业界 OAuth/API Key 签发体验；前端阻断 server_admin 防提权。
- `[UX]` 一致性瑕疵：列表表头 9 列在窄屏下需横向滚动，可考虑响应式隐藏部分列（如「最后使用」）。

## 10. 关键实现定位（代码引用）
- 路由入口：[App.tsx#L371-L416](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/App.tsx#L371-L416)
- 页面组件：[ApiKeys.tsx](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/admin/ApiKeys.tsx)
- 关键 hook：[useAuth](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/api/auth.ts) / [useToast](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/components/ui/index.ts)
- API client：[client.ts#L1273-L1293](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/api/client.ts#L1273-L1293)（API Key 4 个方法）+ [client.ts#L613-L615](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/api/client.ts#L613-L615)（listUsers）
- 类型定义：[api/modules/admin.ts#L236-L242](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/api/modules/admin.ts#L236-L242)
- 后端路由：[api/routes/apiKeys.ts](file:///home/airxw/Documents/gsp/gameserver-panel/panel/backend/src/api/routes/apiKeys.ts)
- 后端挂载：[routes-registry.ts#L858](file:///home/airxw/Documents/gsp/gameserver-panel/panel/backend/src/routes-registry.ts#L858)（api-keys）+ [routes-registry.ts#L884](file:///home/airxw/Documents/gsp/gameserver-panel/panel/backend/src/routes-registry.ts#L884)（users）
- 角色守卫：[utils/role.ts#L5-L7](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/utils/role.ts#L5-L7)（`isAdminRole`）

## 11. 待办与风险
- `[TODO]` 列表无搜索 / 过滤能力，Key 数量多时管理体验差；可考虑增加按 name / user / role / 状态过滤。
- `[TODO]` 无「最后使用 IP」展示（后端 `ApiKeyInfo` 含 `last_used_ip` 字段但前端未渲染）；可加入表格用于安全审计。
- `[TODO]` 创建表单的 user 下拉仅展示 active 用户，但已撤销 Key 关联的用户若被禁用，列表中会显示 user_id（fallback）；可考虑后端在 list 时 join 用户名一并返回。
- `[RISK]` **明文 API Key 在 Modal 中显示，浏览器开发者工具 Network 面板会记录 POST 响应体**——即使用户关闭 Modal，明文 key 仍可在 Network 中找到。生产环境建议后端在响应头加 `Cache-Control: no-store`，并提示用户关闭 DevTools。
- `[RISK]` 前端阻断 server_admin 创建是软阻断（仅 toast.warning），后端必须再次校验（已在 `apiKeys.ts` 契约注释中提及 `APIKEY_ROLE_FORBIDDEN`）；若后端漏校验，前端可绕过。
- `[RISK]` 撤销操作不可逆，但仅软删除（标记 `revoked_at`）；如果数据库被注入或管理员误删 `revoked_at` 字段，已撤销 Key 可能复活——后端应在鉴权中间件中独立校验 `revoked_at IS NULL`。
- `[RISK]` `expires_at` 永不过期选项（不填）可能导致 Key 长期有效，无过期轮换机制；建议增加「强制最大过期时间」配置项。

## 梳理元数据
- 梳理日期：2026-07-26
- 梳理方式：代码阅读（组件 / API client / 后端路由 / 路由注册表）
