# 部署节点

## 1. 页面定位
> 系统管理员管理 Daemon 部署节点（master/slave）：列表、添加（生成邀请密钥 + 部署脚本/命令/手动步骤）、删除、Java 环境扫描、重新生成邀请、节点状态实时同步。

## 2. 入口与路由
- `[ROUTE]` 路由路径：`/admin/nodes`
- 浏览器入口（公网）：`https://gsp.ecsrz.com:3001/admin/nodes`
- 浏览器入口（局域网）：`https://192.168.5.14:3001/admin/nodes`
- 进入方式：`/admin` 基座侧边栏导航；直接访问 URL
- 退出方式：点击侧边栏切换到其他 `/admin/*` 页面；浏览器后退

## 3. 角色与权限
- 允许角色：`server_admin` / `system_admin` / `admin`
- 守卫组件：
  - 路由级：`<RequireRole allow={['server_admin', 'system_admin', 'admin']} />`（包裹整个 `/admin` 基座）
  - 组件级：组件内 `isAdminRole(user?.role)` 二次校验，不通过则 `<Navigate to="/forbidden" replace />`
  - 后端级：`POST /api/nodes`、`DELETE /api/nodes/:id`、`POST /api/nodes/:id/regenerate-invite` 在 `nodes.ts` 内挂载 `requireAdmin`
- 未登录行为：`RequireRole` 上游重定向到 `/login`
- 越权行为：路由守卫拦截 → `/forbidden`；后端 401/403
- 公开端点例外：`GET /api/nodes/invite/:linkKey/bootstrap-script` 与 `POST /api/nodes/link` 是 slave 注册用，不要求 JWT，靠 linkKey 自鉴权

## 4. 核心功能点
- 节点列表：类型（master/slave 徽章）/ 名称 / 状态（online/offline/pending/degraded）/ Daemon 地址 / 注册时间或邀请过期 / 操作
- 节点状态徽章：4 种状态色 + 图标（在线绿、离线红 X、待注册黄、降级黄）
- 添加节点弹窗：节点名称 + 对外展示地址（可选）→ 创建邀请 → 返回 linkKey + slave_command + 过期时间
- 部署引导 Tab：复制命令 / 下载脚本 / 手动步骤（含 systemd 配置示例）
- 复制到剪贴板：linkKey 与启动命令均支持一键复制
- 下载部署脚本：调用后端 `downloadNodeBootstrapScript(linkKey)` 下载 slave-bootstrap.sh
- 重新生成邀请：针对 pending 状态的 slave 节点，二次确认后重新生成密钥（原密钥失效）
- 删除节点：仅 slave 可删，二次确认（master 提示"不可删除"）
- Java 环境扫描：行内展开，调用 `scanNodeJavas(nodeId)` 透传到 Daemon
- WebSocket 订阅：`nodeStatusStore.subscribe()` 在节点上线/离线时自动 refresh

## 5. 交互流程
1. 进入页面 → `useEffect` 触发 `refreshNodes()` + 订阅 `nodeStatusStore`
2. 点击「添加节点」→ 弹窗输入名称 → 「创建邀请」→ `api.createNodeInvite(req)` → 展示 linkKey + slave_command + Tab 切换
3. Tab 1「复制命令」→ 复制 linkKey / 复制 slave_command
4. Tab 2「下载脚本」→ `api.downloadNodeBootstrapScript(linkKey)` → 浏览器下载 slave-bootstrap.sh
5. Tab 3「手动步骤」→ 展示 SSH + Node.js 安装 + systemd 配置示例
6. 点击「Java」按钮 → 行内展开 → `api.scanNodeJavas(nodeId)` → 渲染 `<JavaInstallationsPanel>`
7. pending slave 行「重新邀请」→ `window.confirm` 二次确认 → `api.regenerateInvite(nodeId)` → 弹窗展示新密钥 + refreshNodes
8. slave 行「删除」→ `window.confirm` 二次确认 → `api.deleteNode(node.id)` → toast.success + refreshNodes
9. 收到 `node.status` WS 事件 → 自动 refreshNodes

