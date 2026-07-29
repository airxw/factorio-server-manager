---
type: plan
title: 玩家门户（/guild）全量完善与视觉重设计落地方案
date: 2026-07-24
status: deployed
deployed_in: v4.16.x
related: [App.tsx, Layout.tsx, Login.tsx, GuildDock.tsx, GuildLayout.tsx, docs/plans/three-layer-entry-implementation-plan.md]
tags: [frontend, backend, guild, player-portal, redesign, three-layer-entry]
---

# 玩家门户（/guild）全量完善与视觉重设计落地方案

> 前置文档：`docs/plans/three-layer-entry-implementation-plan.md`（三层入口框架，已落地大部分）。
> 本方案承接其未完成部分，并按用户新指令对 /guild 全线做配色、布局、操作逻辑重设计。

## 一、现状诊断（代码实证）

### 1.1 已完成部分（不重复开发）

- 路由三层基座结构已修正：`/admin`、`/store`、`/guild` 均 `path` 挂载且全部在 `ProtectedRoute` 内（App.tsx L288-L432）
- `RootRedirect` 按角色分流（server_admin→/admin，instance_admin→/store，user→/guild），未登录显示 IdentitySelector
- IdentitySelector 三入口卡片（服主/玩家/Demo 一键登录）已可用
- Login 页已支持 `from` 上下文标题（服主控制台/玩家门户双色）、init 门控、演示账号
- Layout player variant 已有顶部栏（用户菜单）+ 底部 tab（首页/商城/我的/发现/消息）
- GuildDock 已接入真实 API（listPlayerBindings + listNotifications）
- ServerDetailGuild（/guild/servers/:id）已有店铺头部 + 绑定卡片 + 商品列表

### 1.2 缺口清单（本方案要消除）

| # | 缺口 | 证据 | 后果 |
|---|------|------|------|
| G1 | `/guild/servers` 列表页不存在 | GuildDock BindingCard/featureCards 引用，App.tsx 仅注册 `servers/:id` | 点击 404 |
| G2 | `/guild/bind` 绑定角色页不存在 | GuildDock 快捷功能/Banner/空状态共 4 处引用 | 点击 404 |
| G3 | `/guild/cdk` CDK 兑换页不存在 | GuildDock 快捷功能引用（现有 CdkRedeem 仅单实例 `/instances/:id/cdk-redeem`） | 点击 404 |
| G4 | `/guild/orders` 我的订单页不存在 | GuildDock 快捷功能引用（现有 ShopOrders 仅单实例） | 点击 404 |
| G5 | 后端无跨实例订单聚合 API | shop.ts 仅 `/:serverId/shop-orders` | G4 无数据源 |
| G6 | "每日福利"卡为纯静态文案 | GuildDock L371-L381，wallet API（`GET /:serverId/wallet`、`POST /:serverId/wallet/claim-daily`）未接入 | 功能造假 |
| G7 | `/guild/versions` 语义错位 | 版本管理是服主/管理员职能，挂在玩家门户下 | 信息架构错误 |
| G8 | /guild 全线视觉沿用旧体系 | 用户指令："整体的前端配色、布局、操作逻辑全部要改" | 体验不达 C 端标准 |

## 二、已裁决决策（用户 2026-07-24 确认）

1. **范围**：全量玩家门户完善——4 个缺失页面 + G5~G8 全部遗留项
2. **订单聚合**：新增后端聚合 API（`GET /api/my/orders`），不做前端逐实例拉取
3. **versions 归位**：从 /guild 移除，迁至 /store 基座
4. **视觉重设计**：/guild 全线配色、布局、操作逻辑重改（用户补充指令）

### 2.1 范围假设（待方案评审确认）

- 重设计范围 = **/guild 基座全部页面 + /login 入口页**（用户点名的两个入口）。
- /admin、/store 两基座本轮不动（后台属性，上轮已定型）。
- 如需连带重设计 /admin、/store，评审时提出，另行立项。

