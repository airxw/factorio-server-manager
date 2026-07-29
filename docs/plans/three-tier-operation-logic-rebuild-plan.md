---
type: plan
title: 三层操作逻辑重构方案
date: 2026-07-24
status: deployed
version_target: v4.12.0
deployed_in: v4.13.0
related: docs/plans/v4.11.0_commercialization_upgrade_plan.md, docs/plans/v4.11.0-completion-migration-plan.md, docs/bugfix/bug1.md, docs/bugfix/bug2.md
tags: [three-tier, operation-logic, platform-dashboard, gm-workbench, player-portal, rebuild]
---

# 三层操作逻辑重构方案

## 一、背景与问题

### 1.1 当初设想（来源：v4.11.0_commercialization_upgrade_plan.md §四）

v4.11.0 商业化重构的核心是 B2B2C 转型，UI/UX 按**角色操作场景**分三层，每层有差异化的风格与信息架构：

| 层 | 角色 | 设想风格 | 核心场景 |
|----|------|---------|---------|
| Platform Dashboard | 系统管理员 | 大盘数据监控、资源分配、全局模板管理 | 供应链与规则制定 |
| GM Workbench | 服主（实例管理员） | "店铺后台"风格，弱化终端命令行，强化商城管理/玩家列表/数据报表 | 选品、定价、运营 |
| Player Portal | 玩家 | 移动端优先的 C 端电商体验，服主自定义 Banner、商品列表、账号绑定卡片 | 浏览、消费、绑定 |

### 1.2 实际落地现状（v4.11.0 收尾后）

收尾方案（v4.11.0-completion-migration-plan.md）把"三基座路由承接旧业务"等同于了"三层操作逻辑落地"，但只做了**结构层**（URL 重组 + 孤岛模块接入运行时），未做**体验层**（差异化 UI）和**业务层**（角色场景重组）。具体错位：

