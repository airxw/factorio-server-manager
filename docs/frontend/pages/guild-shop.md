# 玩家门户：游戏商城入口（GuildShop）

- [ROUTE] `/guild/shop`（公网入口：`https://gsp.ecsrz.com:3001/guild/shop`）
- 状态：已完成（2026-07-26，重写自 2026-07-25 版）
- BUILD：`20260726-001`

## 1. 页面定位

> `/guild` 基座下的"游戏商城入口页"（玩家门户 Player Portal），用于选择一个服务器实例进入沉浸式店铺页 `/guild/servers/:id`（实际商品列表、账号绑定、下单、履约都在店铺页完成）。

该页本质是"可访问服务器列表 + 搜索 + 游戏类型筛选"，并不直接展示商品。设计为 C 端电商的"店铺索引"，移动端优先。

## 2. 入口与路由

- `[ROUTE]` 路由路径：`/guild/shop`
- 浏览器入口（公网）：`https://gsp.ecsrz.com:3001/guild/shop`
- 浏览器入口（局域网）：`https://192.168.5.14:3001/guild/shop`
- 路由注册位置：[App.tsx#L451-L462](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/App.tsx#L451-L462)
  - 父路由：`<Route path="/guild" element={<GuildLayout />}>`（L451）
  - 当前路由：`<Route path="shop" element={<GuildShop />} />`（L462）
- 旧路径重定向：`/shop` → `/guild/shop`（[App.tsx#L477](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/App.tsx#L477)）
- 进入方式：
  - 底部 5 tab 中"商城"高亮入口（[Layout.tsx#L795-L803](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/components/Layout.tsx#L795-L803)）
  - 首页 `/guild` 快捷功能入口"游戏商城"卡片（[GuildDock.tsx#L95](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/guild/GuildDock.tsx#L95)）
  - 浏览器直接输入 URL 或老书签 `/shop` 自动重定向
- 退出方式：
  - 顶部"玩家门户"品牌按钮回 `/guild` 首页
  - 点击任一服务器卡片 → 跳 `/guild/servers/:id`（沉浸式店铺页）
  - 底部 tab 跳其他 `/guild/*` 子页

## 3. 角色与权限

- 允许角色：所有已登录用户（`user` / `instance_admin` / `server_admin` / `system_admin` / `admin`）
- 守卫：外层 `<ProtectedRoute />` 包裹 `/guild` 基座（[App.tsx#L341](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/App.tsx#L341)）
- 守卫实现：[App.tsx#L136-L154](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/App.tsx#L136-L154)（`ProtectedRoute` 函数）
- 未登录行为：跳转 `/login` 携带 `state.from=/guild/shop`，登录页标题根据 `from` 变为"登录玩家门户"
- 越权行为：本页无角色门控；`listServers` 后端按角色过滤返回数据（user 角色仅返回 account 绑定 + owner 的实例，[servers.ts#L117-L160](file:///home/airxw/Documents/gsp/gameserver-panel/panel/backend/src/api/routes/servers.ts#L117-L160)），所以不同角色看到的列表长度不同

## 4. 核心功能点

- **服务器列表展示**：以卡片网格展示当前用户可访问的服务器（`ServerSummary[]`），卡片头部为蓝青渐变 Banner + 在线/离线 badge + 服务器名，底部为游戏类型图标 + 服主用户名 + "进入店铺"引导
- **关键字搜索**：支持按"服务器名称 / 游戏类型标签 / 服主用户名"模糊过滤（大小写不敏感）
- **游戏类型筛选 chips**：动态从 `servers` 聚合出 `game_type` 集合，渲染为可点击的 chip 行（含"全部"）
- **手动刷新**：右上角刷新按钮重新拉取服务器列表，loading 时按钮图标 `gp-spin` 旋转 + 禁用
- **空态引导**：
  - 无可访问服务器：圆形图标 + "还没有可访问的游戏服务器" + "去绑定角色"按钮跳 `/guild/bind`
  - 有服务器但筛选无结果：搜索图标 + "没有找到匹配的服务器" + "清除筛选"按钮一键重置 `search` 与 `activeType`
- **一键清除搜索**：搜索框右侧 `×` 按钮，仅当 `search` 非空时显示

## 5. 交互流程

1. 进入 `/guild/shop`（通过底部 tab、首页快捷入口或 URL）
2. `useEffect` 触发 `refresh()`：调 `api.listServers()` 拉取服务器列表
3. `listServers` 内部已 `validateResponse(listServersResponseSchema, ...)` 校验响应 schema；本页 try-catch 兜底，失败时 toast "加载服务器失败" + 静默回退空列表
4. `useMemo` 从 `servers` 聚合出 `gameTypes`（去重 + 排序），渲染筛选 chips
5. `useMemo` 从 `servers` + `search` + `activeType` 计算 `filtered` 列表
6. 用户操作：
   - 输入关键字：`onChange` 更新 `search`，`filtered` 实时重算
   - 点击 chip：`setActiveType(gt)` 切换筛选
   - 点击"刷新"：重新调 `listServers()`
   - 点击"×"：清空 `search`
   - 点击"清除筛选"：同时清空 `search` 与 `activeType`
7. 点击任一服务器卡片 → `navigate('/guild/servers/:id')` 进入沉浸式店铺页
8. 后续商品列表 / 账号绑定 / 下单 / 履约由 `/guild/servers/:id` 处理（参见 [guild-server-detail.md](guild-server-detail.md)）

## 6. 接口与数据

| `[API]` 接口 | 方法 | 鉴权 | 用途 | 错误码 |
|------|------|------|------|------|
| `/api/servers` | GET | JWT | 拉取服务器列表（`ServerSummary[]`，含 `id` / `name` / `game_type` / `status` / `owner_username`） | 401/500 |

> 后端 `GET /api/servers` 按角色过滤（[servers.ts#L117-L160](file:///home/airxw/Documents/gsp/gameserver-panel/panel/backend/src/api/routes/servers.ts#L117-L160)）：
> - `server_admin` → 全部实例
> - `instance_admin` → owner + `instance_admins` 关联的实例
> - `user` → 通过统一 `bindings` 表（`binding_type='account'`, `scope_type='instance'`）绑定的实例 + owner 的实例

API client 调用位置：
- `listServers`：[client.ts#L631-L634](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/api/client.ts#L631-L634)（含 `validateResponse(listServersResponseSchema, ...)` ajv 元校验）

字段使用：
- `id` — 卡片点击跳转目标 `/guild/servers/:id`
- `name` — 卡片标题 + 搜索匹配
- `game_type` — `gameLabel()` 映射为可读标签（Minecraft / Terraria / Factorio / Palworld / Rust / ARK / Valheim / Don't Starve / Enshrouded / Project Zomboid / Satisfactory），用于卡片副标题 + chip + 搜索匹配
- `status` — `'running'` 显示"在线"绿 badge，其他显示"离线"灰 badge
- `owner_username` — 卡片副标题"服主 xxx" + 搜索匹配

## 7. 状态管理与副作用

- **Context / Store**：
  - `useAuth()`（[auth.tsx](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/api/auth.tsx)）— 提供 `api`（PanelApiClient）
  - `useToast()`（[ToastContext.tsx](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/context/ToastContext.tsx)）— error 提示
- **Local state**（[GuildShop.tsx#L128-L131](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/guild/GuildShop.tsx#L128-L131)）：
  - `servers: ServerSummary[]` — 服务器列表（从 API 拉取）
  - `loading: boolean` — 加载中（控制骨架屏 + 刷新按钮禁用）
  - `search: string` — 搜索关键字（受控输入）
  - `activeType: string` — 筛选 game_type（默认 `'all'`）
- **副作用**：
  - `useEffect` mount 时调 `refresh()` 拉取 servers（依赖 `[refresh]`，`refresh` 由 `useCallback([api, toast])` 稳定）
  - `useMemo([servers])` 计算 `gameTypes`（去重 + sort）
  - `useMemo([servers, search, activeType])` 计算 `filtered`
- **`[STATE]` 关键派生**：
  - `gameTypes.length > 0` 才渲染 chips 行
  - `loading` 优先级最高（骨架屏 3 个占位卡片）；非 loading 时按 `filtered.length` 与 `servers.length` 分支选择渲染内容

## 8. 错误与边界

| `[EDGE]` 边界 | UI 反馈 | 备注 |
|------|------|------|
| 未登录访问 `/guild/shop` | 重定向 `/login?from=/guild/shop` | `ProtectedRoute` 守卫，所有 `/guild/*` 共享 |
| `listServers` 失败 | `.catch(() => ({ servers: [] }))` 静默回退空列表 → 渲染"还没有可访问的游戏服务器"空态 | 本页 try-catch 实际很少命中（API 已内部 catch） |
| `listServers` 抛非 catch 异常 | toast.error 展示 `err.message` 或"加载服务器失败" | `loading=false`，渲染空态 |
| 用户无可访问服务器 | 圆形图标 + "还没有可访问的游戏服务器" + "去绑定角色"按钮跳 `/guild/bind` | 与"筛选无结果"空态区分 |
| 有服务器但筛选无结果 | 搜索图标 + "没有找到匹配的服务器" + "清除筛选"按钮 | 一键重置 `search=''` + `activeType='all'` |
| 搜索关键字大小写 | `q = search.trim().toLowerCase()` + `s.name.toLowerCase().includes(q)` | 大小写不敏感 |
| `game_type` 未在 `GAME_TYPE_LABEL` 中 | `gameLabel()` 返回原 `gt` 字符串 | 兜底显示原始 game_type |
| `owner_username` 缺失 | `s.owner_username ?? ''` + `server.owner_username ? ` · 服主 ${} ` : ''` | 不显示"服主"段落 |
| `status !== 'running'` | 显示"离线"灰 badge（`rgba(0,0,0,0.3)` + 白字） | 与"在线"绿 badge 区分 |
| 进入店铺后处理"未绑定账号/不可购买" | 由 `/guild/servers/:id` 处理 | 本页不校验，仅做导航 |

## 9. 体验与一致性检查

- `[UX]` 设计语言：Apple 浅色清新风（gp-theme），主色 `--gp-blue` + `--gp-cyan` 渐变 Banner；卡片用 `gp-card gp-card-hover` 类，圆角 20px，无深色电竞配色；搜索框用 `gp-card` 包裹输入框 + 圆角 14px；筛选 chips 用 `gp-chips` + `gp-chip` 类
- `[UX]` 移动端适配：卡片网格用 `repeat(auto-fill, minmax(280px, 1fr))`，移动端单列；搜索框 + 刷新按钮 `flex` 布局，窄屏自适应；底部 5 tab 常驻（"商城"高亮）
- `[UX]` 视觉层级：标题"游戏商城" + 副标题"选择服务器进入对应店铺购买道具、VIP和礼包" → 搜索 + 刷新 → 筛选 chips → 卡片网格 → 空态
- `[UX]` 一致性：与 `/guild/servers` 共享 `ServerSummary` 类型与卡片视觉；`useDocumentTitle('游戏商城')` 设置标签页标题，离开时恢复默认；卡片在线/离线 badge 与首页 `ServerChip` 状态点保持一致语义
- `[UX]` 可访问性：搜索框 `aria-label="清除搜索"`；刷新按钮 `aria-label="刷新"` + `disabled={loading}`；卡片为 `<button type="button">`，键盘可达
- `[UX]` 待改进：
  - 卡片 Banner 高度固定 90px + 服务器名 16px + textShadow，长服务器名可能溢出（无 `text-overflow: ellipsis`）
  - 筛选 chips 在窄屏可能换行，但未设置 `overflow-x: auto`，会挤占卡片空间
  - 搜索框无防抖，每次按键触发 `setSearch` → `useMemo` 重算，大量数据时可能卡顿（实际 servers 量级 <100，影响可忽略）
  - 无"最近访问"/"收藏"排序，纯按后端 `created_at asc` 顺序展示

## 10. 关键实现定位（代码引用）

- 路由入口：[App.tsx#L451-L462](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/App.tsx#L451-L462)（`/guild` 基座 → `shop` 子路由）
- 旧路径重定向 `/shop` → `/guild/shop`：[App.tsx#L477](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/App.tsx#L477)
- 登录守卫：[App.tsx#L136-L154](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/App.tsx#L136-L154)（`ProtectedRoute` 函数）
- 页面组件：[GuildShop.tsx](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/guild/GuildShop.tsx)
- 子组件（同文件内）：`ServerShopCard`（[L43-L120](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/guild/GuildShop.tsx#L43-L120)）
- 工具函数：`gameLabel()`（[L39-L41](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/guild/GuildShop.tsx#L39-L41)）+ `GAME_TYPE_LABEL` 常量（[L25-L37](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/guild/GuildShop.tsx#L25-L37)）
- Layout（player variant）：[GuildLayout.tsx](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/layouts/GuildLayout.tsx) + [Layout.tsx#L795-L995](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/components/Layout.tsx#L795-L995)
- 底部 5 tab 配置：[Layout.tsx#L795-L803](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/components/Layout.tsx#L795-L803)
- API client：[client.ts#L631-L634](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/api/client.ts#L631-L634)（`listServers` 含 ajv 校验）
- 鉴权 Context：[auth.tsx](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/api/auth.tsx)
- Toast：[ToastContext.tsx](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/context/ToastContext.tsx)
- 文档标题 hook：[useDocumentTitle.ts](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/hooks/useDocumentTitle.ts)
- 后端 `GET /api/servers`（按角色过滤）：[servers.ts#L117-L160](file:///home/airxw/Documents/gsp/gameserver-panel/panel/backend/src/api/routes/servers.ts#L117-L160)
- 下一页（店铺详情）：[guild-server-detail.md](guild-server-detail.md) / [guild-server-shop.md](guild-server-shop.md)
- BUILD 常量来源：[buildInfo.ts](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/buildInfo.ts)

## 11. 待办与风险

- `[RISK]` **`api.listServers()` 内部 catch 后回退空列表，本页 try-catch 实际不会命中**：[GuildShop.tsx#L136](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/guild/GuildShop.tsx#L136) `.catch(() => ({ servers: [] }))` 在 API 层已吞错，本页 `try { ... } catch (err) { toast.error(...) }` 永远不会触发 toast；用户看到的是"空态"而非"加载失败"提示 — 建议移除 API 层 catch 或本页改用 `Promise.allSettled` 模式区分"成功空列表"与"加载失败"
- `[RISK]` **`listServers` 对 user 角色的语义可能误导**：后端返回 account 绑定 + owner 的实例，但页面标题为"游戏商城"，用户期望看到"可购买商品的店铺"；若用户绑定了一个未配置店铺（`shop-config` 未启用）的实例，进入 `/guild/servers/:id` 后会看到空店铺 — 建议后端补 `has_shop` 字段或前端在卡片上标识"店铺已开张"
- `[RISK]` **`GAME_TYPE_LABEL` 硬编码在前端**：[GuildShop.tsx#L25-L37](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/guild/GuildShop.tsx#L25-L37) 列出 11 种游戏类型，但后端可能新增 pack 支持新游戏类型，前端无法自动发现 — 建议从 `/api/packs` 或 `public/schema/pack-schema.ts` 派生
- `[RISK]` **无服务端分页/搜索**：用户绑定大量实例时（10+），全量加载 + 前端过滤；当前量级可接受，但未来扩展需改服务端分页（参考 v4.26.0 B5 Users 页改造模式）
- `[RISK]` **卡片 Banner 长名称溢出**：[GuildShop.tsx#L86-L88](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/guild/GuildShop.tsx#L86-L88) 服务器名 `fontSize: 16, fontWeight: 700`，无 `overflow: hidden` / `text-overflow: ellipsis`，长名会撑破 Banner
- `[RISK]` **筛选 chips 窄屏换行无横向滚动**：`gp-chips` 类未设置 `overflow-x: auto`，game_type 多时会挤占卡片网格空间
- `[RISK]` **刷新按钮在 loading 时禁用，但首次加载时 also disabled**：用户在首次加载期间无法取消请求；考虑改为"始终可点击，loading 时显示 spinner"
- `[TODO]` 后端 `GET /api/servers` 响应增加 `has_shop` / `shop_enabled` 字段，前端卡片标识"店铺已开张"
- `[TODO]` `GAME_TYPE_LABEL` 改为从 `/api/packs` 或公共 schema 派生，避免新游戏类型遗漏
- `[TODO]` 卡片 Banner 服务器名加 `overflow: hidden; text-overflow: ellipsis; white-space: nowrap`
- `[TODO]` `.gp-chips` CSS 加 `overflow-x: auto; flex-wrap: nowrap`（或评估是否换行更友好）
- `[TODO]` 浏览器核对：登录 `https://gsp.ecsrz.com:3001/guild/shop` 验证搜索、筛选、刷新、空态、卡片点击的实际 UI 行为
- `[TODO]` 评估是否补"最近访问"/"收藏"排序，提升 C 端电商体验

---

## 梳理元数据

- 梳理日期：2026-07-26（重写自 2026-07-25 版，修复原版章节错位）
- 梳理方式：代码阅读（未做浏览器核对）
- 代码版本：v4.26.0（GuildShop 自 v4.12.0 迁入后未做大改）
- 浏览器版本/截图：见 [logs/2026-07-26.md](../logs/2026-07-26.md)
- 变更点：原版（2026-07-25）章节顺序错位（"## 4. 核心功能点"为空、"## 5. 交互流程"含核心功能、"## 6. 接口与数据"含交互流程、"## 7. 状态管理与副作用"含接口、"## 8. 错误与边界"含状态、"## 9. 体验与一致性检查"含错误边界、"## 10. 关键实现定位"含 UX、"## 11. 待办与风险"含代码引用），本次重写按 11 节强制字段顺序对齐
