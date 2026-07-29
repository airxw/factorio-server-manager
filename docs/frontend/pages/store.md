# 页面定位
GM Workbench (服主工作台) 基座首页，作为服主/管理员登录后的仪表盘大盘，提供营收报表、告警信息、实例列表以及运营管理的快捷入口。

# 入口与路由
- 路由: `[ROUTE]` `/store`
- 上游入口:
  - 角色鉴权后通过 `/` 根路由 (`RootRedirect`) 自动重定向。
  - 用户在导航栏手动点击“服主工作台”。

# 角色与权限
- 允许访问的角色: `instance_admin`, `server_admin`, `system_admin`, `admin`
- 权限不足的表现: 渲染 `<Forbidden />` 组件（或 403 页面）。

# 核心功能点
1. **全局大盘监控**: 展示 KPI 核心指标（总实例、在线人数、今日/30天收入、待处理事项）。
2. **趋势图表**: 渲染近 7 天营收走势的微缩面积折线图 (`MiniRevenueChart`)。
3. **告警聚合**: 右侧区域列表展示系统的警告与错误类型告警，方便服主处理。
4. **快捷导航**: 底部提供商城管理、VIP管理、流水报表等常用功能的宫格导航。
5. **实例快速预览**: 展示最近的最多 5 个实例列表，带呼吸灯效果展示运行状态。

# 交互流程
1. **初始化数据加载**: 页面挂载时并发请求 `getOperationsOverview`, `getOperationsRevenue`, `listStoreServers`。
2. **手动刷新大盘**: 用户点击右上角“刷新”图标按钮，按钮执行旋转动画，重新并发请求上述接口。
3. **导航穿透**:
   - 点击“我的实例”列表中的单行，带 `id` 路由到 `/store/servers/:id`。
   - 点击 KPI 卡片或底部宫格，跳转至对应工作台子页面。
   - 点击顶部“创建实例”，跳转至 `/instances/new`。

# 接口与数据
- `[API]` `GET` `/api/store/operations/overview` - 获取操作大盘概览（KPI + 告警列表）
  - 权限要求: instance_admin+
- `[API]` `GET` `/api/store/operations/revenue?days=7` - 获取营收报表趋势
  - 权限要求: instance_admin+
- `[API]` `GET` `/api/store/servers` - 获取当前服主的实例列表
  - 权限要求: instance_admin+

# 状态管理与副作用
- `[STATE]` 加载状态: 初始挂载和刷新时，分别呈现全屏/局部骨架屏，或图标 Loading 动画 (`animate-spin`)。
- `[STATE]` 空状态: 如果没有营收数据，展示“暂无收入数据”；如果没有实例，列表置空展示。
- `[STATE]` 局部失败处理: `getOperationsRevenue()` 与 `listStoreServers()` 在并发请求中被 `catch(() => ({ points: [] }))` / `catch(() => ({ servers: [] }))` 吞掉，失败会被伪装成“无数据”。

# 错误与边界
- `[EDGE]` 后端接口请求失败 (如 502/401): 页面目前在 catch 逻辑中静默返回 `[]` 或兜底默认值，导致 UI 显示空数据而非明确的错误提示（体验割裂风险）。
- `[EDGE]` 实例数过多: 仅截取前 5 个展示 `slice(0, 5)`，目前无“查看更多”交互反馈。
- `[EDGE]` 动态路由导航高亮错误: `/store/servers/:id` 实际会落到 `/store` 的激活态，实例详情页侧栏仍高亮“工作台首页”，而不是“我的实例”。