1. **三层被降级为路由分组**：三个 Layout（AdminLayout/StoreLayout/GuildLayout）实现完全相同，都是 `<Layout><Outlet /></Layout>` 包裹，UI 层零差异。
2. **GM Workbench 缺失且被拆散**：服主管理功能（commercial、instance-vip、operations）被塞进 /admin，与系统管理员功能混在一起；/store 只放消费侧页面（shop/me/versions）。
3. **Player Portal 未实现 C 端电商体验**：/guild 只放 friends/profile（社交+设置），/store/shop 是通用聚合页而非服主专属店铺。
4. **角色门控与三层逻辑脱钩**：/admin 同时门控 server_admin 和 instance_admin；/store、/guild 是"所有已登录用户"。
5. **旧控制台 /dashboard 仍残留**：/dashboard、/instances/* 仍挂在旧 Layout 下，三层基座与旧控制台并存，用户流分裂。

### 1.3 根因

"路由基座"（URL 结构）≠ "操作逻辑"（角色场景）。收尾闭合的是路由基座，不是操作逻辑。本方案解决后者。

## 二、重构目标

1. **三层与三基座对齐**：/admin = Platform Dashboard、/store = GM Workbench、/guild = Player Portal，三者职责按角色场景重新定义。
2. **差异化 UI**：三个基座 Layout 不再相同，各有与角色场景匹配的信息架构与视觉风格。
3. **角色隔离**：三层基座按角色门控，登录后按角色跳转对应基座，消除角色混杂。
4. **GM Workbench 独立成层**：服主有独立的"店铺后台"工作台，不再与系统管理员混在 /admin。
5. **Player Portal C 端电商化**：玩家门户移动端优先、店铺化、屏蔽运维信息。
6. **旧控制台收敛**：/dashboard 并入 /admin 或废弃，/instances/* 归属明确。

## 三、三层职责重新定义

### 3.1 /admin = Platform Dashboard（系统管理员）

**定位**：平台供应链与规则制定者的大盘。

**承载**：全局模板管理、资源分配、配额、节点、系统配置、审计日志、Webhooks、SSL/隧道/API Keys、平台总览、用户管理（系统级）。

**迁出**：服主相关功能（commercial、instance-vip、operations、玩家列表、数据报表）迁入 /store。

**角色门控**：server_admin / system_admin / admin。

**UI 风格**：大盘数据监控导向，强调全局视图与资源调度。

### 3.2 /store = GM Workbench（服主工作台）

**定位**：服主的"店铺后台"，零售商与微创业者的运营阵地。

**承载**：
- 商城管理（商品上架、改价 Override、上下架）—— 接入真实 AssetService
- 玩家列表（CRM：发放补偿、封禁、调整时长）
- 数据报表（流水、时长统计、租户账单）
- 实例运营（instance-vip、operations dashboard）
- 自定义商品与 RCON 指令（UGC，接入 ExecutionEngine 沙箱）

**迁出**：消费侧页面（shop 聚合、me 我的资产、versions）迁入 /guild。

**角色门控**：instance_admin / server_admin / system_admin / admin（服主视角，server_admin 可越级查看）。

**UI 风格**：店铺后台风格，弱化终端命令行，强化商城/玩家/报表三块。弱化或折叠 raw RCON/控制台入口。

### 3.3 /guild = Player Portal（玩家门户）

**定位**：玩家的 C 端电商与社交门户，移动端优先。

**承载**：
- 服主店铺浏览（自定义 Banner、商品列表）—— 按实例/服主维度组织
- 商品消费（shop 消费侧、卡密兑换、直充）
- 我的资产（me：已购物品、时长、特权）
- 账号绑定（Steam ID 等游戏身份绑定卡片）
- 玩家社交（friends、profile、profile/verify、profile/alerts）
- 服务器发现（discover：浏览/加入服务器）

**迁入**：shop、me、versions（版本对玩家可见的消费侧）、discover、players/:userId。

**角色门控**：user 及以上（所有已登录用户，但信息架构按玩家视角组织）。

**UI 风格**：移动端优先的 C 端电商体验，服主店铺化呈现，屏蔽所有服务器运维信息（实例配置、Daemon、部署命令等对玩家不可见）。

## 四、执行步骤

> 不区分优先级，不计人力工期，仅列开发事项与建议。

### 0. 执行顺序约束与依赖 DAG

**严格串行约束（违反会导致死循环或迁移后 UI 调不到服务）**：
- 步骤 5（按角色跳转）必须先于步骤 4（基座门控上提）落地——否则 user/instance_admin 登录后被基座门控挡回，无处可去。
- 步骤 23（/dashboard 并入）必须后于步骤 5 落地。
- 步骤 8（/store 接 AssetService）必须先于步骤 6（迁 commercial 到 /store）——否则迁完后 UI 调不到服务。
- 步骤 16（迁出 commercial）与步骤 6（迁入 /store）是同一动作两面，须同步执行。

**依赖 DAG 与并行组标记**：

| 步骤组 | 依赖关系 | 并行可能性 |
|--------|---------|-----------|
| 1-3（基座职责定义） | 无依赖 | [P] 可并行 |
| 5 → 4 → 23（跳转/门控/dashboard 并入） | 严格串行 | 不可并行 |
| 8/9 → 6/7/10（GM Workbench 接入后迁入） | 8/9 先于 6 | 6/7/10 可在 8/9 完成后 [P] 并行 |
| 11-15（Player Portal） | 与 GM Workbench 独立 | [P] 可与 6-10 并行 |
| 6 完成 → 16-19（Platform Dashboard 收敛） | 依赖 commercial 迁出 | 不可与 6 并行 |
| 6-19 完成 → 20-22（差异化 UI） | 依赖页面归属定稿 | [P] 三 Layout 可并行 |
| 5、6-19 完成 → 23-26（旧控制台清理） | 依赖跳转与迁入完成 | 不可并行 |
| 4 完成 → 27-29（角色门控） | 依赖基座门控上提 | 串行 |
| 8/9 完成 → 30-32（数据与契约） | 依赖服务接入 | [P] 可与 20-22 并行 |
| 全部完成 → 33-39（验证） | 依赖全部完成 | 串行 |

### 一、基座职责重新定义与对齐

1. 明确 /admin = Platform Dashboard（系统管理员），承载系统级管理，迁出服主功能。
2. 重新定义 /store = GM Workbench（服主工作台），承载服主运营管理，迁出消费侧页面。
3. 重新定义 /guild = Player Portal（玩家门户），承载玩家消费与社交，迁入消费侧与店铺浏览页面。
4. 角色门控上提到基座 Layout 层：/admin (server_admin+)、/store (instance_admin+)、/guild (user+)，基座入口即做角色校验，而非每个子路由单独门控。
5. 登录后主入口按角色跳转：server_admin → /admin、instance_admin → /store、user → /guild，消除"已登录统一跳 /dashboard"。

### 二、GM Workbench（/store）服主工作台落地

6. 将服主管理功能从 /admin 迁入 /store：commercial（商业化控制台）、instance-vip、operations（运营仪表盘）。
7. 在 /store 新增服主专属页面：玩家列表（CRM 视图，支持发放补偿/封禁/调整时长）、数据报表（流水/时长/账单统计）。
8. /store 的商城管理接入真实 AssetService（已完成孤岛接入，需在 GM Workbench 上下文中调用 CRUD + Merge + Override）。
9. /store 的自定义商品 UGC 接入 ExecutionEngine 沙箱（已完成孤岛接入，需在 GM Workbench 提供指令配置入口并过沙箱校验）。
10. 建设"店铺后台"风格 UI：弱化/折叠终端命令行与 raw RCON 入口，强化商城管理/玩家列表/数据报表三块主导航。**完成判据**：StoreLayout 左侧主导航为"商城管理/玩家列表/数据报表"三块，终端命令行与 raw RCON 入口折叠到二级菜单或独立 Tab，默认不可见。

### 三、Player Portal（/guild）玩家门户落地

11. 将消费侧页面从 /store 迁入 /guild：shop（消费聚合）、me（我的资产）、versions（玩家可见的消费侧版本）。
12. 将 discover、players/:userId 纳入 /guild 基座导航（服务器发现与玩家档案属玩家门户场景）。
13. 建设移动端优先 C 端电商体验：响应式布局优先移动端，服主自定义 Banner、商品列表卡片、账号绑定卡片。**完成判据**：GuildLayout 在 375px 视口下布局正确（Chrome DevTools 移动端模拟验证），服主 Banner 占顶部 ≥30% 视口高度，商品列表以卡片流呈现，运维菜单入口 DOM 不可见。
14. 屏蔽运维信息：玩家视角下隐藏实例配置、Daemon、部署命令、系统健康等运维页面入口（通过角色门控 + 导航过滤双重保证）。
15. 服主店铺化呈现：按实例/服主维度组织商品浏览，玩家进入某服主店铺即看到该服主的自定义商品与 Banner。

### 四、Platform Dashboard（/admin）系统后台收敛

16. 将服主相关功能迁出 /admin：commercial、instance-vip、operations 移至 /store。
17. /admin 仅保留系统管理员功能：全局模板管理、资源分配、配额、节点、系统配置、审计日志、Webhooks、SSL/隧道/API Keys、平台总览、用户管理（系统级）。
18. 建设大盘数据监控与全局模板管理 UI：全局资产模板库（Global_Assets 配置）、租户配额视图、节点资源大盘。
19. /admin/index（AdminDashboard）改为真实的平台大盘（全局实例数、节点资源、租户配额、资产模板概览），替换当前的写死数字卡片。

### 五、差异化 UI 与信息架构

20. 三个基座 Layout 差异化实现，不再都是旧 Layout 包裹：
    - AdminLayout：大盘监控风格，左侧菜单按系统管理域组织。
    - StoreLayout（GM Workbench）：店铺后台风格，主导航为商城/玩家/报表，弱化终端。
    - GuildLayout（Player Portal）：移动端优先 C 端电商风格，顶部服主 Banner + 商品流，无运维菜单。
21. 各层导航/信息架构按角色场景重组，不复用同一套左侧菜单。
22. 共享 chrome（通知铃铛、命令面板、面包屑、移动端导航）抽为可复用组件，三个 Layout 按需组合，而非整体复用旧 Layout。**完成判据**：通知铃铛、命令面板、面包屑、移动端导航抽离到 panel/frontend/src/components/chrome/ 下独立组件，三个 Layout 按需 import 组合，旧 Layout 不再被三个基座直接包裹。

### 六、旧控制台清理与实例路由归属

23. /dashboard 并入 /admin 作为 index（Platform Dashboard），或配置重定向，消除旧控制台独立入口。
24. /instances/* 归属明确：建议作为 /admin/servers/*（系统管理员视角的服务器管理），同时 /guild 提供玩家视角的服务器发现/加入入口（discover），二者信息架构不同。
24a. 明确 /instances/:id 现有子 Tab（shop、shop-orders、cdk-redeem、business、player-histories、gift-claims）的归属：商业化管理类（shop/shop-orders/cdk-redeem/business）→ /store/servers/:id；玩家消费类（gift-claims）→ /guild/servers/:id；系统监控类（player-histories）→ /admin/servers/:id。
25. /instances/:id 实例详情页：服主视角归入 /store/servers/:id（GM Workbench 内），系统管理员视角归入 /admin/servers/:id，按角色渲染不同信息架构。
26. 移除旧 Layout 下已迁出的路由注册——分批执行，每批迁移 ≤5 个路由，每批迁完即构建 + 验证 + 提交回退锚点（git tag rollback-point-N）。涉及删除 public/ 下契约文件须走 s0601 + 人类显式授权；涉及删除 App.tsx 路由注册的破坏性操作须在执行前向人类请示。保留 301 重定向保证向后兼容。

### 七、角色与门控

27. 三层基座按角色门控：/admin (server_admin/system_admin/admin)、/store (instance_admin/server_admin/system_admin/admin)、/guild (user+所有已登录用户)。
27a. 对迁入 /store 的每个页面逐一审计原有 RequireRole 配置，基座门控只做最宽松层（instance_admin+），更细粒度门控（如 server_admin+ 的配额/平台总览）保留在子路由层；审计清单写入 .trae/documents/，避免门控上提导致权限放大。
28. 跨角色访问统一采用"跳回对应基座 + Toast 提示"策略，不实现只读视图变体（避免为每个页面维护双版本）。server_admin 可越级访问 /store 时，/store 内的 server_admin+ 子路由对 instance_admin 隐藏（通过 RequireRole 子路由门控实现）。
29. 角色与基座的映射写入权限中间件，基座入口统一校验，子路由不再重复门控（除 27a 中的细粒度保留项）。

### 八、数据与契约

30. Global_Assets / Instance_Assets 数据契约在 Player Portal 与 GM Workbench 间正确 Merge：玩家端看到的是 Global + Instance Override 合并后的商品，服主端看到的是 Global 模板 + 本实例 Override 编辑视图。
31. UGC 自定义指令契约在 GM Workbench 配置，经 ExecutionEngine 沙箱校验后投递，端到端链路（配置 → 校验 → 投递 → 游戏内生效）在三层中可见可验证。
32. 服主自定义 Banner / 商品列表的数据结构纳入 Instance_Assets 契约扩展（如需新增字段，走契约变更流程）。

### 九、验证

33. 端到端验证三角色场景链路：
    - 系统管理员：/admin 配置全局模板 → 服主在 /store 继承改价 → 玩家在 /guild 看到商品。
    - 服主：/store 创建 UGC 商品 + 自定义指令 → 玩家购买 → 沙箱校验 → RCON 投递生效。
    - 玩家：/guild 浏览服主店铺 → 绑定 Steam ID → 购买特权 → 消费时长。
34. 三层差异化 UI 验证：三个基座 Layout 视觉与信息架构明显不同，角色门控隔离生效。
35. 移动端验证：Player Portal 在移动端视口下布局正确，运维信息不可见。
36. 向后兼容验证：旧路径（/dashboard、/shop、/me、/friends 等）301 重定向到新基座对应页面。
37. 运行时接入校验：迁移完成后 grep 验证 commercial 模块在 routes-registry.ts 的 /api/admin/assets/* 路由仍注册、services-init 仍注入 AssetService、daemon ExecutionEngine 仍被 InstanceManager 引用；前端 commercial 仍能 fetch 真实 AssetApi（非 Mock）。防止迁移破坏已接入的运行时链路（v4.11.0 假闭合根因补强）。
38. 前端三重测试闸门（s0402）：单测 → E2E（三角色场景链路）→ Mock 回归，顺序固定不可跳关。
39. GN-004 交付前独立审查：本方案全部步骤完成后，主线程拉起 GN-004 审查（subagent_type=general_purpose_task，prompt 注入审查 rubric），核查运行时接入证据 + 闭合判据，审查通过后方可宣告闭合。

## 五、范围边界

- 本方案仅重构"三层操作逻辑"的 UI/UX/路由/角色门控/信息架构，不涉及底层 AssetService / ExecutionEngine 的业务逻辑重写（孤岛接入已在 v4.11.0 收尾完成）。
- 不涉及新增游戏 pack 或商业化以外的功能。
- 不破坏现有数据契约，如需扩展（Instance_Assets 的 Banner 字段等）走契约变更流程。
- 旧路径重定向保留，保证外部链接与用户书签在过渡期可用。

## 六、风险与建议

- **职责迁移影响面大**：/store 从"消费侧"改为"服主管理侧"是语义反转，需同步更新所有内部跳转、导航、文档。建议分批迁移，每批迁完即验证。在导航文案、内部跳转、文档中统一使用"GM Workbench/服主工作台"称谓；/store URL 保留以避免破坏向后兼容，但在 StoreLayout 的导航标题中显示"服主工作台"而非"Store"，消除 URL 命名与功能的认知错位。
- **实例详情页归属复杂**：/instances/:id 同时被系统管理员、服主、玩家访问，需按角色渲染不同信息架构，建议拆为 /admin/servers/:id、/store/servers/:id、/guild/servers/:id 三套视图。
- **Player Portal 移动端优先**：移动端适配工作量大，建议 Player Portal 独立做移动端设计与测试。
- **角色门控上提**：基座入口统一门控后，需排查现有子路由是否有更细粒度的角色要求（如某些页面仅 system_admin 可见），避免门控上提后权限放大。
- **契约扩展需授权**：Instance_Assets 扩展 Banner 等字段属 public/ 契约变更，必须走 s0601 适配契约变更流程并经人类显式授权，不得由 LLM 自行编辑 public/schema/ 下的任何文件。
