# 隧道管理

## 1. 页面定位
> 系统管理员在 Panel 内管理 FRP（frpc）隧道的运维页面——查看运行状态、编辑 frpc 配置、启停进程、查看最近日志（v4.4.0-O1，I2 优化项）。

## 2. 入口与路由
- `[ROUTE]` 路由路径：`/admin/tunnel`
- 浏览器入口（公网）：`https://gsp.ecsrz.com:3001/admin/tunnel`
- 浏览器入口（局域网）：`https://192.168.5.14:3001/admin/tunnel`
- 进入方式：登录后从 `/admin` 侧边栏「隧道管理」入口进入；或直接输入 URL。
- 退出方式：点击侧边栏其他菜单；浏览器返回；点击退出登录。

## 3. 角色与权限
- 允许角色：`server_admin` / `system_admin` / `admin`（路由级 `RequireRole` + 组件内 `isAdminRole` 双重门控）
- 守卫组件：
  - 路由级：`RequireRole allow={['server_admin', 'system_admin', 'admin']}`（`/admin` 基座 + 系统管理子路由双层套用）
  - 组件级：`isAdminRole(user?.role)` 不通过 → `<Navigate to="/forbidden" replace />`
- 未登录行为：被 `RequireRole` 上游的 `RequireAuth` 拦截，重定向到 `/login?redirect=/admin/tunnel`
- 越权行为：路由级 401/403 由后端 `authenticateToken + requireAdmin` 中间件拒绝；组件级本地校验后跳 `/forbidden`

## 4. 核心功能点
- **进程状态卡**：展示运行状态（运行中绿 / 已停止灰）+ PID + 运行时长（`formatUptime` 自动换算秒/分/时/天）+ 配置启用 + 服务器地址 + 隧道数；启动/停止按钮根据 `status.running` 自动 disabled。
- **配置编辑区**：
  - 顶层字段：frps 服务器地址 / 端口（1-65535） / 认证 token（可选，明文显示） / 启用隧道 checkbox。
  - 隧道映射列表：支持 tcp / udp / http / https 四种类型；tcp/udp 显示「远程端口」字段，http/https 显示「自定义域名」字段；支持添加 / 删除单条隧道。
- **保存配置**：`PUT /api/system/tunnel/config`；明确提示「保存配置不会自动重启 frpc 进程，需手动点击启动」。
- **启停 frpc**：`POST /api/system/tunnel/start` / `stop`；启停后自动 `loadAll()` 刷新全部数据。
- **日志查看区**：`GET /api/system/tunnel/logs?limit=200`；按时间倒序展示最近 200 条；error 级别日志红色高亮；max-height 400px 可滚动。

## 5. 交互流程
1. 页面挂载 → `useEffect` 触发 `loadAll()` → `Promise.all` 并行加载 status / config / logs。
2. 用户编辑配置 → 字段级 `setConfig` 局部更新（保持其他字段不变）。
3. 用户添加 / 删除隧道 → `addTunnel` / `removeTunnel` 操作 `config.tunnels` 数组。
4. 用户点击「保存配置」→ 前端校验 server_addr 非空 + server_port 范围 + 每条 tunnel name 非空 + tcp/udp 必填 remote_port → `PUT /api/system/tunnel/config` → toast 反馈。
5. 用户点击「启动」/「停止」→ `POST /start` / `stop` → 成功后 `loadAll()` 刷新。
6. 用户点击「刷新全部」→ 重新 `loadAll()`。
7. 任意错误 → `setError` 渲染顶部 alert；按钮 disabled 防重复提交。

## 6. 接口与数据
| `[API]` 接口 | 方法 | 鉴权 | 用途 | 错误码 |
|------|------|------|------|------|
| `/api/system/tunnel/status` | GET | JWT + requireAdmin | 查询 frpc 进程状态（running/pid/started_at/enabled/server_addr/tunnel_count） | 401 / 403 / 500 TUNNEL_INTERNAL |
| `/api/system/tunnel/config` | GET | JWT + requireAdmin | 获取当前 frpc 配置（server_addr/server_port/token/enabled/tunnels[]） | 401 / 403 / 500 TUNNEL_CONFIG_READ_FAILED |
| `/api/system/tunnel/config` | PUT | JWT + requireAdmin | 更新配置（不自动重启），body `{ config }` | 400 TUNNEL_CONFIG_INVALID / 500 TUNNEL_CONFIG_WRITE_FAILED |
| `/api/system/tunnel/start` | POST | JWT + requireAdmin | 启动 frpc 进程，返回 `{ success, message }` | 500 TUNNEL_START_FAILED |
| `/api/system/tunnel/stop` | POST | JWT + requireAdmin | 停止 frpc 进程，返回 `{ success, message }` | 500 TUNNEL_STOP_FAILED |
| `/api/system/tunnel/logs?limit=200` | GET | JWT + requireAdmin | 获取最近日志（timestamp/level/message） | 401 / 403 / 500 TUNNEL_LOG_READ_FAILED |

> 后端挂载点：`routes-registry.ts#L878` `app.use('/api/system/tunnel', authenticateToken(JWT_SECRET), requireAdmin, createTunnelsRouter(...))`。

## 7. 状态管理与副作用
- Context / Store：`useAuth()`（提供 `api`、`user`）、`useToast()`
- Local state：
  - `[STATE]` `status` / `config` / `logs`：三组核心数据
  - `[STATE]` `loading` / `error`：全局加载三态
  - `[STATE]` `actionBusy`：启停按钮提交中（共用，禁用两个按钮）
  - `[STATE]` `savingConfig`：保存配置按钮提交中
