# 系统配置（SystemConfig）

## 1. 页面定位
> 面板全局 KV 配置项的查看、行内编辑、新建、删除与恢复默认值管理页，按 key 前缀分 Tab 归类。

## 2. 入口与路由
- `[ROUTE]` 路由路径：`/admin/system-config`
- 浏览器入口（公网）：`https://gsp.ecsrz.com:3001/admin/system-config`
- 浏览器入口（局域网）：`https://192.168.5.14:3001/admin/system-config`
- 进入方式：在 `/admin` 基座侧边栏点击「系统配置」菜单，或直接输入 URL
- 退出方式：侧边栏切换其他菜单 / 浏览器后退

## 3. 角色与权限
- 允许角色：`server_admin` / `system_admin` / `admin`（双层门控）
- 守卫组件：
  - 外层：`<RequireRole allow={['server_admin', 'system_admin', 'admin']} />`（`App.tsx` 第 371 行基座 + 第 378 行内层）
  - 内层：[SystemConfig.tsx#L265-L267](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/admin/SystemConfig.tsx#L265-L267) `if (!isAdminRole(user?.role)) return <Navigate to="/forbidden" replace />`
- 未登录行为：`RequireRole` 重定向到 `/login`
- 越权行为：双层拦截，统一重定向 `/forbidden`
- 后端二次校验：`/api/system-config` 在 [routes-registry.ts#L885](file:///home/airxw/Documents/gsp/gameserver-panel/panel/backend/src/routes-registry.ts#L885) 通过 `authenticateToken + requireAdmin` 保护

## 4. 核心功能点
- 预定义 Key 参考表：展示 7 个内置 key（`shop.currency_name` / `shop.enabled` / `chat.enabled` / `vote.enabled` / `welcome.gift_item` / `backup.max_count` / `monitor.retention_days`）的说明、取值范围与默认值
- 配置分类 Tab（11.6）：`全部` / `基础设置` / `安全设置` / `邮件设置` / `存储设置` / `功能开关`，按 key 前缀归类，每个 Tab 显示数量
- 表格展示：Key / Value / 描述 / 更新时间 / 操作（编辑、恢复默认、删除）
- 行内编辑：Value + 描述，编辑态切换为 input
- 7.6 配置变更预览（`ConfigDiff` 组件）：
  - 编辑后点击「预览变更」弹 Modal
  - 字段级 diff（value / description），可单独「重置该字段」回到原值
  - 无变更时按钮 disabled，提示「没有检测到变更的字段」
- 11.6 恢复默认值：仅对预定义 key 且当前值非默认值时显示按钮，点击直接 PUT 预定义默认值
- 新建配置：顶部表单（Key / Value / 描述），校验后 PUT `/system-config/:key`
- 删除：`window.confirm` 二次确认后 DELETE
- Toast 反馈（11.6）：保存 / 创建 / 删除 / 恢复默认值 均通过 `useToast()` 弹出成功/失败提示

## 5. 交互流程
1. 进入页面 → `useEffect` 触发 `refresh()`（GET /system-config）
2. 数据返回 → 渲染预定义参考表 + 分类 Tab + 配置表格
3. 点击 Tab → `filteredConfigs` 通过 `useMemo` 按前缀正则过滤
4. 点击「编辑」→ 行内 input → 点击「预览变更」→ Modal 展示 ConfigDiff → 「确认保存」→ PUT /system-config/:key → 成功 Toast + 行数据替换；失败 Toast + 顶部 alert
5. 点击「恢复默认」→ PUT 默认值 → 成功 Toast + 行数据替换
6. 点击「删除」→ `window.confirm` → DELETE → 成功 Toast + 从列表移除
7. 点击「+ 新建配置」→ 展开表单 → 填写 → 「创建」→ PUT → 成功 Toast + 加入列表（若已存在则替换）

## 6. 接口与数据

| `[API]` 接口 | 方法 | 鉴权 | 用途 | 错误码 |
|------|------|------|------|------|
| `/api/system-config` | GET | JWT + requireAdmin | 加载所有 KV 配置 | 401 / 403 |
| `/api/system-config/:key` | PUT | JWT + requireAdmin | 新建或更新单项配置（含描述） | `PANEL_VALIDATION_ERROR` / 500 |
| `/api/system-config/:key` | DELETE | JWT + requireAdmin | 删除单项配置 | 404 key 不存在 / 403 |

> API client 见 [client.ts#L651-L666](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/api/client.ts#L651-L666)。

## 7. 状态管理与副作用
- Context / Store：`useAuth()` 提供 `api`；`useToast()` 提供 toast 反馈
- Local state：
  - `configs` / `loading` / `error` —— 列表与加载态
  - `editingKey` / `editDraft` / `saving` —— 行内编辑
  - `newKey` / `newValue` / `newDesc` / `creating` / `showCreate` —— 新建表单
  - `diffPreviewKey` —— 7.6 配置变更预览弹窗
  - `activeCategory` —— 11.6 当前 Tab（默认 `'all'`）
- 副作用：
  - `[STATE]` 加载态：`loading=true` 显示「加载中…」
  - `[STATE]` 空态：列表为空显示「暂无系统配置。」；分类下为空显示「该分类下暂无配置项。」
  - `[STATE]` 错误态：顶部 alert + Toast 双重反馈
  - 无订阅、无定时器、无 WS

## 8. 错误与边界

| `[EDGE]` 边界 | UI 反馈 | 备注 |
|------|------|------|
| 角色非 admin | 重定向 `/forbidden` | 双层门控 |
| 加载失败 | 顶部 alert + 不显示表格 | `refresh()` try/catch |
| 保存失败 | alert + Toast.error | `handleSave` 双反馈 |
| 恢复默认值失败 | alert + Toast.error | `handleRestoreDefault` |
| 删除失败 | alert + Toast.error | `handleDelete` |
| 创建失败 | alert + Toast.error | `handleCreate` |
| 编辑无变更 | 预览 Modal 提示「没有检测到变更的字段，无需保存」 | `diffChanges.length === 0` |
| 非预定义 key 点击「恢复默认」 | Toast.info「该配置项无预定义默认值」 | `PREDEFINED_DEFAULTS[key] === undefined` |
| 当前值已是默认值 | 「恢复默认」按钮隐藏 | `hasDefault && !isDefaultValue` |
| 新建 Key 为空 | alert「请填写配置 key」 | 本地校验 |
| 新建 Value 为空 | alert「请填写配置 value」 | 本地校验 |
| Modal 关闭态保存中 | disableClose 阻止关闭 | `disableClose={saving}` |

## 9. 体验与一致性检查
- `[UX]` 设计语言：与全站一致，`page-header` / `info-card` / `data-table` / `form-card` / `tabs` / `tab-btn` 共用样式；预定义参考表使用 `mono` 字体展示 key/默认值
- `[UX]` 移动端适配：依赖全局 `mobile-only` / `desktop-only` 切换，本页表格为 `data-table`（移动端表现依赖全局 CSS）
- `[UX]` 与其他页面一致性：与 `Settings` 页面互为补充——本页是「原始 KV 编辑器」，`Settings` 是「结构化 schema 表单」，两者目标用户都是 admin，UI 风格统一
- `[UX]` 反馈规范：所有写操作均 toast.success / toast.error，错误同时显示 alert，避免漏看
- `[UX]` 配置变更预览：`ConfigDiff` 组件支持字段级 diff + 单字段重置，防止误改

## 10. 关键实现定位（代码引用）
- 路由入口：[App.tsx#L371-L416](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/App.tsx#L371-L416)（`system-config` 子路由在第 380 行）
- 页面组件：[SystemConfig.tsx](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/admin/SystemConfig.tsx)
- 预定义 Key：[SystemConfig.tsx#L23-L31](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/admin/SystemConfig.tsx#L23-L31)
- 分类定义：[SystemConfig.tsx#L43-L73](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/admin/SystemConfig.tsx#L43-L73)
- ConfigDiff 组件：[ConfigDiff.tsx#L11-L14](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/components/ConfigDiff.tsx#L11-L14) `ConfigChange` 接口
- API client：[client.ts#L651-L666](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/api/client.ts#L651-L666)（`listSystemConfigs` / `setSystemConfig` / `deleteSystemConfig`）
- 后端路由：[systemConfig.ts#L39-L114](file:///home/airxw/Documents/gsp/gameserver-panel/panel/backend/src/api/routes/systemConfig.ts#L39-L114)（GET / GET /:key / PUT /:key / DELETE /:key）
- 后端挂载：[routes-registry.ts#L885](file:///home/airxw/Documents/gsp/gameserver-panel/panel/backend/src/routes-registry.ts#L885)

## 11. 待办与风险
- `[RISK]` 预定义 Key 列表与默认值是前端硬编码（[SystemConfig.tsx#L23-L31](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/admin/SystemConfig.tsx#L23-L31)），与后端实际生效的默认值可能漂移；建议从后端 schema 动态拉取
- `[RISK]` 配置分类是前端按 key 前缀正则归类（[SystemConfig.tsx#L43-L73](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/admin/SystemConfig.tsx#L43-L73)），新增前缀（如 `node.` / `proxy.`）会落入「全部」但不属于任何分类，用户难以发现
- `[RISK]` PUT `/system-config/:key` 同时承担「新建」与「更新」语义，若用户误填已存在 key 会静默覆盖；前端新建表单未做重复 key 检查
- `[RISK]` 删除使用 `window.confirm`，与其他页面（如 Users）的 Modal 确认风格不一致，移动端原生 confirm 体验较差
- `[TODO]` 缺少配置项变更历史（谁在何时改了什么），依赖 audit-logs 兜底但本页无入口
- `[TODO]` 配置分类 Tab 数量固定，未支持「未分类」聚合 Tab，新增前缀的配置项会丢失归类
- `[TODO]` 敏感配置（如 `mail.smtp_password`）在表格中以明文展示，建议对 `security.*` / `*.secret` / `*.password` 类 key 做脱敏

## 梳理元数据
- 梳理日期：2026-07-26
- 梳理方式：代码阅读（SystemConfig.tsx + ConfigDiff.tsx + client.ts + systemConfig.ts + routes-registry.ts）
- 涉及版本标注：7.6（ConfigDiff 预览）、11.6（分类 Tab + 恢复默认 + Toast）
