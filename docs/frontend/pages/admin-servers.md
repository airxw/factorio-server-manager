# 实例管理 · 服务器列表页（/admin/servers）

> 梳理日期：2026-07-30 ｜ 核对方式：内置浏览器（生产 https://gsp.ecsrz.com:3001）+ 代码静态审查

## 1. 页面定位

全平台实例（游戏服务器）管理列表，是 `server_admin` / `instance_admin` 日常运维的主入口之一：搜索、筛选、排序、批量生命周期操作（启动/停止/重启/备份/删除）、导出 CSV、查看配额。桌面端为 11 列数据表，移动端（≤768px）切换为卡片列表。

## 2. 入口与路由

- [ROUTE] `/admin/servers`（AdminLayout 基座，index 路由渲染 `Servers` 组件）
- [ROUTE] 侧边栏入口「部署节点 → 实例管理」→ `/admin/servers`
- [ROUTE] 行点击跳转 `/instances/:id`，由 RootRedirect 按角色二次分流到 `/admin/servers/:id`
- [ROUTE] URL query 状态化：`?q=&status=&sort=&order=&page=`（replace 模式）

## 3. 角色与权限

| 角色 | 可见性差异 |
|---|---|
| `server_admin`/`system_admin`/`admin` | 全部实例；显示归属者列、复选框、批量操作；不加载配额条 |
| `instance_admin` | 仅自己拥有/共管的实例（后端过滤）；显示配额条 |
| `user` | 隐藏归属者列、复选框、批量操作；显示配额条 |

路由守卫：`RequireRole allow={['instance_admin','server_admin','system_admin','admin']}`。

## 4. 核心功能点

1. 列表展示：名称/游戏/状态徽章/游戏端口/RCON 端口/归属者/部署节点/磁盘占用（>10GB 加粗橙警示）/有效期（临期≤3天橙色）/创建时间
2. 搜索（名称或 ID，客户端过滤）+ `/` 快捷键聚焦搜索框
3. 状态筛选（全部/运行中/已停止/错误）
4. 排序（名称/状态/创建时间，点列表头切换升降序）
5. 客户端分页（20 条/页）
6. 批量操作：启动/停止/重启/备份/删除（useConfirm 确认，batch API + 失败明细 Toast）
7. 单实例操作：详情/启动/停止/删除（删除需输入实例名二次确认 + 撤销 Toast）
8. 导出 CSV（当前筛选结果，含 BOM）
9. 配额进度条（实例数 + 磁盘，instance_admin/user）
10. 刷新按钮 + 乐观更新（TanStack Query）

## 5. 交互流程

- 进入 → TanStack Query 拉列表 → 骨架屏 → 渲染表格（桌面）/卡片（移动）
- 搜索/筛选/排序/翻页 → 全部同步 URL query（replace），可分享链接
- 删除：点击删除 → ConfirmDialog 输入实例名 → 执行 → 撤销 Toast（best-effort）
- 批量：勾选 → 顶部 batch-bar 出现 → 确认 → batch API → 成功/失败明细 Toast → 清空选择 + refetch

## 6. 接口与数据

- [API] `GET /api/servers`（useServers，JWT）
- [API] `POST /api/servers/:id/start|stop` / `DELETE /api/servers/:id`
- [API] `POST /api/servers/batch/start|stop|restart|backup`（BatchActionRequest/Response）
- [API] `GET /api/quota/me`（instance_admin/user，失败静默）
- 类型：`ServerSummary`（@public/schema/panel-api-types）、`InstanceState`（daemon-api-types）

## 7. 状态管理与副作用

- [STATE] 加载中：`ListSkeleton rows=6`
- [STATE] 空态：无实例（引导创建）/ 无匹配结果（筛选后）
- [STATE] 错误：`alert alert-error` 条（合并查询错误与本地操作错误）
- [STATE] 行操作中：`actioningId` 禁用该行按钮；批量：`batchActioning`
- URL query 为单一真相源（q/status/sort/order/page），选择集为本地临时状态

## 8. 错误与边界

- [EDGE] 删除非 stopped 实例 → 后端 `INVALID_SERVER_STATE` → 映射「仅 stopped 状态可删除」
- [EDGE] 批量部分失败 → Toast 展开失败明细（instance_id + message）
- [EDGE] 页码越界 → `safePage` 钳制到 totalPages
- [EDGE] 配额接口失败静默，不影响主列表
- [EDGE] 撤销 Toast 恢复失败（已永久删除）→ warning 提示

## 9. 体验与一致性检查（美学 + 移动端诊断）

> 诊断依据：styles.css 静态审查 + 桌面端浏览器核对（移动端视口工具无法模拟，以下移动端结论来自 CSS 推断，需真机复核）。

### 9.1 美学问题（Apple 清新浅色基调下）