## 三、设计方向建议（评审确认后冻结）

**建议：深色电竞风（Dark Gaming）**

- 基底：深空蓝黑 `#0B0E1A` → `#131829` 纵向渐变，杜绝纯白大底
- 强调色：霓虹紫 `#8B5CF6` → 品红 `#EC4899` → 青 `#22D3EE` 三阶渐变，用于主 CTA、激活态、高光描边
- 材质：玻璃拟态卡片（`backdrop-filter: blur` + 1px 半透明描边 + 内发光），游戏化徽章/进度环
- 字体层级：大字号数字（余额/在线人数）+ 小字号标签，数据可视化优先于文字段落
- 动效：CSS transform/opacity 微交互（hover 浮起、激活脉冲、领取成功礼花），禁止 Canvas 无限渲染与持续 GPU 重绘（IdentitySelector GPU 黑屏教训，纯静态渲染约束）；移动端高度用 100dvh（rules-0 §3.1.6 视口守卫）
- 布局：移动端优先单列流 + 桌面端 12 栅格；底部 tab 常驻；页面顶部沉浸式头图区
- 参考基准：Steam/Epic/Discord/米游社 的 C 端游戏产品语言

落地物：`panel/frontend/src/styles/guild-portal.css`（设计 token：CSS 变量色板/圆角/阴影/动效曲线），/guild 全部页面统一消费，不侵入 admin/store 样式。

## 四、开发事项

### 4.1 后端：玩家聚合 API（G5）

1. 新增 `panel/backend/src/api/routes/my.ts`，在 `panel/backend/src/routes-registry.ts` 挂载 `/api/my`：
   - `GET /api/my/orders`：当前用户跨实例订单列表（联表 shop_orders + instances 取实例名，按 created_at 倒序，支持 `?status=pending|claimed|expired` 过滤；ShopOrderSummary.status 实为 4 值枚举 `pending|claiming|claimed|expired`，`claiming` 中间态并入"待领取"（pending）返回），响应含 `order + instance_name + items + claim_code`
   - `GET /api/my/overview`：玩家门户首页聚合（绑定数、已验证绑定数、未读通知数、进行中订单数、各绑定实例钱包余额合计）
2. 响应类型补入 `public/schema/panel-api-types.ts`（走 s0601 契约变更流程，含 @version 注释）
3. 前端 `api/client.ts` 增加 `listMyOrders(status?)`、`getMyOverview` 方法
4. 权限：任意已登录用户（user+），仅返回本人数据（user_id 过滤）

### 4.2 前端：4 个新页面（G1-G4）

5. `/guild/servers`（GuildServers.tsx）：
   - "我的服务器"：绑定角色所在实例卡片（封面图/名称/游戏类型/在线状态脉冲点/在线人数/我的 VIP 徽章/「进入店铺」CTA → `/guild/servers/:id`）
   - "推荐服务器"：复用 `/api/discover` 公开数据，卡片网格
   - 空状态：无绑定时引导去 `/guild/bind` + 推荐服务器
6. `/guild/bind`（GuildBind.tsx）：
   - 绑定全流程页：创建绑定（选游戏类型 + 输入游戏角色名）→ 待验证状态 → 验证/重新验证 → 解绑
   - 复用并升级 AccountBindingCard 逻辑为页面级（API 已全部存在：listPlayerBindings/createPlayerBinding/verifyPlayerBinding/deletePlayerBinding）
   - 按游戏类型分组展示已有绑定，状态徽章（已验证/待验证/已拒绝）
7. `/guild/cdk`（GuildCdk.tsx）：
   - 三步操作流：选实例（已绑定）→ 选角色 → 输入卡密 → 兑换
   - 调现有 `redeemCdk(serverId)`；兑换成功展示奖励内容 + 礼花动效；失败展示原因
8. `/guild/orders`（GuildOrders.tsx）：
   - 调 `GET /api/my/orders`，状态筛选 tab（全部/待领取/已领取/已过期）
   - 订单卡片：商品、实例名、金额、时间、领取码（一键复制 + 复制成功反馈）
   - 待领取订单高亮置顶

