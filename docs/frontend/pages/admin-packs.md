# Pack 管理

## 1. 页面定位
> 系统管理员在线管理游戏 Pack（YAML 配置包）：列出、查看、编辑、新建、删除、热重载，覆盖 Pack 全生命周期。

## 2. 入口与路由
- `[ROUTE]` 路由路径：`/admin/packs`
- 浏览器入口（公网）：`https://gsp.ecsrz.com:3001/admin/packs`
- 浏览器入口（局域网）：`https://192.168.5.14:3001/admin/packs`
- 进入方式：`/admin` 基座侧边栏导航；直接访问 URL
- 退出方式：点击侧边栏切换到其他 `/admin/*` 页面；浏览器后退

## 3. 角色与权限
- 允许角色：`server_admin` / `system_admin` / `admin`
- 守卫组件：
  - 路由级：`<RequireRole allow={['server_admin', 'system_admin', 'admin']} />`（包裹整个 `/admin` 基座）
  - 组件级：组件内 `isAdminRole(user?.role)` 二次校验，不通过则 `<Navigate to="/forbidden" replace />`
- 未登录行为：`RequireRole` 上游的 `authenticateToken` 链路重定向到 `/login`
- 越权行为：路由守卫拦截 → `/forbidden`；组件内二次拦截 → `/forbidden`

## 4. 核心功能点
- 列表展示：Pack ID / 游戏 / 变体 / 显示名称 / 版本 / UI Tabs
- 刷新：手动重新拉取 Pack 列表
- 新建 Pack：弹窗输入 Pack ID + 完整 `pack.yaml` 内容（含游戏类型参考下拉）
- 编辑 Pack：弹窗加载完整 YAML → 在线编辑 → 保存
- 删除 Pack：二次确认弹窗（警告"永久删除目录、不可恢复"）
- 重载 Pack：触发后端热重载，展示成功/失败明细（loaded / failed / total）
- 失败明细：单独 alert-warning 区块列出每个失败 Pack 的错误信息
- 顶部说明 alert-info：解释 Pack 概念、存放路径、支持的游戏类型

## 5. 交互流程
1. 进入页面 → `useEffect` 触发 `api.listPacks()` → 渲染表格
2. 点击「重载 Pack」→ `api.reloadPacks()` → 展示结果 alert + 自动 refresh
3. 点击「编辑」→ `fetchPackYaml(id)`（直连 `/api/packs/:id`）→ 加载到 textarea → 「保存」→ `savePackYaml(id, content)` PUT → 自动 reloadPacks
4. 点击「新建 Pack」→ 填 ID + YAML → `createPack(id, content)` POST → 自动 reloadPacks
5. 点击「删除」→ 二次确认 → `deletePack(id)` DELETE → 自动 reloadPacks
6. 任一操作失败 → 顶部 alert-error；成功 → 顶部 alert-success

## 6. 接口与数据
| `[API]` 接口 | 方法 | 鉴权 | 用途 | 错误码 |
|---|---|---|---|---|
| `/api/packs` | GET | JWT（`authenticateToken`） | 列出所有已加载 Pack 摘要 | 401 未认证 |
| `/api/packs/:id` | GET | JWT | 获取 Pack 完整 YAML 内容 | 404 PACK_NOT_FOUND |
| `/api/packs` | POST | JWT + `requireRole(SERVER_ADMIN)` | 新建 Pack（写入 `packs/<id>/pack.yaml`） | 400 PANEL_VALIDATION_ERROR；409 PACK_ALREADY_EXISTS |
| `/api/packs/:id` | PUT | JWT + `requireRole(SERVER_ADMIN)` | 更新 Pack YAML | 404 PACK_NOT_FOUND |
| `/api/packs/:id` | DELETE | JWT + `requireRole(SERVER_ADMIN)` | 删除 Pack 目录 | 404 PACK_NOT_FOUND |
| `/api/packs/reload` | POST | JWT + `requireRole(SERVER_ADMIN)` | 热重载所有 Pack，返回 `{loaded, failed, total}` | 500 PANEL_INTERNAL_ERROR |

## 7. 状态管理与副作用
- Context / Store：`useAuth()` 提供 `api` 与 `user`
- Local state：
  - `[STATE]` `packs` / `loading` / `error` / `success` — 列表与提示
  - `[STATE]` `reloading` / `reloadResult` — 重载态与结果
  - `[STATE]` `editTarget` / `editContent` / `editLoading` / `editError` — 编辑弹窗
  - `[STATE]` `showCreate` / `createId` / `createContent` / `createLoading` / `createError` — 新建弹窗
  - `[STATE]` `deleteTarget` / `deleteLoading` — 删除确认弹窗
