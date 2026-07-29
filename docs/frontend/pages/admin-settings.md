# 面板设置（Settings）

## 1. 页面定位
> v3.8.0 起替代纯 KV 编辑器的结构化设置面板：按 group 分组、按 type 渲染对应控件，支持单行保存与重置默认值。

## 2. 入口与路由
- `[ROUTE]` 路由路径：`/admin/settings`
- 浏览器入口（公网）：`https://gsp.ecsrz.com:3001/admin/settings`
- 浏览器入口（局域网）：`https://192.168.5.14:3001/admin/settings`
- 进入方式：`/admin` 基座侧边栏点击「设置」菜单，或直接输入 URL
- 退出方式：侧边栏切换其他菜单 / 浏览器后退

## 3. 角色与权限
- 允许角色：`server_admin` / `system_admin` / `admin`（双层门控）
- 守卫组件：
  - 外层：`<RequireRole allow={['server_admin', 'system_admin', 'admin']} />`（`App.tsx` 第 371 行基座 + 第 378 行内层）
  - 内层：[Settings.tsx#L185-L187](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/admin/Settings.tsx#L185-L187) `if (!isAdminRole(user?.role)) return <Navigate to="/forbidden" replace />`
- 未登录行为：`RequireRole` 重定向到 `/login`
- 越权行为：双层拦截，统一重定向 `/forbidden`
- 后端二次校验：`/api/settings` 在 [routes-registry.ts#L886](file:///home/airxw/Documents/gsp/gameserver-panel/panel/backend/src/routes-registry.ts#L886) 通过 `authenticateToken + requireAdmin` 保护（公开站点信息走 `/api/settings/site-info` 第 887 行单独挂载）

## 4. 核心功能点
- 分组结构化展示（v3.8.0）：10 个固定 group，按 `GROUP_ORDER` 顺序渲染——`site`/`registration`/`games`/`vip`/`admin`/`backup`/`mail`/`maintenance`/`disk`/`legal`
- 每行设置项渲染（`SettingRow` 组件）：
  - 字段：label / description / 编辑控件 / `key`+`type`+`defaultValue` 元信息
  - 「默认」按钮 → `POST /settings/:key/reset` 重置为 defaultValue
  - 「保存」按钮 → `PUT /settings/:key`，仅在 `isDirty=true` 时可点
- 控件类型（`SettingInput` 组件，按 `item.type` 分支）：
  - `boolean` → v4.22.8 iOS 风格 toggle switch（`settings-toggle`）
  - `number` → `<input type="number">`，支持 min/max
  - `enum` → 选项 ≤4 时 v4.22.8 segmented chips（`settings-segmented`），否则原生 `<select>`
  - `json` → `<textarea>` monospace，多行编辑
  - `string` → `<input type="text">`
- v4.1.1 移动端手风琴分组：默认展开 `site`，点击分组头展开/折叠，类似 iOS Settings App
- safeGroup 兜底（防御性）：后端新增 group 未在前端 `GROUP_LABELS` 声明时归入 `admin`，避免 `groups[g].push` 崩溃
- 接口未启用降级：`isEndpointUnavailable`（404 / `HTTP_404` / `NETWORK_ERROR`）→ 显示「设置接口暂未开放（v3.8.0+ 后端未启用）」

## 5. 交互流程
1. 进入页面 → `useEffect` 触发 `loadSettings()`（GET /settings/schema）
2. 数据返回 → `editingValues` 用 `currentValue ?? defaultValue` 初始化 → 按 `GROUP_ORDER` 渲染分组
3. 用户编辑控件 → `editingValues[key]` 更新 → 「保存」按钮变可点（`isDirty=true`）
4. 点击「保存」→ `setSavingKeys` 加入 key → PUT /settings/:key → 成功 Toast + `settings` 中 currentValue 更新；失败 Toast.error
5. 点击「默认」→ POST /settings/:key/reset → 成功 Toast + currentValue 与 editingValues 同步更新
6. 移动端点击分组头 → `expandedGroup` 切换 → 折叠/展开
7. 接口 404 → `unavailable=true` → 显示降级提示

## 6. 接口与数据

| `[API]` 接口 | 方法 | 鉴权 | 用途 | 错误码 |
|------|------|------|------|------|
| `/api/settings/schema` | GET | JWT + requireAdmin | 拉取所有设置项 schema + currentValue | 401 / 403 / 404 接口未启用 |
| `/api/settings/:key` | PUT | JWT + requireAdmin | 单项保存（body `{ value }`） | `PANEL_VALIDATION_ERROR` / 403 |
| `/api/settings/:key/reset` | POST | JWT + requireAdmin | 重置为 defaultValue | 404 key 不存在 |

> API client 见 [client.ts#L1871-L1945](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/api/client.ts#L1871-L1945)（`listSettingsSchema` / `updateSetting` / `resetSetting`）。

## 7. 状态管理与副作用
- Context / Store：`useAuth()` 提供 `api`；`useToast()` 提供 toast 反馈
- Local state：
  - `settings` / `loading` / `unavailable` / `error` / `hasLoaded` —— 列表与加载态
  - `editingValues: Record<string, string>` —— 编辑中的值（未保存）
  - `savingKeys: Set<string>` —— 正在保存的 key 集合
  - `expandedGroup: SettingGroup | null` —— 移动端手风琴展开项（默认 `'site'`）
- 副作用：
  - `[STATE]` 加载态：`loading && !hasLoaded` 显示「加载中…」
  - `[STATE]` 空态：`settings.length === 0` 显示「暂无设置项。」
  - `[STATE]` 降级态：`unavailable=true` 显示「设置接口暂未开放」
  - `[STATE]` 错误态：顶部 alert 显示 `error`
  - 无订阅、无定时器、无 WS

## 8. 错误与边界

| `[EDGE]` 边界 | UI 反馈 | 备注 |
|------|------|------|
| 角色非 admin | 重定向 `/forbidden` | 双层门控 |
| 接口未启用（404/NETWORK_ERROR） | 显示「设置接口暂未开放（v3.8.0+ 后端未启用）」 | `isEndpointUnavailable` |
| 其他加载错误 | 顶部 alert | 非 404 走 error 分支 |
| 保存失败 | Toast.error 显示 err.message | `handleSave` 区分 `PanelApiError` |
| 重置失败 | Toast.error | `handleReset` |
| 后端新增 group 未在前端声明 | 归入 `admin` 分组，不崩溃 | `safeGroup` 兜底（[Settings.tsx#L49-L51](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/admin/Settings.tsx#L49-L51)） |
| 编辑值等于当前值 | 「保存」按钮 disabled | `isDirty=false` |
| 保存中 | 「保存」按钮显示「保存中…」+ disabled | `savingKeys.has(key)` |
| boolean 切换 | iOS 风格 toggle 即时更新 `editingValues` | 实际生效仍需点「保存」 |
| enum 选项 ≤4 | segmented chips 单选 | `item.enumValues.length <= 4` |

## 9. 体验与一致性检查
- `[UX]` 设计语言：与全站一致，采用 iOS Settings App 风格的分组手风琴 + 单行编辑；v4.22.8 toggle/segmented 控件遵循苹果清新设计语言
- `[UX]` 移动端适配：手风琴分组（一次只展开一个 group）节省纵向空间，符合移动端阅读习惯；分组头支持 Enter/Space 键盘操作（`role="button"` + `tabIndex={0}`）
- `[UX]` 与其他页面一致性：与 `SystemConfig` 互补（结构化表单 vs 原始 KV 编辑器），样式共用 `btn` / `alert` / `empty-state`；与 `Profile` 页面（个人设置）共用 `SettingSchemaItem` 类型
- `[UX]` 反馈规范：保存/重置成功均 toast.success，失败 toast.error；编辑值未变时按钮 disabled 避免误触
- `[UX]` 元信息透明：每行底部展示 `key` / `type` / `defaultValue`，方便管理员对照

## 10. 关键实现定位（代码引用）
- 路由入口：[App.tsx#L371-L416](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/App.tsx#L371-L416)（`settings` 子路由在第 382 行）
- 页面组件：[Settings.tsx](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/admin/Settings.tsx)
- 分组定义：[Settings.tsx#L17-L42](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/admin/Settings.tsx#L17-L42)（`GROUP_LABELS` / `GROUP_ORDER`）
- safeGroup 兜底：[Settings.tsx#L48-L51](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/admin/Settings.tsx#L48-L51)
- SettingInput 控件分支：[Settings.tsx#L355-L469](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/admin/Settings.tsx#L355-L469)
- 类型契约：[modules/settings.ts#L23-L36](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/api/modules/settings.ts#L23-L36) `SettingSchemaItem`
- API client：[client.ts#L1871-L1945](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/api/client.ts#L1871-L1945)（`listSettingsSchema` / `updateSetting` / `resetSetting`）
- 后端路由：[settings.ts#L81-L145](file:///home/airxw/Documents/gsp/gameserver-panel/panel/backend/src/api/routes/settings.ts#L81-L145)（GET /schema / GET /schema/:key / PUT /:key / POST /:key/reset）
- 后端挂载：[routes-registry.ts#L886-L887](file:///home/airxw/Documents/gsp/gameserver-panel/panel/backend/src/routes-registry.ts#L886-L887)

## 11. 待办与风险
- `[RISK]` `GROUP_LABELS` 与 `GROUP_ORDER` 是前端硬编码 10 个分组，与后端 `SettingGroup` 必须手动保持同步；后端新增 group 会被 `safeGroup` 静默归入 `admin`，用户不易察觉漂移
- `[RISK]` `SettingInput` 的 `boolean` 类型 toggle 切换会即时更新 `editingValues` 但不立即保存，用户可能误以为已生效；建议在 toggle 旁加「未保存」提示
- `[RISK]` `json` 类型直接 `<textarea>` 编辑无语法高亮与校验，保存前不验证 JSON 合法性，依赖后端 `PANEL_VALIDATION_ERROR` 兜底，体验差
- `[RISK]` 客户端类型 `ListSettingsSchemaResponse` 在 client.ts 中重复定义（[client.ts#L1872-L1887](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/api/client.ts#L1872-L1887)），与 [modules/settings.ts#L23-L41](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/api/modules/settings.ts#L23-L41) 的 `SettingSchemaItem` 类型不一致（前者 group 仅 6 个值，后者 10 个），存在类型契约漂移
- `[RISK]` 接口未启用降级文案「v3.8.0+ 后端未启用」是历史版本残留，当前后端已稳定启用，文案可能误导用户
- `[TODO]` 缺少分组级「全部保存」按钮，每个 setting 项需逐行保存，大量修改时操作繁琐
- `[TODO]` `sensitive` 字段在 schema 中已声明但 UI 未脱敏（如 `mail.smtp_password` 应做 password 输入框）
- `[TODO]` 移动端手风琴展开项状态未持久化到 URL，刷新即丢失

## 梳理元数据
- 梳理日期：2026-07-26
- 梳理方式：代码阅读（Settings.tsx + modules/settings.ts + client.ts + settings.ts + routes-registry.ts）
- 涉及版本标注：v3.8.0（结构化面板替代 KV 编辑器）、v3.9.0（新增 mail/maintenance/disk/legal 分组）、v4.1.1（移动端手风琴）、v4.22.8（iOS toggle + segmented chips）