### 4.3 前端：首页与既有页重设计（G6、G8）

9. GuildDock 重写：
   - 沉浸式欢迎头区（问候语 + 用户名 + 资产概览数字带，数据来自 `/api/my/overview`）
   - "每日福利"卡接入 wallet API：按绑定实例展示可领取状态，`POST /:serverId/wallet/claim-daily` 领取 + 成功动效（消除 G6 造假）
   - 快捷功能入口（绑定角色/商城/CDK/订单，图标网格）
   - "我的服务器"横滑卡片带（复用 GuildServers 卡片组件）
   - 通知公告侧栏（保留现有 listNotifications）
10. Layout player variant 视觉升级：
    - 顶部栏改玻璃拟态（毛玻璃 + 底部发丝线），品牌区、搜索入口、通知铃铛、用户菜单保留并换肤
    - 底部 tab 游戏化：激活态霓虹高亮 + 图标微动效；消息 tab 未读角标
    - BUILD ID 保留于顶部栏（小字等宽青色，rules/1.md 部署要求）
11. 既有 /guild 子页换肤适配：Shop（聚合入口 + 单实例）、MyAssets、Friends、Profile、PlayerVerify、AlertSettings——统一消费 guild-portal.css token，卡片/表单/按钮换为新体系，不改业务逻辑
12. ServerDetailGuild 视觉升级：店铺头部沉浸式 Banner、主题色与霓虹体系融合、商品卡片换新样式
13. `/login` 入口页打磨：
    - 深色电竞风换肤（与 /guild 同体系），保留 from 上下文双色标题逻辑
    - 表单玻璃拟态卡片、输入框聚焦霓虹描边、登录按钮渐变 + loading 态
    - 演示账号区视觉重排（三角色卡片化）
    - 保留 init 门控、BUILD ID、忘记密码/注册/协议链接

### 4.4 路由与信息架构（G7）

14. App.tsx 注册 4 条新路由（/guild 基座内，相对路径）：`servers`（index）、`bind`、`cdk`、`orders`
15. `/guild/versions` 移除；VersionsPage 迁移挂载到 `/store/versions`（instance_admin+ 门控）
16. 旧路径重定向更新：`/versions` → `/store/versions`（不做 /bind、/cdk、/orders 兼容重定向——这些路径从未存在过，无旧链接来源）
17. Layout 面包屑 + PATH_ACTIVE_MAP 补全 4 条新路径映射；底部 tab 激活态覆盖新页；versions 相关残留同步迁移：Layout.tsx L89 MAIN_LINKS 导航项 `/guild/versions` → `/store/versions`、L208/L219 PATH_ACTIVE_MAP、L418 面包屑分支；并验证 UpdateCheck.tsx L285 硬编码 `<a href="/versions">` 迁移后行为
18. /guild/servers 空 id 边界：`/guild/servers`（无 :id）进列表页，`/guild/servers/:id` 进详情，两路由并存不冲突

### 4.5 测试闸门（s0402，顺序固定：单测→E2E→Mock 回归）

19. 单测（vitest）：`listMyOrders/getMyOverview` client 方法、GuildServers/GuildBind/GuildCdk/GuildOrders 渲染与交互、wallet 领取逻辑、`/api/my/overview` 多实例钱包余额合计正确性、utils 目录保持 100% 覆盖
20. E2E（Playwright）：登录 user → /guild 首页 → 四新页面逐一可达且无 404；CDK 兑换流程；订单领取码复制；/guild/versions 不再可达且 /versions 重定向到 /store/versions；user 角色访问 /versions 重定向后命中 403/Forbidden（固化裁决 3 的权限收缩）；移动端视口（375px）底部 tab 与单列流可用
21. MSW Mock 回归：新增 `/api/my/*` mock handler，全量 Mock 模式跑通 /guild 主线
22. token 文件存放 test-results 之外（防 429，项目教训）