- 副作用：仅 `useEffect` 触发首屏 `loadAll()`；无定时器 / WS 订阅（日志需手动点击「刷新全部」获取最新）。
- 工具函数：`formatUptime(startedAt)` 计算 `Date.now() - start` 的可读时长；`EMPTY_TUNNEL` 提供新增隧道默认值（local_ip `127.0.0.1` / local_port `25565`）。

## 8. 错误与边界
| `[EDGE]` 边界 | UI 反馈 | 备注 |
|------|------|------|
| status / config / logs 任一加载失败 | 顶部 alert-error | `Promise.all` 任一 reject 全部失败 |
| server_addr 为空 | toast.warning 阻断保存 | 不发请求 |
| server_port 不在 1-65535 | toast.warning 阻断保存 | 不发请求 |
| tunnel name 为空 | toast.warning 阻断保存 | 不发请求 |
| tcp/udp 类型 remote_port 缺失 / < 1 | toast.warning 阻断保存 | 不发请求 |
| http/https 类型无 remote_port 字段 | UI 不渲染该字段 | 类型切换时自动隐藏 |
| 启动时进程已在运行 | 启动按钮 disabled | `status?.running === true` |
| 停止时进程未运行 | 停止按钮 disabled | `status?.running !== true` |
| 启停失败 | toast.error + 自动 `loadAll()` 刷新 | 保持 UI 与后端一致 |
| 日志为空 | 「暂无日志」空态 | logs.length === 0 |
| `isAdminRole` 不通过 | `<Navigate to="/forbidden" replace />` | 组件级守卫 |

## 9. 体验与一致性检查
- `[UX]` 设计语言：使用 lucide-react 图标（Network / Activity / Play / Square / Save / ScrollText / RefreshCw / Plus / Trash2）；section 卡片 + page-header 模式；与 SSL / API Keys 同属 I1-I4 优化项，共用样式风格；符合「苹果清新设计、非电竞风」要求。
- `[UX]` 移动端适配：状态卡 + 配置顶层字段使用 `repeat(auto-fit, minmax(160px|220px, 1fr))`，移动端自动堆叠；隧道卡片 `minmax(140px, 1fr)`；日志区 `maxHeight: 400, overflowY: auto`。
- `[UX]` 与其他页面一致性：与 `/admin/ssl`、`/admin/api-keys` 同款 `sectionStyle` / `inputStyle` / `useToast`；按钮使用统一的 `btn-success` / `btn-danger` / `btn-primary` / `btn-ghost` 类。
- `[UX]` 一致性瑕疵：删除隧道按钮使用 `btn-ghost btn-sm` + `color: '#dc2626'` 红色文字，未使用 `btn-danger` 类；与 ApiKeys 撤销按钮风格不完全一致（后者同样使用 ghost+红色），属同一设计模式但未抽象为通用类。

## 10. 关键实现定位（代码引用）
- 路由入口：[App.tsx#L371-L416](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/App.tsx#L371-L416)
- 页面组件：[TunnelManagement.tsx](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/admin/TunnelManagement.tsx)
- 关键 hook：[useAuth](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/api/auth.ts) / [useToast](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/components/ui/index.ts)
- API client：[client.ts#L1836-L1868](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/api/client.ts#L1836-L1868)（Tunnel 6 个方法）
- 类型定义：[api/modules/system.ts#L326-L336](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/api/modules/system.ts#L326-L336)
- 后端路由：[api/routes/tunnels.ts](file:///home/airxw/Documents/gsp/gameserver-panel/panel/backend/src/api/routes/tunnels.ts)
- 后端挂载：[routes-registry.ts#L878](file:///home/airxw/Documents/gsp/gameserver-panel/panel/backend/src/routes-registry.ts#L878)
- 角色守卫：[utils/role.ts#L5-L7](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/utils/role.ts#L5-L7)（`isAdminRole`）

## 11. 待办与风险
- `[TODO]` 日志区无自动刷新（需用户手动点击「刷新全部」），生产排障体验差；可考虑增加「自动刷新」开关（每 5 秒拉取一次）或接入 WS 推送实时日志。
- `[TODO]` 配置编辑无「未保存提示」——用户修改后切换路由会丢失未保存内容；可参考 AlertSettings 的 `dirty` 标记 + `beforeunload` 警告。
- `[TODO]` 隧道列表无拖拽排序、无导入导出；多个隧道时管理体验有限。
- `[RISK]` **认证 token 明文显示在 input 中**（`<input type="text">`），且通过 `PUT /config` 明文回传后端；若浏览器被截屏或开发者工具记录网络请求，token 会泄露。建议改为 `type="password"` + 单独的「显示/隐藏」切换。
- `[RISK]` 保存配置不自动重启 frpc，用户可能保存后忘记点「启动」，导致配置生效滞后；UI 仅在底部有提示文字，无强提示。
- `[RISK]` 启停操作无二次确认 Modal（与 SSL 热重载不同），误点立即执行；如果 frpc 是公网入口的关键隧道，误停会导致外部访问立即失效。
- `[RISK]` `Promise.all` 加载 status / config / logs，任一失败全部失败；后端 logs 接口偶发失败时会导致整页空白，可改为 `Promise.allSettled` 局部降级。

## 梳理元数据
- 梳理日期：2026-07-26
- 梳理方式：代码阅读（组件 / API client / 后端路由 / 路由注册表）