# 体验与一致性检查
- `[UX]` 视觉语言不统一: `/store` 首页大量使用 `bg-zinc-900/40~60` 深色卡片与彩色渐变图标，而共享 `Layout` 的侧栏是浅色 (`#F5F5F7`)；进入二级页后又复用白底卡片 (`bg-white`) 的旧页面实现，导致首页、壳层、子页三套视觉系统并存。
- `[UX]` 信息层级偏弱: KPI 卡、趋势卡、实例卡、快捷入口卡大多都落在接近的深灰底与细边框上，更多依赖布局位置而不是颜色/阴影/体量来区分优先级，首屏扫描成本偏高。
- `[UX]` 首页入口的可点击感不足: 浏览器审查时，实例卡与快捷入口虽然本质是 `button`，但运行时观察到光标反馈弱、hover 主要靠轻微边框变化，不足以让用户迅速识别“这是可操作入口”。
- `[UX]` 页面标题体系不统一: `StoreHome`、`Players`、`ReportsRevenue` 等有 `useDocumentTitle()`，但 `CommercialAdminIndex` 与 `InstanceVipUsers` 缺少同类逻辑，浏览器标签页会退回成通用 `GameServer Panel`。
- `[UX]` 页面问候语通过 `useMemo` 计算（如“早上好”），如果用户长期挂机，问候语不会随时间动态变更。
- `[UX]` 实例列表的 `running` 状态使用 `animate-pulse`，若数量过多会导致页面存在大量闪烁点，产生视觉噪点。
- `[UX]` `MiniRevenueChart` SVG 缩放问题：硬编码了宽高比并使用 `preserveAspectRatio="none"`，在超宽显示器下折线可能产生扭曲。
- `[UX]` 加载态与正式态存在命名/层级跳变: 真实浏览器巡检中，首屏会先看到通用工作台文案，再切换到“服主工作台”完整内容，页面语义稳定性不足。

# 关键实现定位（代码引用）
- 路由配置: [App.tsx:L421-L445](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/App.tsx#L421-L445)
- 基座组件: [StoreLayout.tsx](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/layouts/StoreLayout.tsx)
- 页面组件: [StoreHome.tsx](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/store/StoreHome.tsx)
- 激活态映射与判定: [Layout.tsx:L221-L285](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/components/Layout.tsx#L221-L285), [Layout.tsx:L774-L808](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/components/Layout.tsx#L774-L808)
- 首页视觉骨架: [StoreHome.tsx:L24-L191](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/store/StoreHome.tsx#L24-L191), [StoreHome.tsx:L195-L455](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/store/StoreHome.tsx#L195-L455)
- 共享侧栏样式: [styles.css:L2108-L2268](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/styles.css#L2108-L2268)
- 缺少页面标题的二级页: [index.tsx](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/admin/commercial/index.tsx), [InstanceVipUsers.tsx](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/admin/InstanceVipUsers.tsx)

# 待办与风险
- `[TODO]` 统一 `/store` 基座的视觉语言，至少先决定“浅色工作台”还是“深色运营大盘”为主，不要让首页深色、侧栏浅色、二级页白卡片同时存在。
- `[TODO]` 修复 `PATH_ACTIVE_MAP` 对动态路由的判定逻辑，确保 `/store/servers/:id` 归属“我的实例”，而不是被 `/store` 前缀误吞。
- `[TODO]` 给 `CommercialAdminIndex`、`InstanceVipUsers` 等迁入页补齐 `useDocumentTitle()`，统一浏览器标签和历史记录语义。
- `[TODO]` 强化主要入口的可点击反馈，至少统一 `cursor`、hover elevation、focus-visible 和 active press state。
- `[TODO]` 修复 API 失败时的静默吞没问题，为数据区块添加明确的 `isError` 状态和错误占位。
- `[TODO]` 修改顶部“创建实例”的路由走向，避免用户点击后脱离 `/store` 路由基座上下文（目前跳转 `/instances/new` 属于 default Layout）。
- `[TODO]` 为被 `slice(0, 5)` 截断的实例列表增加“查看更多”的提示。
- `[RISK]` 当前 `/store` 子页大量复用旧页面实现，如果直接局部美化首页而不统一子页样式，后续会继续出现“首页像新系统、详情页像旧后台”的割裂感。
- `[RISK]` 长期挂机场景下，可能因为 Token 过期或定时轮询（如果有的话）导致意外的 401 登出。