- [UX] **断点体系混乱**：styles.css 共存 480/520/600/640/768/900/1024px 共 7+ 个断点，无统一 token，维护困难
- [UX] **硬编码颜色与 CSS 变量混用**：如 `#f8fafc`/`#cbd5e1`（server-card hover）、`#f5f5f7`（表头）、`#dcfce7/#166534`（conn-on）、`#ff3b30`（batch-result-error）散写；`var(--color-primary, #2563eb)` 带 fallback 说明变量可能未定义，无双轨保障
- [UX] **圆角不统一**：`--radius`（卡片）/ 16px（info-card、console-card）/ 999px（pill、徽章）/ 8px（续费明细 inline）/ 6px（配额条 inline）
- [UX] **inline style 泛滥**：配额条整体、续费明细列表、排序图标、有效期颜色均 inline 在 TSX，绕过样式体系
- [UX] **深色终端 `.terminal`（#0a0e14 + #4ade80 绿字）**：控制台场景属行业惯例可保留，但与 Apple 浅色基调对比强烈，属方向性决策点（见待办 D5）
- [UX] **表头英文大写风格**（`text-transform: uppercase; letter-spacing: 0.4px`）对中文无效且字距让中文表头松散
- [UX] **行操作按钮依赖 hover 显现**（`.row-actions` opacity），触屏笔记本/平板无 hover 时不可发现

### 9.2 移动端兼容性问题（≤768px）

- [UX] **触摸目标不足**：媒体查询仅保证 `.btn ≥40px`、`.btn-sm ≥36px`，低于 Apple HIG 44px 推荐
- [UX] **详情页移动端 tab 打平**：`isMobileTabView` 时丢弃 2 级分组，~12 个 tab 全部平铺进 `mobile-tab-scroller` 横向滚动，组语义丢失、定位困难
- [UX] **批量操作栏（batch-bar）移动端堆叠**：6 个按钮 + 计数在 375px 下换行 3+ 行，占用首屏；项目已有 `.batch-toolbar` 底部固定方案（其他页用）却未复用到本页
- [UX] **配额条 inline 固定 200px 进度条**：375px 视口下「标签 + 数值 + 200px 条」组合拥挤，靠 flex-wrap 兜底
- [UX] **工具栏堆叠**：搜索框（max-width 320px）+ 状态下拉 + 「共 N 条」+ 导出按钮在 375px 换行 2-3 行，间距无移动端专属规则
- [UX] **详情页头部操作区**：返回/标题 + 启动/停止/保存/刷新/业务运营/删除 6+ 按钮 wrap 多行，挤压首屏（信息卡默认折叠已缓解部分）
- [UX] **useSwipe 与纵向滚动共存**：虽有「水平分量 > 垂直分量」守卫，但绑定在整个 tab 内容区，控制台日志等滚动容器内斜向滑动可能误切 tab
- [RISK] **移动端真实渲染未经真机/模拟器验证**：浏览器工具无法缩放视口，卡片布局/横滑/溢出需 375×812 复核

## 10. 关键实现定位（代码引用）

- 路由注册：[App.tsx:L510-L515](file:///home/airxw/gsp/panel/frontend/src/App.tsx#L510-L515)
- 列表页组件：[Servers.tsx](file:///home/airxw/gsp/panel/frontend/src/pages/Servers.tsx)
- 桌面表格段：[Servers.tsx:L633-L817](file:///home/airxw/gsp/panel/frontend/src/pages/Servers.tsx#L633-L817)
- 移动卡片段：[Servers.tsx:L819-L899](file:///home/airxw/gsp/panel/frontend/src/pages/Servers.tsx#L819-L899)
- 配额条（inline style）：[Servers.tsx:L523-L565](file:///home/airxw/gsp/panel/frontend/src/pages/Servers.tsx#L523-L565)
- 显隐控制与卡片样式：[styles.css:L4214-L4368](file:///home/airxw/gsp/panel/frontend/src/styles.css#L4214-L4368)
- 表格样式：[styles.css:L1097-L1163](file:///home/airxw/gsp/panel/frontend/src/styles.css#L1097-L1163)
- 批量栏样式：[styles.css:L1165-L1193](file:///home/airxw/gsp/panel/frontend/src/styles.css#L1165-L1193)
- 角色分流：[App.tsx:L281-L303](file:///home/airxw/gsp/panel/frontend/src/App.tsx#L281-L303)

## 11. 待办与风险

- [TODO] D1：统一断点 token（建议 640/768/1024 三档）并收敛媒体查询
- [TODO] D2：颜色/圆角/间距全部收编 CSS 变量，消灭 inline style 与硬编码 hex
- [TODO] D3：触摸目标全员 ≥44px（btn-sm、tab-btn、checkbox 加大热区）
- [TODO] D4：移动端 tab 恢复分组（分组 pill 横滑 + 组内 tab 横滑两层）或改底部 sheet 选择器
- [TODO] D5：决策终端配色方向（保留深色终端惯例 / 改浅色终端贴合 Apple 风）
- [TODO] D6：batch-bar 移动端复用 `.batch-toolbar` 底部固定模式
- [TODO] D7：表头中文场景去掉 uppercase/letter-spacing
- [TODO] D8：375×812 视口真机/模拟器复核（卡片、横滑、溢出、分页）
- [RISK] 样式体系为全局 styles.css 单文件 6900+ 行，改动波及全站，需分波次 + 三重闸门（单测→内置浏览器→Mock 回归）
