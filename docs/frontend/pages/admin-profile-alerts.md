# 告警设置（admin 基座内）

## 1. 页面定位
> 用户在 admin 基座内配置个人告警通知通道（邮箱 / Webhook）与订阅规则的页面（v4.6.0-F4）。该组件跨基座共享，同时挂在 `/admin/profile/alerts`、`/store/profile/alerts`、`/guild/profile/alerts`。

## 2. 入口与路由
- `[ROUTE]` 路由路径：`/admin/profile/alerts`
- 浏览器入口（公网）：`https://gsp.ecsrz.com:3001/admin/profile/alerts`
- 浏览器入口（局域网）：`https://192.168.5.14:3001/admin/profile/alerts`
- 进入方式：登录后从 `/admin` 侧边栏或个人设置相关入口进入；或直接输入 URL。
- 退出方式：点击侧边栏其他菜单；浏览器返回；点击退出登录。
- 跨基座共享：同一组件 `AlertSettings.tsx` 同时挂在三个基座下，行为一致。

## 3. 角色与权限
- 允许角色：`server_admin` / `system_admin` / `admin`（在 `/admin` 基座下由 `RequireRole` 门控）
- 守卫组件：
  - 路由级：`RequireRole allow={['server_admin', 'system_admin', 'admin']}`（`/admin` 基座 + 系统管理子路由双层套用）
  - 组件级：**无 `isAdminRole` 守卫**（组件本身不限制角色，任何已登录用户均可使用）
- 未登录行为：被 `RequireRole` 上游的 `RequireAuth` 拦截，重定向到 `/login?redirect=/admin/profile/alerts`
- 越权行为：路由级 401/403 由后端 `authenticateToken` 中间件拒绝；接口仅需 JWT，不强制 requireAdmin
- 备注：在 `/guild` 基座下普通 `user` 角色也可访问；admin 基座下仅管理员可见

## 4. 核心功能点
- **邮箱通道卡片**：展示当前邮箱 + 验证状态（已验证绿 / 未验证黄）+ 启用邮箱通知 checkbox（未验证时 disabled + cursor not-allowed）。
- **Webhook 通道卡片**：启用 Webhook checkbox + Webhook URL 输入框（`type="url"`，未启用时 disabled）+ 测试按钮（未启用 / URL 为空 / 测试中时 disabled）。
- **订阅规则卡片**：列出所有预置规则（`AlertRule[]`），每条规则一个复选框卡片——展示 `rule.type` badge + severity badge（info 绿 / warning 黄 / critical 红）+ 规则名称 + 描述。
- **保存按钮**：底部固定，仅当 `dirty === true` 时可点击；保存后清空 dirty + 局部更新 settings + toast「告警设置已保存」。
- **测试 Webhook**：仅测试当前编辑态的 URL（不保存），返回 `{ success, message }`；成功 / 失败均 toast 反馈。
- **加载 / 错误骨架屏**：首屏 loading 显示 `ListSkeleton`（4 行 2 列）；加载失败显示 alert-error + 重试按钮。

## 5. 交互流程
1. 页面挂载 → `useEffect` 触发 `refresh()` → `Promise.all` 并行加载 `getAlertSettings()` + `listAlertRules()`。
2. 加载完成后，编辑态（emailEnabled / webhookEnabled / webhookUrl / subscribedRules）从 settingsRes 同步初始化，`dirty = false`。
3. 用户切换「启用邮箱通知」→ 若未验证邮箱，toast.warning 阻断；否则 setEmailEnabled + setDirty(true)。
4. 用户切换「启用 Webhook」→ setWebhookEnabled + setDirty(true)。
5. 用户编辑 Webhook URL → setWebhookUrl + setDirty(true)。
6. 用户切换规则复选框 → toggleRule 更新 subscribedRules Set + setDirty(true)。
7. 用户点击「测试 Webhook」→ 前端校验 URL 非空 → `api.testAlertWebhook({ webhook_url })` → toast 反馈。
8. 用户点击「保存设置」→ `api.updateAlertSettings({ email_enabled, webhook_enabled, webhook_url, subscribed_rules })` → 成功后从响应同步编辑态 + dirty=false + toast「告警设置已保存」。
9. 任意错误 → setError / toast；按钮 disabled 防重复提交（`saving` / `testingWebhook`）。