## 6. 接口与数据
| `[API]` 接口 | 方法 | 鉴权 | 用途 | 错误码 |
|---|---|---|---|---|
| `/api/nodes` | GET | JWT | 列出所有节点（含 master 与 slave） | 401 未认证 |
| `/api/nodes` | POST | JWT + `requireAdmin` | 创建节点邀请（返回 linkKey + slave_command + expires_at） | 400 PANEL_VALIDATION_ERROR；409 NODE_NAME_CONFLICT |
| `/api/nodes/:id` | DELETE | JWT + `requireAdmin` | 删除 slave 节点（master 不可删，校验无活跃实例） | 403 MASTER_NOT_DELETABLE；409 NODE_HAS_ACTIVE_INSTANCES |
| `/api/nodes/:id/regenerate-invite` | POST | JWT + `requireAdmin` | 重新生成邀请密钥（原密钥失效） | 404 NODE_NOT_FOUND |
| `/api/nodes/:id/javas` | GET | JWT | 扫描节点 Java 环境（透传到 Daemon） | 404 NODE_NOT_FOUND；502 DAEMON_UNREACHABLE |
| `/api/nodes/invite/:linkKey/bootstrap-script` | GET | 公开（linkKey 自鉴权） | 下载 slave-bootstrap.sh 部署脚本 | 404 LINK_KEY_NOT_FOUND；410 LINK_KEY_EXPIRED |

## 7. 状态管理与副作用
- Context / Store：`useAuth()` 提供 `api` 与 `user`；`useToast()` 提供 toast
- Local state：
  - `[STATE]` `nodes` / `loading` / `error` — 列表与加载态
  - `[STATE]` `rowStates: Record<nodeId, NodeRowState>` — 每行展开态 + Java 扫描结果
  - `[STATE]` `addState: AddNodeState` — 添加节点弹窗完整态（含 activeTab）
  - `[STATE]` `deletingIds: Set<string>` — 正在删除的节点 ID 集合
- 副作用（订阅 / 定时器 / WS）：
  - `nodeStatusStore.subscribe()` 订阅 WS `node.status` 事件，事件到达时自动 `refreshNodes()`
  - 组件卸载时调用 `unsubscribe()`
- 派生：节点状态徽章映射（online/offline/pending/degraded → 颜色 + 图标）

## 8. 错误与边界
| `[EDGE]` 边界 | UI 反馈 | 备注 |
|---|---|---|
| 列表为空 | `<EmptyState icon={<Server />} title="暂无部署节点" />` | 引导添加节点 |
| 列表加载失败 | alert-error + toast.error | 双重提示 |
| Java 扫描 404/网络错误 | 行内 alert-error「Java 扫描接口暂未开放」 | `isUnavailable(err)` 判定 |
| Java 扫描其他错误 | 行内 alert-error 展示 err.message | 不阻塞其他行 |
| 创建邀请失败 | 弹窗内 alert-error + toast.error | 不关闭弹窗 |
| 重新生成邀请失败 | alert-error + toast.error | 顶层错误展示 |
| 删除 master | toast.error「主节点不可删除」 | 前端拦截 |
| 删除 slave 失败 | alert-error + toast.error | 顶层错误展示 |
| 复制剪贴板失败 | toast.error | 兼容非 HTTPS 环境 |
| 下载脚本失败 | alert-error + toast.error | 顶层错误展示 |
| 删除中重复点击 | 删除按钮 disabled + 文案"删除中…" | `deletingIds.has(node.id)` |
| 越权访问 | `<Navigate to="/forbidden" replace />` | 组件级二次守卫 |

## 9. 体验与一致性检查
- `[UX]` 设计语言：lucide-react 图标齐全（Server / Coffee / Plus / RefreshCw / Trash2 / Download / ChevronDown/Right / AlertTriangle / XCircle），与其他 admin 页一致；NodeTypeBadge / NodeStatusBadge 颜色映射清晰
- `[UX]` 移动端适配：表格 `.table-wrap` 横向滚动；展开行使用 `colSpan={7}`；弹窗内 Tab 使用底部边框高亮，窄屏可点击
- `[UX]` 与其他页面一致性：使用 `useToast`、`Modal`、`EmptyState`，与 quotas/maintenance 一致；但本页使用 `window.confirm` 而非 `useConfirm`，与 maintenance 不一致
- `[UX]` 部署引导 3 个 Tab 设计优秀：复制命令 / 下载脚本 / 手动步骤，覆盖不同运维习惯
- `[UX]` 邀请密钥过期时间用 ⏰ + 黄色高亮，视觉提醒到位