- 副作用（订阅 / 定时器 / WS）：无；仅 `useEffect` 挂载时触发一次 `refresh`

## 8. 错误与边界
| `[EDGE]` 边界 | UI 反馈 | 备注 |
|---|---|---|
| 列表为空 | `<div className="empty-state">暂无已加载的 Pack…</div>` | 引导新建或检查 `packs/` 目录 |
| 列表加载中 | `<div className="empty-state">加载中…</div>` | `loading=true` |
| 重载失败 | alert-error 顶部展示 | reloadResult.failed 不展示（被外层 catch） |
| 重载部分失败 | alert-warning 列出每个失败 Pack 与错误 | 仅 `reloadResult.failed.length > 0` 时显示 |
| 编辑 YAML 加载失败 | 弹窗内 alert-error | 不关闭弹窗，可重试 |
| 保存失败 | 弹窗内 alert-error，按钮恢复 | editLoading 不归位由 catch 处理 |
| 删除确认弹窗外点击 | 关闭弹窗（mask onClick） | 与 closeEdit 一致 |
| 越权访问 | `<Navigate to="/forbidden" replace />` | 组件级二次守卫 |
| localStorage 不可用 | `authHeaders()` try-catch 退化到无 token | 仅 Content-Type |

## 9. 体验与一致性检查
- `[UX]` 设计语言：清新简洁（btn / alert / table / modal 类名规范），符合 GSP 苹果风设计基调，无电竞配色
- `[UX]` 移动端适配：表格使用 `.table-wrap` 外层包裹支持横向滚动；弹窗 maxWidth 800px，textarea resize vertical；未显式使用 100dvh，弹窗滚动依赖 modal-mask
- `[UX]` 与其他页面一致性：与 `/admin/maintenance`、`/admin/quotas` 共用 `page-header` / `page-actions` / `data-table` / `alert-*` 类名，视觉一致；唯一不一致处：本页未使用 `useDocumentTitle`（其他页有），浏览器标签 title 不会切换到"Pack 管理"
- `[UX]` YAML 编辑器：使用原生 textarea + monospace 字体，未引入 CodeMirror / Monaco，无语法高亮与校验

## 10. 关键实现定位（代码引用）
- 路由入口：[App.tsx#L371-L416](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/App.tsx#L371-L416)（`/admin/packs` 在 L386）
- 页面组件：[Packs.tsx](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/admin/Packs.tsx)
- 关键 hook：`useAuth`（`../../api/auth`）；`isAdminRole`（`../../utils/role`）
- API client：
  - `api.listPacks()` → [client.ts#L570-L572](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/api/client.ts#L570-L572)
  - `api.reloadPacks()` → [client.ts#L1268-L1271](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/api/client.ts#L1268-L1271)
  - 直接 fetch：[Packs.tsx#L49-L99](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/admin/Packs.tsx#L49-L99)（authHeaders / fetchPackYaml / savePackYaml / createPack / deletePack）
- 后端路由：[packs.ts](file:///home/airxw/Documents/gsp/gameserver-panel/panel/backend/src/api/routes/packs.ts)（L91/117/165/208/250/274）
- 路由挂载：[routes-registry.ts#L807](file:///home/airxw/Documents/gsp/gameserver-panel/panel/backend/src/routes-registry.ts#L807) `app.use('/api/packs', authenticateToken(JWT_SECRET), createPacksRouter(...))`

## 11. 待办与风险
- `[TODO]` 补 `useDocumentTitle('Pack 管理')` 以与其他 admin 页面保持浏览器标签一致
- `[TODO]` YAML 编辑器可升级为 CodeMirror，提供语法高亮与基础校验（当前裸 textarea 容易写错缩进）
- `[TODO]` 新建弹窗的「游戏类型」下拉目前 onChange 空函数，仅作参考提示，建议要么去掉要么真正预填到 YAML
- `[RISK]` `authHeaders()` 直接读 `localStorage.getItem('panel_token')`，绕过了 `useAuth` 的统一鉴权链路；若 token 过期不会自动刷新，PUT/POST/DELETE 可能 401 而无刷新逻辑
- `[RISK]` 删除 Pack 会永久删除 `packs/<id>/` 整个目录（后端实现），UI 仅二次确认，无 dry-run 预览；误删风险高
- `[RISK]` 重载 Pack 是全局热重载，会影响所有依赖该 Pack 的实例；UI 未提示"重载可能影响在跑实例"
- `[RISK]` `reloadResult.failed` 错误信息直接展示后端原始 error 字符串，可能泄露文件系统路径

## 梳理元数据
- 梳理日期：2026-07-26
- 梳理方式：代码阅读