## 6. 接口与数据
| `[API]` 接口 | 方法 | 鉴权 | 用途 | 错误码 |
|------|------|------|------|------|
| `/api/alert-settings` | GET | JWT | 获取当前用户告警设置（settings + email + email_verified），返回 `{ settings: AlertSettings, email, email_verified }` | 401 PANEL_UNAUTHORIZED |
| `/api/alert-settings/rules` | GET | JWT | 列出所有预置告警规则，返回 `{ rules: AlertRule[] }`（每条含 type / name / description / severity） | 401 |
| `/api/alert-settings` | PUT | JWT | 更新告警设置，body `{ email_enabled, webhook_enabled, webhook_url, subscribed_rules }`；返回 `{ settings: AlertSettings }` | 400 ALERT_SETTINGS_INVALID / 403 ALERT_EMAIL_NOT_VERIFIED（启用邮箱但未验证） |
| `/api/alert-settings/test-webhook` | POST | JWT | 测试 Webhook 推送，body `{ webhook_url }`；返回 `{ success, message }` | 400 ALERT_WEBHOOK_URL_INVALID / 500 ALERT_WEBHOOK_TEST_FAILED |

> 后端挂载点：`routes-registry.ts#L940` `app.use('/api/alert-settings', authenticateToken(JWT_SECRET), createAlertSettingsRouter(db, alertService, logger))`。
> 类型来源：`AlertSettings` / `AlertRule` / `AlertRuleType` / `UpdateAlertSettingsRequest` / `TestWebhookRequest` 来自 `@public/schema/panel-api-types`。

## 7. 状态管理与副作用
- Context / Store：`useAuth()`（提供 `api`）、`useToast()`（来自 `context/ToastContext`）、`useDocumentTitle('告警设置')`（设置页面标题）
- Local state：
  - `[STATE]` `settings` / `email` / `emailVerified` / `rules` / `loading` / `error`：服务端数据 + 加载态
  - `[STATE]` 编辑态：`emailEnabled` / `webhookEnabled` / `webhookUrl` / `subscribedRules`（Set<AlertRuleType>）
  - `[STATE]` `dirty`：是否有未保存更改（控制保存按钮 disabled）
  - `[STATE]` `saving` / `testingWebhook`：提交 busy
- 副作用：仅 `useEffect` 触发首屏 `refresh()`；无定时器 / WS 订阅。
- 设计模式：编辑态与 settings 分离，所有修改先写入编辑态 + dirty=true，点击保存才提交——避免「未保存提示」丢失。
- 工具函数：`severityClass(severity)` 返回 badge 类名；`SEVERITY_LABEL` 映射中文标签。

## 8. 错误与边界
| `[EDGE]` 边界 | UI 反馈 | 备注 |
|------|------|------|
| 首屏加载中 | ListSkeleton（4 行 2 列）骨架屏 | `loading && !settings` |
| 首屏加载失败 | alert-error + 重试按钮 | `error && !settings` |
| 加载后仍有 error（局部刷新失败） | 顶部 alert-error + 重试按钮 | 不影响已有数据展示 |
| 启用邮箱但未验证 | toast.warning「请先验证邮箱后再启用邮箱通道」 + checkbox 不切换 | `handleEmailEnabledChange` 阻断 |
| 邮箱未验证时邮箱 checkbox | disabled + cursor not-allowed + hint「请先验证邮箱」 | UI 层硬阻断 |
| Webhook URL 为空时测试 | toast.error「请先填写 Webhook URL」 | 不发请求 |
| Webhook 未启用时 URL 输入框 | disabled | `!webhookEnabled` |
| 测试 Webhook 失败 | toast.error + 错误消息 | Modal 不存在，仅 toast |
| 保存时无 dirty | 保存按钮 disabled | `!dirty` |
| 保存成功 | 局部同步编辑态 + dirty=false + toast.success | 避免再次全量 refresh |
| 保存失败 | toast.error | dirty 保持 true，用户可重试 |
| 规则列表为空 | 「暂无可用告警规则」提示 | `rules.length === 0` |
| 网络错误 | toast.error | 通用兜底 |

## 9. 体验与一致性检查
- `[UX]` 设计语言：使用 lucide-react 图标（RefreshCw / AlertCircle）；`info-card` / `card-title` / `info-row` / `form-field` / `badge` 等通用 CSS 类；与 Profile / PlayerVerify 同款；符合「苹果清新设计、非电竞风」要求。
- `[UX]` 移动端适配：info-card 卡片竖排堆叠；规则卡片使用 flex 布局，窄屏下自动换行；保存按钮固定在底部。
- `[UX]` 跨基座一致性：组件本身无 `basePath` 依赖（无内部跳转），三个基座下行为完全一致；`useDocumentTitle('告警设置')` 在所有基座下统一标题。
- `[UX]` 优秀实践：
  - 编辑态与 settings 分离 + dirty 标记，避免「未保存提示」丢失（与 TunnelManagement 形成对比，后者无 dirty 标记）。
  - 邮箱未验证时 checkbox disabled + hint，引导用户先去 Profile 页验证邮箱。
  - Webhook 测试不依赖保存，用户可快速验证 URL 可达性。