## 10. 关键实现定位（代码引用）
- 路由入口：[App.tsx#L371-L416](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/App.tsx#L371-L416)（`/admin/nodes` 在 L404）
- 页面组件：[Nodes.tsx](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/admin/Nodes.tsx)
- 关键 hook：`useAuth`（`../../api/auth`）；`useToast`（`../../components/ui`）；`isAdminRole`（`../../utils/role`）
- 子组件：`JavaInstallationsPanel`（`../../components/JavaInstallationsPanel`）；`Modal` / `EmptyState`（`../../components/ui`）
- WS Store：[nodeStatusStore.ts](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/stores/nodeStatusStore.ts)（`subscribe()` + 单一共享 WS）
- API client：
  - `api.listNodes()` → [client.ts#L573-L575](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/api/client.ts#L573-L575)
  - `api.scanNodeJavas(nodeId)` → [client.ts#L1609-L1613](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/api/client.ts#L1609-L1613)
  - `api.createNodeInvite(req)` → [client.ts#L1621-L1626](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/api/client.ts#L1621-L1626)
  - `api.regenerateInvite(nodeId)` → [client.ts#L1627-L1632](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/api/client.ts#L1627-L1632)
  - `api.deleteNode(nodeId)` → [client.ts#L1633-L1638](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/api/client.ts#L1633-L1638)
  - `api.downloadNodeBootstrapScript(linkKey)` → [client.ts#L1645-L1691](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/api/client.ts#L1645-L1691)
- 后端路由：[nodes.ts](file:///home/airxw/Documents/gsp/gameserver-panel/panel/backend/src/api/routes/nodes.ts)（公开路由 L102；私有路由 L234/245/256/280/292/431）
- 路由挂载：[routes-registry.ts#L811-L813](file:///home/airxw/Documents/gsp/gameserver-panel/panel/backend/src/routes-registry.ts#L811-L813)（公开 + 私有两条 `app.use('/api/nodes', ...)`）

## 11. 待办与风险
- `[TODO]` 「重新邀请」与「删除」使用 `window.confirm`，与 maintenance 的 `useConfirm` 不一致；建议统一到 `useConfirm`
- `[TODO]` 节点列表无分页，节点数 > 100 时性能与可读性差
- `[TODO]` Java 扫描结果展开行未持久化，刷新页面后丢失；可考虑缓存到 sessionStorage
- `[TODO]` 手动步骤 Tab 中 `${addState.result.slave_command.match(/MASTER_URL=(\S+)/)?.[1] ?? 'https://gsp.ecsrz.com:3001'}` 用正则从命令中提取 MASTER_URL，脆弱易碎；建议后端直接返回该字段
- `[RISK]` 邀请密钥仅显示一次，若管理员关闭弹窗前未复制，需重新生成（原密钥失效），新手易丢密钥
- `[RISK]` 删除 slave 节点前端只校验 `node_type === 'master'`，未校验"无活跃实例"（依赖后端 409 拦截）；UI 应在删除前先调用 dry-run 接口
- `[RISK]` `nodeStatusStore` 是单一共享 WS，若 WS 断开节点状态不会自动刷新；UI 无 WS 连接状态提示
- `[RISK]` 下载脚本端点是公开的（仅 linkKey 鉴权），linkKey 泄露后可下载完整部署脚本（含 MASTER_URL）；建议加 IP 限制或一次性下载
- `[RISK]` 手动步骤 Tab 直接展示 `apt-get install`、`systemctl enable --now` 等命令，未提示用户替换路径或用户名，新手照抄可能踩坑

## 梳理元数据
- 梳理日期：2026-07-26
- 梳理方式：代码阅读