### 4.6 版本与部署

23. 版本号：新功能 → 中版本递增，`4.14.0` → `4.15.0`（bb.md）；同步 package.json、version.json、version.md、README.md、deploy.sh DEPLOY_VERSION
24. version.md 记录本次变更明细；BUILD ID 更新为部署当日编码
25. 部署：先停现有服务（rules/1.md）；前端产物落 `/opt/gameserver-panel/panel/frontend/dist/`
26. 部署验证：
    - `grep -r "localhost:3000\|127.0.0.1:3000" panel/frontend/dist/` 必须无命中（0.md §五）
    - `https://gsp.ecsrz.com:3001/guild` 登录后可达，四新页面无 404
    - `https://gsp.ecsrz.com:3001/login` 新视觉生效
    - BUILD ID 显示正确
27. 任务闭合后更新 current-note.md 七字段交接状态

## 五、文件清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `panel/backend/src/api/routes/my.ts` | 新增 | /api/my/orders + /api/my/overview 聚合路由 |
| `panel/backend/src/routes-registry.ts` | 修改 | 挂载 /api/my 路由 |
| `public/schema/panel-api-types.ts` | 修改 | MyOrder/MyOverview 响应类型（s0601 流程） |
| `panel/frontend/src/api/client.ts` | 修改 | listMyOrders / getMyOverview |
| `panel/frontend/src/styles/guild-portal.css` | 新增 | 玩家门户设计 token（色板/材质/动效） |
| `panel/frontend/src/pages/guild/GuildServers.tsx` | 新增 | G1 我的服务器 + 推荐 |
| `panel/frontend/src/pages/guild/GuildBind.tsx` | 新增 | G2 绑定管理页 |
| `panel/frontend/src/pages/guild/GuildCdk.tsx` | 新增 | G3 CDK 兑换页 |
| `panel/frontend/src/pages/guild/GuildOrders.tsx` | 新增 | G4 我的订单页 |
| `panel/frontend/src/pages/guild/GuildDock.tsx` | 重写 | 新视觉 + wallet 接入 + overview 数据 |
| `panel/frontend/src/pages/guild/ServerDetailGuild.tsx` | 修改 | 视觉升级 |
| `panel/frontend/src/components/Layout.tsx` | 修改 | player variant 换肤 + 面包屑/激活态补全 |
| `panel/frontend/src/pages/Login.tsx` | 修改 | 深色电竞风换肤 |
| `panel/frontend/src/pages/Shop.tsx` `MyAssets.tsx` `Friends.tsx` `Profile.tsx` 等 | 修改 | 换肤适配（不动业务逻辑） |
| `panel/frontend/src/App.tsx` | 修改 | 4 新路由 + versions 迁移 + 重定向更新 |
| `panel/frontend/src/pages/VersionsPage.tsx` 挂载处 | 修改 | /guild/versions → /store/versions |
| 测试文件（vitest/Playwright/MSW） | 新增/修改 | 三重闸门覆盖 |
| `version.md` `package.json` `version.json` `README.md` `deploy.sh` | 修改 | v4.15.0 版本同步 |

## 六、验收标准

1. GuildDock 上全部入口点击可达，/guild 基座内无任何 404
2. `GET /api/my/orders` 仅返回当前用户订单，含实例名与领取码
3. 每日福利可真实领取，重复领取有"今日已领"态
4. `/guild/versions` 不再存在，`/versions` 正确重定向到 `/store/versions`
5. /guild 全线 + /login 统一深色电竞风，移动端 375px 视口无横向滚动、底部 tab 不被遮挡（100dvh 守卫）
6. 单测→E2E→Mock 回归三闸门全 PASS
7. 构建产物无 `localhost:3000` / `127.0.0.1:3000` 字符串
8. 部署后 `https://gsp.ecsrz.com:3001/guild`、`https://gsp.ecsrz.com:3001/login` 实测可达，BUILD ID 正确