- `[UX]` 一致性瑕疵：
  - 规则卡片使用 inline style 而非 CSS 类，与其他卡片风格略有差异。
  - 保存按钮在页面底部固定，未使用 sticky footer，长列表时用户需滚动到底部才能保存。
  - `useToast` 来自 `context/ToastContext`（与其他 admin 页面的 `components/ui` useToast 不同），需确认两者行为一致。
- `[UX]` 与其他页面一致性：与 Profile 共用 `info-card` / `badge` 样式；与 `/admin/webhooks` 互补（admin/webhooks 是系统级 Webhook 配置，本页是用户级告警订阅）。

## 10. 关键实现定位（代码引用）
- 路由入口：[App.tsx#L405-L408](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/App.tsx#L405-L408)（v4.14.2 挂载到 admin 基座）
- 页面组件：[AlertSettings.tsx](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/AlertSettings.tsx)
- 关键 hook：[useAuth](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/api/auth.ts) / [useToast (context)](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/context/ToastContext.tsx) / [useDocumentTitle](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/hooks/useDocumentTitle.ts) / [ListSkeleton](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/components/ui/index.ts)
- API client：[client.ts#L1368-L1388](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/api/client.ts#L1368-L1388)（AlertSettings 5 个方法，含 listAlertEvents 未使用）
- 后端路由：[api/routes/alertSettings.ts](file:///home/airxw/Documents/gsp/gameserver-panel/panel/backend/src/api/routes/alertSettings.ts)
- 后端挂载：[routes-registry.ts#L940](file:///home/airxw/Documents/gsp/gameserver-panel/panel/backend/src/routes-registry.ts#L940)
- 类型定义：`@public/schema/panel-api-types`（AlertSettings / AlertRule / AlertRuleType 等，公共契约）

## 11. 待办与风险
- `[TODO]` 保存按钮未使用 sticky footer，长规则列表时用户需滚动到底部才能保存；可改为 `position: sticky; bottom: 0`。
- `[TODO]` 规则卡片使用 inline style，未抽象为通用 CSS 类；若后续规则数量增加，维护成本高。
- `[TODO]` 无「重置为上次保存」按钮——用户修改后想放弃更改需手动逐字段还原；可增加「放弃更改」按钮（重置编辑态为 settings）。
- `[TODO]` 无规则搜索 / 过滤；规则数量多时体验差（当前可能仅几条，但未来扩展需考虑）。
- `[TODO]` `listAlertEvents` 接口已在 client 实现（L1380）但本页未使用；可考虑增加「最近告警事件」预览卡片，帮助用户判断是否需要调整订阅。
- `[RISK]` **Webhook URL 明文存储**——`PUT /alert-settings` 明文回传 webhook_url，后端若不加密存储，数据库泄露会导致 Webhook URL 泄漏（Webhook URL 通常包含 secret token）。
- `[RISK]` 测试 Webhook 不限制频率——用户可频繁点击测试按钮，可能被滥用触发目标 URL 限流或被封；建议前端增加 debounce 或后端限流。
- `[RISK]` `useToast` 来自 `context/ToastContext`，与其他 admin 页面的 `components/ui` useToast 不同；若两者行为不一致（如 toast 类型支持差异），可能导致 UX 不一致；需确认是否为同一实现。
- `[RISK]` 启用邮箱通道时仅前端校验 `emailVerified`，后端若不二次校验，用户可通过直接调用 API 绕过（`PUT /alert-settings` body 含 `email_enabled: true` 但邮箱未验证）；后端必须返回 403 ALERT_EMAIL_NOT_VERIFIED。
- `[RISK]` 订阅规则使用 `Set<AlertRuleType>`，若后端规则 type 列表变更（新增 / 删除），已保存的 subscribed_rules 可能包含已废弃的 type；后端在 GET 时应过滤失效 type，或前端在加载规则后过滤 subscribedRules。

## 梳理元数据
- 梳理日期：2026-07-26
- 梳理方式：代码阅读（组件 / API client / 后端路由 / 路由注册表）
- 跨基座备注：本页重点分析 admin 上下文；组件本身在 store / guild 基座下行为一致。
