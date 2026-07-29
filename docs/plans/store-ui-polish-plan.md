---
type: plan
title: /store 服主工作台整体前端风格统一方案
date: 2026-07-28
status: draft
supersedes: 原「三页 UI 优化」草案（同路径覆盖）
related:
  - panel/frontend/src/layouts/StoreLayout.tsx
  - panel/frontend/src/pages/store/components/WorkbenchUI.tsx
  - panel/frontend/src/pages/store/StoreHome.tsx
  - panel/frontend/src/pages/admin/OperationsDashboard.tsx
  - panel/frontend/src/components/Layout.tsx
  - docs/frontend/pages/store.md
  - docs/plans/light-apple-style-redesign.md
tags: [frontend, design, store, workbench, apple-style, unification]
---

# /store 服主工作台整体前端风格统一方案

> **范围变更说明**：不再只做流水 / 时长 / 实例三页；目标是 **整个 `/store` 基座**（GM Workbench / 服主工作台）视觉与交互语言统一。  
> **设计基线**：浅色 Apple 生产力风 + 已存在的 [WorkbenchUI.tsx](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/store/components/WorkbenchUI.tsx) 组件体系；对齐 [light-apple-style-redesign.md](file:///home/airxw/Documents/gsp/gameserver-panel/docs/plans/light-apple-style-redesign.md) §2.2。  
> **约束**：只输出执行步骤、开发事项与建议；不估工期、不排人力优先级。本方案以**前端呈现与信息架构统一**为主，默认不改 API 契约。

---

## 0. 工程过程 / 交接状态 / 最终结果

### 工程过程
1. 用户确认：仅三页不够，需 `/store` **整体**风格统一。
2. 盘点 `App.tsx` 中 `/store` 路由树、侧栏导航、`StoreLayout`、`WorkbenchUI` 使用面。
3. 对照 `docs/frontend/pages/store.md` 已记录的「首页 / 壳层 / 子页三套视觉」债。
4. 用本文件**覆盖**原三页草案，升级为基座级方案。

### 交接状态
- 当前：基座级方案已落盘，**未开始编码**。
- 权威文件：本路径 `docs/plans/store-ui-polish-plan.md`。
- 下一动作：人类确认方向后，按 §5 分波实施（先壳与组件，再迁子页）。

### 最终结果（方案阶段）
- 产出：本 MD。
- 验证：IDE 可打开上述路径；内容覆盖全路由清单而非仅三页。

---

## 1. 结论（先说清楚）

`/store` 不是「几个报表页丑」，而是 **同一基座里两套（实际多套）前端语言并存**：

| 层级 | 现状 | 代表 |
|------|------|------|
| 壳层 | `Layout variant="store"` 浅色侧栏 | [StoreLayout.tsx](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/layouts/StoreLayout.tsx) → [Layout.tsx](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/components/Layout.tsx) |
| 新工作台语言 | `WorkbenchShell/Header/Metric/Section/Empty` | [StoreHome](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/store/StoreHome.tsx)、[OperationsDashboard](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/admin/OperationsDashboard.tsx) |
| 旧后台脚手架 | `p-4` + daisyUI `btn/select/stats/card/alert` + `data-table` | 报表、玩家、实例列表、店铺配置等 |
| 迁入/复用页 | admin 商业化、VIP、通用 ServerDetail、Versions 等 | 各自遗留样式，未接 Workbench 壳 |

**统一策略（定稿建议）**：

1. **以 WorkbenchUI 为唯一页面骨架语言**（已在首页与运营仪表盘验证），全 `/store` 子页迁入，禁止再新增 daisyUI 裸拼页面。  
2. **壳层（侧栏/顶栏/移动底栏）只做对齐与激活态修正**，不另起第三套主题。  
3. **语义色克制**：主 CTA 统一 iOS/工作台蓝或已用的 violet 主按钮二选一并全基座锁定（见 §3.2 待确认项）；状态用浅底深字徽章。  
4. **功能逻辑与 API 尽量不动**；先换壳、再换表/卡/空态，最后细调图表与密度。

---

## 2. `/store` 路由与风格现状全表

> 路由来源：[App.tsx](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/App.tsx) `/store` 段；导航来源 `Layout.tsx` STORE 导航组。

| 路由 | 组件 | 当前风格族 | 统一优先级建议 |
|------|------|------------|----------------|
| `/store` | `StoreHome` | **Workbench**（较完整） | 标杆；小修 token/可点击感 |
| `/store/operations` | `OperationsDashboard` | **Workbench** | 标杆；与首页图表/筛选对齐 |
| `/store/reports/revenue` | `ReportsRevenue` | 旧 daisy 脚手架 | 高：报表同构 |
| `/store/reports/playtime` | `ReportsPlaytime` | 旧 daisy 脚手架 | 高：与流水同壳 |
| `/store/servers` | `Servers` | 旧 card 网格 | 高：列表/卡规范 |
| `/store/players` | `Players` | 旧表 + Modal | 高：CRM 高频 |
| `/store/commercial` | `CommercialAdminIndex` | 迁入 admin 商业化 UI | 高：商城主路径 |
| `/store/commercial/:instanceId` | 同上 | 同上 | 高 |
| `/store/instance-vip` | `InstanceVipUsers` | admin 遗留 | 中高 |
| `/store/servers/:id` | `ServerDetailStore` → 懒加载 `ServerDetail` + 经济配置卡 | 通用详情 + 局部新卡 | 中：信息架构重，分步 |
| `/store/servers/:id/shop-config` | `ShopConfigEditor` | 旧表单页 | 中 |
| `/store/servers/new` | `CreateServer` | 通用创建流 | 中：出口应留在 store 语境 |
| `/store/versions` | `VersionsPage` | 原 guild/通用页迁入 | 中 |
| `/store/profile*` `/store/notifications` | 共享个人中心/通知 | 跨基座页 | 低～中：只保证 padding/标题不跳戏 |
| 重定向残留 | `/admin/commercial` 等 → store | — | 不改功能，只保证落点页已统一 |

侧栏信息架构（已有，统一时勿打乱 IA，只统一视觉）：

- 店铺运营：商城管理、运营仪表盘  
- 玩家管理：玩家列表、VIP 管理  
- 数据报表：流水、时长  
- 实例运营：我的实例、版本管理  

---

## 3. 统一设计系统（Store Workbench DS）

### 3.1 已有资产（必须复用，禁止平行再造）

[WorkbenchUI.tsx](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/store/components/WorkbenchUI.tsx) 已提供：

- `WorkbenchShell` — 页级 `space-y-6`  
- `WorkbenchHeader` — eyebrow / 大标题 / 描述 / actions / badges  
- `WorkbenchMetricCard` — KPI  
- `WorkbenchSection` — 白卡分区  
- `WorkbenchEmpty` / `WorkbenchChip` / `WorkbenchLinkAction`  
- `Tone`: blue | violet | emerald | amber | rose | slate  

**扩展（建议在同文件或 `components/workbench/` 增补，仍属同一 DS）**：

| 扩展件 | 用途 |
|--------|------|
| `WorkbenchFilterBar` | 实例选择、天数 segmented、搜索、状态筛选 |
| `WorkbenchDataTable` 外观封装 | 表头字号、行高、hover、tabular-nums；可包现有 `DataTable` |
| `WorkbenchStatusBadge` | 实例/玩家状态浅底深字（抽自 StoreHome `StatusBadge`） |
| `WorkbenchChartFrame` | 图表标题+图例+hover 浮层槽 |
| `WorkbenchPageSkeleton` | 与成稿同构的骨架（Header+KPI+双栏） |
| `WorkbenchPrimaryButton` / `SecondaryButton` | 锁定圆角 full、主次样式，消灭 `btn btn-ghost` 混用 |
| `useStoreInstanceSelector` | 报表/玩家/商业化共用拉实例列表 |

### 3.2 视觉 Token（与全站浅色方案对齐，并锁定 Workbench 现状）

```text
页面节奏：    Shell space-y-6；内容区跟随 Layout 主栏，避免每页再套冲突 p-4
表面：        白/半白卡 rounded-[24px~28px]；细 border-slate-200/80；弥散阴影（已有 shadow 公式）
文字：        标题 tracking-tight slate-900；说明 slate-500 text-sm leading-6/7
KPI：         text-3xl semibold tabular-nums
主操作：      rounded-full 填充按钮（全基座统一一种主色——见下方待确认）
次操作：      rounded-full border 白底
筛选：        放入 FilterBar 白卡，禁止裸 select 悬空
表格：        行高约 44px；表头 xs + 宽 tracking；金额/时长右齐 + tabular-nums
状态：        仅徽章小面积用色；禁止大面积 warning 黄当品牌色
禁止：        深色电竞大盘回潮；子页再引入第二套「stats 组件墙」
```

**待人类确认的一处产品选择（实施前锁定）**：

- **A（推荐）**：主 CTA 统一为 **violet**（与当前 StoreHome「创建实例」一致），强调色蓝/绿仅用于数据语义。  
- **B**：主 CTA 统一为 **iOS 蓝 #007AFF**（与 light-apple 文档一致），首页按钮一并改蓝。  

未确认前，实现波次以 **不扩大色系** 为原则：新页跟随 StoreHome 现用 violet 主按钮。

### 3.3 页面骨架（所有 store 业务页强制）

```text
WorkbenchShell
  ├─ WorkbenchHeader（标题/描述/主次按钮/可选 badges）
  ├─ WorkbenchFilterBar（若有筛选；可无）
  ├─ KPI 行 WorkbenchMetricCard × 0~4（列表页可 0）
  ├─ 主区：WorkbenchSection（图 / 表 / 卡网格 / 表单）
  └─ 次区：可选第二 Section
```

空 / 载 / 错：

- 载：`WorkbenchPageSkeleton` 或分区 pulse 卡（禁止只有两行 Skeleton 文字条）  
- 错：`WorkbenchEmpty` + 重试，tone=rose  
- 空：说明 + 可选 CTA（创建实例 / 去商城等）

### 3.4 壳层（Layout）统一事项

- 侧栏组标题、激活态、图标尺寸与内容区圆角语言一致（已有 store 导航，做视觉校对）。  
- 修复动态路由激活：`/store/servers/:id` 应高亮「我的实例」（Layout 已有 PATH 映射，需回归验证；store.md 曾记误吞问题）。  
- 移动底栏 store 五项与侧栏 IA 不打架。  
- 主内容区背景保持浅灰，避免首页自绘深色与壳冲突（若 StoreHome 仍有历史深色残留类，清掉）。  
- Footer BUILD 仅底部一处（全局规则），store 子页不得再插 BUILD。

---

## 4. 分域改造要点

### 4.1 标杆页（已 Workbench）— 校准而非重做

**StoreHome**  
- 保持现结构；统一主按钮色决策；强化入口 hover/focus；实例「查看更多」若仍 `slice(0,5)` 则补链到 `/store/servers`。  
- 局部失败已有区块提示则保留；与文档债中「静默吞错」对照，确保与子页错误模式一致。  

**OperationsDashboard**  
- 已用 Workbench；筛选天数、图表、对比表与报表页共用 Chart/Filter/Badge。  
- 避免运营页与流水页两套完全不同的柱/折线交互。

### 4.2 数据报表

**Revenue / Playtime**  
- 逻辑（reqId、API、天数）保留；JSX 迁入 Shell。  
- 共用 FilterBar（实例+7/30/90）。  
- KPI：流水建议总收入/订单/CDK/日均；时长建议总时长/会话/活跃/人均。  
- 图表升级：hover 浮层替代原生 `title`；主色 emerald（收入）/ blue（时长），与首页 MiniChart 可抽公共 SVG。  
- 表：右齐金额时长；Section 包裹。

### 4.3 实例与配置

**Servers**  
- Header + 可选搜索/状态前端过滤 + admin「我的|全部」分段。  
- 卡片视觉对齐 StoreHome `InstanceRow` / StatusBadge（可抽公共 `StoreInstanceCard`）。  
- 空态 CTA → `/store/servers/new`（已在 store 基座，优于跳到 default Layout 的旧路径）。  

**ServerDetailStore**  
- 外层加 Shell/Header（实例名+状态+返回列表）；经济配置卡与 `ServerDetail` 内 tab 做间距/卡片皮肤对齐。  
- **不**一次性重写整个 `ServerDetail`（跨 admin/store/guild）；本波仅 store 外包裹 + 明显违和的 tab 头/按钮类名。  

**ShopConfigEditor**  
- Header + Section 表单；预设色保留；主保存按钮用 DS Primary。  

**CreateServer（`/store/servers/new`）**  
- 确认挂在 StoreLayout 下；页头文案「在工作台创建实例」；成功回跳 `/store/servers/:id` 或列表。

### 4.4 玩家与 VIP

**Players**  
- Shell + Filter（实例、搜索）+ Section 内 DataTable。  
- 操作列按钮改为 DS 次按钮/图标按钮；三 Modal 遮罩与圆角跟 Workbench（可只改 class，不改 API）。  
- 状态列用 Status 映射浅底徽章。  

**InstanceVipUsers**  
- 迁入后补 `useDocumentTitle`；套 Shell；去掉 admin 深色/旧表格皮肤。  

### 4.5 商城商业化

**CommercialAdminIndex**  
- 实例选择器：用 Metric/卡网格或 Section 列表，禁止裸 HTML 列表感。  
- 资产列表 / 改价 / UGC：外层 Shell；内部 ProductList 等逐步换边框圆角与按钮（可分两小步：先壳后表）。  

### 4.6 版本与其它

**VersionsPage**  
- 最小：Shell 包裹 + 标题描述；控件 class 对齐。  

**Profile / Notifications（store 前缀）**  
- 不强制重做个人中心；只保证与 Layout 内边距、标题层级一致，避免「一进设置就换皮肤」。

---

## 5. 执行步骤（建议波次）

### 波次 0 — 冻结 DS
1. 文档确认主 CTA 色（A violet / B 蓝）。  
2. 扩展 WorkbenchUI（FilterBar、StatusBadge、Button、PageSkeleton、ChartFrame）。  
3. 抽 `formatMoney` / `formatDuration` / 状态 map 到 `pages/store/utils` 或 workbench 工具，去重三页复制。  
4. 写一页「组件用法」短注释于 WorkbenchUI 文件头（避免平行组件）。

### 波次 1 — 高频运营页（原三页 + 玩家）
1. ReportsRevenue、ReportsPlaytime 迁壳。  
2. Servers 迁壳。  
3. Players 迁壳。  
4. 三态走查 + 与 StoreHome 并排目视。

### 波次 2 — 商城与 VIP 与运营校准
1. Commercial 外壳 + 列表皮肤。  
2. InstanceVipUsers。  
3. OperationsDashboard 与报表图表/筛选对齐。  
4. StoreHome 小修（更多入口、按钮色、查看更多）。

### 波次 3 — 实例详情与表单
1. ServerDetailStore 外壳 + Economy 卡对齐。  
2. ShopConfigEditor、CreateServer 文案与按钮。  
3. Versions 最小包裹。

### 波次 4 — 壳层与文档收口
1. Layout 激活态/面包屑/移动底栏回归。  
2. 更新 [docs/frontend/pages/store.md](file:///home/airxw/Documents/gsp/gameserver-panel/docs/frontend/pages/store.md)：删「三套视觉」债或改为已收敛说明；为子页补简短 UX 节。  
3. 相关 e2e / 手动清单：登录服主 → 侧栏点穿所有 store 路由，确认无 daisy 裸页回潮。  
4. 构建产物 0.md 校验（无 localhost:3000）。  
5. 版本：属中小版本前端体验；编码合并时按 bb.md 记 version.md（本方案阶段不改版本号）。

**失败回退**：按路由文件回退；WorkbenchUI 扩展保持向后兼容（只增不改破坏性 API），标杆页不因扩展回退。

---

## 6. 开发事项清单

### DS / 基础设施
- [ ] 扩展 WorkbenchUI（Filter / Badge / Button / Skeleton / ChartFrame）
- [ ] `useStoreInstanceSelector` + 格式化工具去重
- [ ] 锁定主 CTA 色并全局 store 替换 `btn btn-primary/ghost` 混用（业务页范围）
- [ ] （可选）`pages/store/components/workbench` 再导出 index，避免深层乱引

### 页面迁入
- [ ] ReportsRevenue / ReportsPlaytime
- [ ] Servers
- [ ] Players + Modal 皮肤
- [ ] CommercialAdminIndex（壳 + 列表）
- [ ] InstanceVipUsers + document title
- [ ] OperationsDashboard 对齐
- [ ] StoreHome 校准
- [ ] ServerDetailStore 外壳
- [ ] ShopConfigEditor / CreateServer / Versions 最小统一
- [ ] Profile/Notifications 仅一致性校对

### 壳与质量
- [ ] Layout store 激活态与面包屑回归
- [ ] 空/载/错三态清单
- [ ] store.md 文档同步
- [ ] 0.md 构建扫描
- [ ] 不改 public 契约；不引入重型图表库除非已有依赖

---

## 7. 明确不做 / 边界

- 不在本方案重做 `/admin`、`/guild` 全站（仅 store 基座；跨基座共享组件改动需避免破坏 admin/guild）。  
- 不改后端报表/商城 API 字段。  
- 不把 ServerDetail 三端视图合并成一个巨页。  
- 不恢复深色运营大盘作为 store 默认。  
- 不把个人中心做成第二套 Workbench 营销页。

---

## 8. 验收标准

1. 从侧栏进入的 **每一条 store 业务导航**，首屏均可识别为同一 Workbench 语言（Header 圆角卡 + 白 Section + 同类按钮）。  
2. 不再出现「首页精致、子页 daisy stats/alert 脚手架」的明显割裂。  
3. 报表/玩家/实例：筛选在 FilterBar 内；KPI 数字层级高于表格。  
4. 状态色仅徽章；主按钮全基座一种主色。  
5. 载/空/错有结构近似成稿的反馈。  
6. 权限与数据行为与改前一致（含 admin 看全部实例、commercial 实例参数等）。  
7. 浏览器地址与 API 仍为同源；产物无禁用 localhost 地址。

---

## 9. 建议

1. **先扩 DS 再迁页**，否则 commercial/players/reports 会各写一套「半 Workbench」。  
2. **ServerDetail 单列慢波次**，避免和列表/报表抢范围导致整基座长期半完成。  
3. **以 StoreHome + Operations 为视觉验收锚**，子页 PR 必须截图对比锚页。  
4. 文档债 [store.md](file:///home/airxw/Documents/gsp/gameserver-panel/docs/frontend/pages/store.md) 中的 UX TODO 与本方案合并跟踪，避免两套计划。  
5. 若只做一波可交付增量：波次 0+1 即可明显改变「整体不像一套」的观感；波次 2 解决商城主路径。

---

## 10. 关键文件索引

| 路径 | 角色 |
|------|------|
| [StoreLayout.tsx](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/layouts/StoreLayout.tsx) | 基座入口 |
| [Layout.tsx](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/components/Layout.tsx) | store 导航/壳 |
| [WorkbenchUI.tsx](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/store/components/WorkbenchUI.tsx) | DS 核心 |
| [StoreHome.tsx](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/store/StoreHome.tsx) | 视觉锚 |
| [OperationsDashboard.tsx](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/admin/OperationsDashboard.tsx) | 视觉锚 |
| [ReportsRevenue.tsx](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/store/ReportsRevenue.tsx) 等 | 迁入页 |
| [commercial/index.tsx](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/admin/commercial/index.tsx) | 商城 |
| [App.tsx](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/App.tsx) | 路由表 |
| [store.md](file:///home/airxw/Documents/gsp/gameserver-panel/docs/frontend/pages/store.md) | 页面梳理与 UX 债 |

---

## 11. 与旧「三页方案」关系

| 项 | 旧草案 | 本版 |
|----|--------|------|
| 范围 | revenue / playtime / servers | 全 `/store` 基座 |
| DS | 拟新建 StorePage* 命名 | **收敛到现有 Workbench\***，避免双 DS |
| 首页 | 仅对照 | 纳入校准 |
| 商城/玩家/VIP/详情 | 未覆盖 | 分波纳入 |
| 文件路径 | 同路径 | **直接覆盖更新**，以此版为准 |
