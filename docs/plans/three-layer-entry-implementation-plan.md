---
type: plan
title: 三层入口完善落地方案
date: 2026-07-24
status: deployed
deployed_in: v4.16.x
related: [App.tsx, Layout.tsx, Login.tsx, IdentitySelector.tsx, GuildDock.tsx, StoreHome.tsx, AdminDashboard.tsx]
tags: [frontend, routing, three-layer-entry, auth, guild, store, admin]
---

# 三层入口完善落地方案

## 一、现状问题诊断

### 1.1 路由结构 Bug

| 问题 | 位置 | 影响 |
|------|------|------|
| `/guild` 基座无登录保护 | [App.tsx](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/App.tsx#L387-L408) 第387行 GuildLayout 在 ProtectedRoute 闭合标签外 | 未登录用户可直接访问 `/guild`、`/shop`、`/me`、`/friends` 等玩家页面 |
| `/store` 子路由结构错误 | [App.tsx](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/App.tsx#L363-L384) StoreLayout 作为无 path 布局路由包裹，子路由 "commercial"/"players" 等为相对路径 | `/store/commercial`、`/store/players` 等路径实际不匹配，会变成 `/commercial`、`/players` |
| `/guild` 子路由同样结构问题 | [App.tsx](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/App.tsx#L387-L408) 子路由 `/shop`、`/me` 等用绝对路径可匹配，但布局包裹逻辑与 admin/store 不一致 | 路由维护困难，面包屑/侧边栏激活态可能异常 |

### 1.2 页面内容问题

| 页面 | 现状 | 问题 |
|------|------|------|
| `/store` StoreHome | 租服市场 Mock（"探索游戏世界"、游戏封面、¥29.9/月） | 内容定位错误——/store 是服主工作台（GM Workbench），应是运营管理首页而非租服页面 |
| `/guild` GuildDock | 社区动态 Mock（假 Banner、假玩家动态、假服务器卡片） | 纯静态 Mock 数据，无真实 API 接入，无玩家已绑定实例/资产/订单/好友等真实信息 |
| IdentitySelector `/` | "我是服主"→/home、"我是玩家"→/player、"先看看"→/home | 身份选择后直接跳营销落地页，缺少"选择后引导登录/注册"的转化闭环；"先看看"应触发 demo 一键登录而非跳 /home |
| Login `/login` | 功能完整，demo 账号入口可用 | 缺少"返回身份选择"入口，缺少从 /home /player 营销页跳转来源的上下文衔接 |

### 1.3 导航/布局问题

| 问题 | 位置 |
|------|------|
| GuildLayout（player variant）顶部栏只有"玩家门户"文字品牌+通知+登出，缺少用户头像/昵称/角色切换入口 | [Layout.tsx](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/components/Layout.tsx#L668-L772) |
| Guild 底部 tab 消息入口指向 `/admin/notifications`，对普通 user 角色可能无权限 | [Layout.tsx](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/components/Layout.tsx#L649-L655) |
| PATH_ACTIVE_MAP 缺少 /guild、/guild/servers/:id 等路径的激活态映射 | [Layout.tsx](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/components/Layout.tsx#L198-L247) |
| getBreadcrumbs 缺少 /store/* 和 /guild/* 路径的面包屑 | [Layout.tsx](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/components/Layout.tsx#L255-L340) |
| 退出登录后跳 `/home`（营销页），但 /home 是服主向页面，玩家退出后应可选择回 /player 或 / | [Layout.tsx](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/components/Layout.tsx#L569) |

### 1.4 三层视觉差异化不足

- AdminDashboard 已使用 slate+蓝/绿/琥珀/紫 色系专业后台风格
- StoreHome 使用 zinc-900 暗色但内容错误
- GuildDock 使用 zinc-900 暗色但与 store 风格无差异，未体现 C 端电商的明快/活泼/移动端优先
- 三层基座缺少各自的品牌色、Logo、favicon 动态切换

---

## 二、三层入口架构定义

### 2.1 三层逻辑模型

```
第一层：公开营销层（无需登录）
  /                    → IdentitySelector 身份选择
  /home                → 服主向落地页（Home.tsx 已有）
  /player              → 玩家向落地页（PlayerHome.tsx 已有）
  /login               → 登录
  /register            → 注册
  /forgot-password     → 密码找回
  /setup               → 首启动向导
  /help                → 帮助中心
  /terms /privacy      → 法律文本
  /discover            → 服务器发现（公开浏览，登录后可操作）
  /players/:userId     → 玩家档案（公开浏览）
  /landing             → 通用落地页

第二层：认证层
  /login /register /forgot-password /reset-password /verify-email /setup /maintenance /500

第三层：角色工作台层（必须登录，按角色分流）
  /admin               → Platform Dashboard（server_admin+）
  /store               → GM Workbench（instance_admin+）
  /guild               → Player Portal（user+，所有已登录用户）
```

### 2.2 角色分流规则（RootRedirect 已有逻辑，需确认）

```
已登录用户访问 /：
  server_admin / system_admin / admin  → /admin
  instance_admin                        → /store
  user                                  → /guild

未登录用户访问 /：
  → IdentitySelector
```

---

## 三、开发事项与建议

### 3.1 路由结构修复

**修复 App.tsx 路由树结构，统一三层基座的路由嵌套模式：**

1. 将 GuildLayout 移入 ProtectedRoute 内部，与 admin/store 保持一致
2. 将 StoreLayout 和 GuildLayout 改为 `path="/store"` 和 `path="/guild"` 的路由挂载（与 AdminLayout 一致），子路由全部改为相对路径
3. 将 /shop、/me、/versions、/friends、/profile 等消费侧页面统一收拢到 /guild 基座内作为子路由（保留旧路径重定向）
4. 修正 /store 子路由：`commercial`、`players`、`reports/revenue`、`reports/playtime`、`servers`、`servers/:id`、`servers/:id/shop-config`、`instance-vip`、`operations` 均为 /store 下的相对路径
5. 修正 /guild 子路由：`servers/:id`、`shop`、`me`、`versions`、`friends`、`profile`、`profile/verify`、`profile/alerts` 均为 /guild 下的相对路径，保留旧绝对路径 `/shop`→`/guild/shop` 等重定向
6. 修复 `/guild/shop`、`/guild/me` 等别名路由，确保嵌套在 /guild 布局内

### 3.2 IdentitySelector 改造

**重写 [IdentitySelector.tsx](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/IdentitySelector.tsx) 的跳转逻辑：**

1. "我是服主"卡片：点击后跳转 `/login?from=owner`（带来源参数），登录后跳 `/store`（而非 /admin，因为 instance_admin 是最常见的服主角色）；如果用户想成为服主但还没账号，提供"注册服主账号" secondary CTA 跳 `/register?role=instance_admin`
2. "我是玩家"卡片：点击后跳转 `/login?from=player`，登录后跳 `/guild`；提供"注册玩家账号" CTA 跳 `/register?role=user`
3. "先看看"卡片：点击后使用 demo user 账号（user@local.dev / admin123）自动登录，直接进入 `/guild` 体验；如果后端 demo 模式开启可走一键 demo 登录，否则跳转 `/login` 并高亮演示账号区域
4. 卡片增加"已有账号？登录"和"没有账号？注册"的底部链接区
5. 在 IdentitySelector 顶部增加"我已经有账号了"直接跳 `/login` 的文本按钮
6. 保留现有纯静态无动画渲染约束（避免 GPU 黑屏）
7. 三张卡片增加"推荐角色"标签视觉区分

### 3.3 Login 页面增强

**增强 [Login.tsx](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/Login.tsx)：**

1. 读取 URL 参数 `?from=owner|player|demo`，在登录页标题/副标题显示上下文：from=owner → "服主登录"，from=player → "玩家登录"，from=demo → "体验登录"
2. 增加"返回"按钮（← 选择身份），跳转回 `/`
3. 注册链接根据 from 参数带角色提示：`/register?role=instance_admin` 或 `/register?role=user`
4. 登录成功后：如果有 location.state.from 则跳 from；如果有 ?from=owner 则 RootRedirect 处理；如果 ?from=player 且登录角色为 user 则跳 /guild；默认走 `/` 让 RootRedirect 按角色分流
5. 演示账号区域增加角色说明文字："服务器管理员/实例管理员/普通玩家"对应三层基座的说明
6. 增加"忘记密码"和"注册"入口的视觉层级优化
7. 保持构建编码 BUILD ID 显示

### 3.4 StoreHome 重写（服主工作台首页）

**完全重写 [StoreHome.tsx](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/store/StoreHome.tsx)，定位为 GM Workbench 首页：**

1. **数据接入**：调用服主维度的运营 API
   - `GET /api/store/overview`（需后端新增或复用现有接口聚合）：返回服主名下实例数、运行中实例数、今日订单数、今日收入、本周收入、待处理事项数（待发货/库存告警/玩家投诉）
   - `GET /api/store/instances?owner=me&status=running`：我运行中的实例列表（前5条）
   - `GET /api/store/orders?status=pending`：待处理订单（前5条）
   - `GET /api/notifications?unread=true`：未读消息数
   - `GET /api/store/revenue?period=7d`：近7天收入趋势数据

2. **页面模块**：
   - 顶部欢迎区："你好，{username}" + 今日日期 + 快捷操作按钮（创建实例/商品上架/查看报表）
   - KPI 卡片网格：我的实例数/运行中/今日订单/今日收入/本周收入/待处理/在线玩家总数
   - 近7天收入折线图（轻量 SVG 或用 recharts）
   - "我的实例"列表卡片：名称/状态/在线人数/到期时间/快捷操作（控制台/商城配置/复制地址）
   - "待处理事项"列表：待发货订单/库存不足告警/即将到期实例/玩家反馈
   - "快捷入口"区：商城管理/玩家列表/VIP管理/运营仪表盘/数据报表
   - 最近7天订单活动时间线

3. **视觉风格**：暗色高端管理后台（zinc-900 基底），蓝/紫/绿/琥珀强调色，卡片圆角+微阴影，与 AdminDashboard 风格统一但更聚焦"运营感"而非"系统监控感"
4. **空状态**：新服主无实例时显示"创建你的第一个游戏服务器"引导卡片 + Pack 选择入口
5. **Loading/Skeleton/Error 三态处理**：与 AdminDashboard 保持一致

### 3.5 GuildDock 重写（玩家门户首页）

**完全重写 [GuildDock.tsx](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/guild/GuildDock.tsx)，定位为 Player Portal 首页（C 端电商/社区风格）：**

1. **数据接入**：调用玩家维度 API
   - `GET /api/player/overview`（需后端新增或聚合）：已绑定服务器数、我的资产数量、未读消息数、待领取礼包数、待处理订单数
   - `GET /api/player/instances`：我加入/绑定的服务器列表（按最近访问排序）
   - `GET /api/player/assets`：我的已购商品/会员（前10条）
   - `GET /api/player/orders?status=pending`：进行中订单
   - `GET /api/player/gifts`：可领取礼包
   - `GET /api/player/friends?online=true`：在线好友
   - `GET /api/notifications?unread=true`：未读消息
   - `GET /api/discover/featured`：推荐/热门服务器（公开数据）

2. **页面模块**：
   - 顶部轮播/推荐 Banner：推荐服务器、活动宣传、新服开张（图片可点击跳对应服务器店铺页）
   - "我的服务器"横向滚动卡片列表：服务器封面/名称/在线人数/我的VIP等级/快速进入按钮（手机端横滑）
   - "快捷入口"图标网格：商城/CDK兑换/我的资产/好友/礼包领取/每日签到
   - "待领取"红点提醒区：可领礼包/进行中订单/未读消息
   - "推荐服务器"卡片网格（公开 discover 数据）
   - "最近购买"商品横向列表
   - "在线好友"头像列表
   - 社区动态（如果后端有社区/聊天功能，否则隐藏此模块）

3. **视觉风格**：
   - 明亮活泼 C 端风格（非 zinc-900 暗色），白色/浅灰基底 + 紫色/粉色/青色强调色
   - 大圆角卡片（2xl/3xl）、微渐变、轻阴影
   - 移动端优先：底部 tab 已在 GuildLayout 实现，首页内容单列滚动
   - 服务器卡片含游戏图标/sprite、在线状态脉冲点、玩家人数
   - 商品卡片含缩略图、价格、"立即购买"按钮
   - 隐藏所有运维/技术信息（端口/控制台/节点等）

4. **空状态**：新玩家无绑定服务器时显示"发现好玩的服务器"引导区 + 推荐服务器列表 + "绑定 Steam ID 领取新手礼包"卡片
5. **Loading/Skeleton/Error 三态处理**：卡片级 skeleton，不整页 loading
6. **移动端适配**：单列布局，横滑区域，底部 tab 导航常驻，顶部栏含搜索入口

### 3.6 Layout 组件增强（三层差异化）

**修改 [Layout.tsx](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/components/Layout.tsx)：**

1. **PATH_ACTIVE_MAP 补全**：
   - 增加 /guild → /guild、/guild/servers/:id → /guild、/guild/shop → /shop（或 /guild/shop）、/guild/me → /me、/guild/friends → /friends、/guild/profile → /profile 等映射
   - 增加 /store 子路由激活态映射

2. **面包屑 getBreadcrumbs 补全**：
   - 增加 /store/* 路径面包屑：工作台首页/商城管理/玩家列表/VIP管理/流水报表/时长统计/我的实例/实例详情/店铺外观配置
   - 增加 /guild/* 路径面包屑：玩家门户首页/服务器详情/商城/我的资产/我的订单/好友/个人设置/消息中心

3. **GuildLayout (player variant) 顶部栏增强**：
   - 增加用户头像（首字母头像或 Gravatar）+ 昵称显示
   - 增加搜索图标按钮（点击弹出搜索框，搜索服务器/商品/好友）
   - 消息铃铛保持但路径改为玩家可访问的消息页（或复用 /admin/notifications 但确认 user 角色有权限）
   - 登出按钮改为用户菜单下拉（头像点击展开：个人设置/切换主题/登出）
   - 品牌区点击返回 /guild

4. **Guild 底部 tab 修正**：
   - 消息入口确保 user 角色可访问（后端需确认 GET /api/notifications 对所有登录用户开放）
   - 考虑增加"发现"tab 已有，检查顺序是否合理：首页/商城/发现/消息/我的

5. **StoreLayout sidebar 补全**：
   - 确认 STORE_NAV_GROUPS 分组完整
   - 服主工作台 sidebar 顶部增加"我的实例数量"和"今日收入"小指标
   - 增加"返回平台大盘"入口（对 server_admin 越级可见）

6. **退出登录逻辑**：
   - variant='player' 退出后跳 `/player`（玩家落地页）
   - variant='store' 退出后跳 `/home`（服主落地页）
   - variant='admin' 退出后跳 `/home`
   - variant='default' 保持跳 `/home`

7. **三层主题色 CSS 变量**：
   - 通过 data-variant 属性切换 CSS 变量：
     - admin: `--accent: 37 99 235`（blue-600）、`--sidebar-bg: 15 23 42`（slate-900）
     - store: `--accent: 124 58 237`（violet-600）、`--sidebar-bg: 24 24 27`（zinc-900）
     - player: `--accent: 168 85 247`（purple-500）、`--sidebar-bg: 255 255 255`（white）、`--topbar-bg: rgba(255,255,255,0.8)`（毛玻璃）
   - 页面背景色、卡片边框色、强调按钮色通过 CSS 变量适配

8. **NodeStatusWidget 对 player variant 隐藏（已有逻辑，确认生效）**

### 3.7 /admin 基座补齐（已有基础，确认完整性）

[AdminDashboard.tsx](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/admin/AdminDashboard.tsx) 已有较完整实现，确认事项：

1. 确认 `GET /api/platform/overview` 后端接口返回所有 KPI 字段
2. 确认 `GET /api/admin/assets` 接口对 server_admin 可用
3. 快捷入口中"资产模板"链接到 `/store/commercial`，确认跨基座跳转权限处理（server_admin 可访问 /store 已通过 RequireRole allow 包含 server_admin）
4. 确认 /admin/servers 列表页（Servers.tsx）和 /admin/servers/:id 详情页（ServerDetailAdmin.tsx）功能完整
5. 侧边栏 ADMIN_GROUPS 确认所有链接的页面组件已实现且非占位

### 3.8 路由守卫与权限门控强化

1. **ProtectedRoute 增加角色预加载**：等待 user 加载完成再判断跳转，避免闪现
2. **RequireRole 增加无权限提示**：非 server_admin 访问 /admin 子页、非 instance_admin 访问 /store 子页时，显示 Forbidden 页面（已有 Forbidden 组件，确认触发逻辑）
3. **/guild 基座角色门控**：已登录用户均可访问（user/instance_admin/server_admin），但高权限角色访问 /guild 时顶部显示"切换到管理视图"快捷入口（instance_admin 可切 /store，server_admin 可切 /admin）
4. **跨基座切换器**：在顶部栏或侧边栏增加角色快速切换组件（仅当用户拥有多个角色或高权限角色时显示），如 server_admin 可在"平台大盘/服主工作台/玩家门户"间快速切换
5. **首启动 /setup 路由优先级确认**：未初始化时所有路径（除 /setup 本身）重定向到 /setup，Login 已有此逻辑，确认其他公开页面也有此守卫

### 3.9 实例详情三视图路由补全

App.tsx 已有 `/instances/:id` → 按角色重定向到三套视图的逻辑，确认：

1. [ServerDetailAdmin.tsx](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/admin/ServerDetailAdmin.tsx) — 系统管理员视图（运维/监控/底层配置）
2. [ServerDetailStore.tsx](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/store/ServerDetailStore.tsx) — 服主视图（商城配置/玩家管理/运营数据/控制台）
3. [ServerDetailGuild.tsx](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/guild/ServerDetailGuild.tsx) — 玩家视图（店铺首页/商品列表/CDK兑换/社区投票）

三个详情页内容需差异化设计，共用实例基础信息但 Tab 和操作完全不同：
- Admin：监控/日志/配置/文件/控制台/运维
- Store：商城/订单/玩家/VIP/运营/控制台
- Guild：商店/礼包/投票/信息/绑定状态

### 3.10 Register 注册页适配

增强注册页 [Register.tsx]（如已有）或创建角色预选逻辑：

1. 读取 URL 参数 `?role=instance_admin|user`，预选注册角色
2. 增加"你是？"身份选择：服主/玩家（服主注册需额外信息如服务器名/游戏选择，玩家注册只需邮箱/密码/用户名）
3. 注册成功后自动登录并跳对应基座首页
4. 增加返回登录页和返回身份选择入口
5. 保持与 Login 页一致的视觉风格

### 3.11 /shop 迁入 /guild 基座

1. 将 Shop.tsx（商城页）包裹在 GuildLayout 内，视觉适配玩家门户风格（非后台风格）
2. 商城页增加"我的服务器"上下文切换（玩家在哪个服务器的店铺购买）
3. 商品列表网格移动端适配（2列→单列）
4. 购物车/订单状态与 GuildDock 互通

### 3.12 /me 我的资产页增强

1. MyAssets.tsx 适配 GuildLayout player 风格
2. 按服务器分组显示已购商品/VIP/礼包
3. 增加订单历史入口
4. 增加 Steam ID/游戏 ID 绑定管理卡片
5. 增加 CDK 兑换快捷入口

### 3.13 公开页面与认证层衔接优化

1. **/home 服主落地页**：所有 CTA 按钮（免费部署/进入控制台等）跳转 `/login?from=owner` 而非直接 `/login`
2. **/player 玩家落地页**：所有 CTA 按钮（查看我的福利/登录等）跳转 `/login?from=player`
3. **/discover 发现页**：公开浏览正常显示；"加入服务器""购买商品"等操作按钮未登录时跳转 `/login?redirect=/discover`
4. **/players/:userId 玩家档案**：公开浏览正常；"加好友""发消息"等操作未登录时引导登录

### 3.14 CSS/样式完善

1. **新增 guild 专属样式文件**（如 `guild-portal.css`）或在现有 Tailwind 基础上补充 C 端电商风格组件类
2. **修复 guild-layout 移动端视口**：遵守 rules-0 §3.1.6，使用 `height: 100dvh` 而非 `100vh`，内容区 `overflow-y: auto`
3. **暗色/亮色模式**：
   - admin/store 基座暗色模式（zinc-900/slate-900）
   - guild 基座亮色模式（white/gray-50），跟随系统或手动切换
4. **构建编码显示**：三层基座均在顶部（admin/store 侧边栏底部已有版本号；guild 顶部栏右侧增加 BUILD ID 小字体显示）
5. **Tour tooltip 视口守卫**（rules-0 §3.1.5）：所有新页面 tooltip 定位含边界检查
6. **全局样式统一**：btn/card/form/skeleton/loading 等通用组件类在三层基座下视觉协调

### 3.15 后端接口适配建议

前端三层基座需要以下后端 API 支撑（如未实现需后端同步开发）：

| 接口 | 用途 | 角色 |
|------|------|------|
| `GET /api/platform/overview` | Admin KPI 大盘数据 | server_admin |
| `GET /api/store/overview` | 服主运营首页聚合数据 | instance_admin+ |
| `GET /api/player/overview` | 玩家首页聚合数据 | user+ |
| `GET /api/store/instances?owner=me` | 服主名下实例列表 | instance_admin+ |
| `GET /api/player/instances` | 玩家绑定/加入的实例 | user+ |
| `GET /api/notifications` | 消息通知列表（所有登录用户） | user+ |
| `GET /api/store/revenue?period=7d` | 服主收入趋势 | instance_admin+ |
| `GET /api/discover/featured` | 推荐服务器列表 | 公开 |
| `POST /api/auth/login?demo=user` | Demo 一键登录（玩家体验） | 公开（demo模式） |

### 3.16 测试验收事项

1. **路由测试**：
   - 未登录访问 /admin → 跳 /login
   - 未登录访问 /store → 跳 /login
   - 未登录访问 /guild → 跳 /login（修复后）
   - 未登录访问 /shop /me /friends /profile → 跳 /login
   - user 角色访问 /admin → Forbidden 或重定向到 /guild
   - user 角色访问 /store → Forbidden 或重定向到 /guild
   - instance_admin 访问 /admin → Forbidden
   - instance_admin 访问 /guild → 正常（服主也可消费）
   - server_admin 访问 /store /guild → 正常（越级访问）
   - 登录后访问 /login → 按角色跳转对应基座

2. **首页加载测试**：
   - /admin 加载 AdminDashboard，KPI 数据正常显示
   - /store 加载 StoreHome（新），运营数据正常显示
   - /guild 加载 GuildDock（新），玩家数据正常显示
   - 三首页 Loading 态/Skeleton 正常
   - 三首页 Error 态+重试按钮正常
   - 三首页空状态正常（新用户/新服主/无数据）

3. **导航测试**：
   - 三层侧边栏/底部 tab 激活态正确
   - 面包屑路径正确
   - 移动端底部 tab 跳转正常
   - 跨基座切换（高权限用户）正常
   - 退出登录后跳转到对应公开落地页

4. **移动端测试**：
   - Guild 门户所有页面移动端单列滚动正常
   - 底部 tab 可点击、不溢出
   - 横滑卡片区域正常
   - 输入框唤起键盘不遮挡内容
   - 100dvh 高度正确，底部 tab 不被地址栏遮挡

5. **视觉差异化测试**：
   - /admin 专业暗色后台风格
   - /store 暗色运营工作台风格
   - /guild 亮色 C 端电商风格
   - 三层切换时主题色/背景色正确切换

6. **E2E 流程测试**：
   - 未登录 → / → 选"我是玩家" → /login?from=player → 登录 user 账号 → /guild
   - 未登录 → / → 选"我是服主" → /login?from=owner → 登录 instance_admin 账号 → /store
   - 未登录 → / → 选"先看看" → demo user 自动登录 → /guild
   - 已登录 server_admin → / → /admin
   - /guild 点击服务器卡片 → /guild/servers/:id → ServerDetailGuild 正常
   - /store 点击实例卡片 → /store/servers/:id → ServerDetailStore 正常
   - /admin 点击实例 → /admin/servers/:id → ServerDetailAdmin 正常

### 3.17 版本号与部署

1. 此为中版本递增（新功能增加），按 bb.md 规则升级版本号 x.x+1.0
2. 更新 version.md 记录本次三层入口完善
3. 部署前关闭现有服务（rules/1.md）
4. 部署后验证：
   - 访问 https://gsp.ecsrz.com:3001/ 显示 IdentitySelector
   - 访问 https://gsp.ecsrz.com:3001/login 显示登录页
   - 登录 user 账号跳 https://gsp.ecsrz.com:3001/guild
   - 登录 instance_admin 账号跳 https://gsp.ecsrz.com:3001/store
   - 登录 server_admin 账号跳 https://gsp.ecsrz.com:3001/admin
   - 页面顶部/底部显示 BUILD ID 编码核对部署版本
   - grep 构建产物确认无 localhost:3000/127.0.0.1:3000 违规引用

---

## 四、文件修改清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `panel/frontend/src/App.tsx` | 修改 | 修复路由结构（GuildLayout 移入 ProtectedRoute、/store 和 /guild 改为 path 挂载、子路由改相对路径、补全重定向） |
| `panel/frontend/src/components/Layout.tsx` | 修改 | 补全 PATH_ACTIVE_MAP、面包屑、player variant 顶部栏增强、CSS 变量主题、退出跳转逻辑修正 |
| `panel/frontend/src/pages/IdentitySelector.tsx` | 修改 | 跳转逻辑改为登录/注册引导、demo一键登录、增加返回/登录/注册链接 |
| `panel/frontend/src/pages/Login.tsx` | 修改 | 读取 from 参数、上下文标题、返回按钮、注册链接带角色参数 |
| `panel/frontend/src/pages/store/StoreHome.tsx` | 重写 | 服主工作台运营首页（替代租服 Mock） |
| `panel/frontend/src/pages/guild/GuildDock.tsx` | 重写 | 玩家门户首页（接入真实 API，C 端电商风格） |
| `panel/frontend/src/pages/Register.tsx` | 检查/修改 | 角色预选参数适配 |
| `panel/frontend/src/pages/Home.tsx` | 小幅修改 | CTA 跳转带 from=owner 参数 |
| `panel/frontend/src/pages/PlayerHome.tsx` | 小幅修改 | CTA 跳转带 from=player 参数 |
| `panel/frontend/src/layouts/AdminLayout.tsx` | 无需改动 | 已是简单包装 |
| `panel/frontend/src/layouts/StoreLayout.tsx` | 无需改动 | 已是简单包装 |
| `panel/frontend/src/layouts/GuildLayout.tsx` | 无需改动 | 已是简单包装 |
| `panel/frontend/src/pages/shop/` 或 Shop.tsx | 修改 | 适配 guild 风格 |
| `panel/frontend/src/pages/MyAssets.tsx` | 修改 | 适配 guild 风格 |
| `panel/frontend/src/styles/` | 新增/修改 | guild 专属样式、CSS 变量主题 |
| 后端 API | 新增/确认 | /store/overview、/player/overview 等聚合接口 |

---

## 五、建议实施顺序

1. **路由结构修复**（App.tsx）——不修复后续开发无法验证
2. **Layout 增强**（PATH_ACTIVE_MAP、面包屑、player 顶部栏）——基础导航
3. **StoreHome 重写**——服主工作台首页
4. **GuildDock 重写**——玩家门户首页
5. **IdentitySelector 改造**——转化闭环
6. **Login/Register 增强**——上下文衔接
7. **公开页 CTA 参数修正**——/home /player CTA 带参数
8. **Shop/MyAssets 等 guild 子页风格适配**
9. **实例详情三视图确认/补全**
10. **CSS/样式/主题色完善**
11. **移动端适配优化**
12. **后端接口联调**
13. **E2E 测试**
14. **版本号更新 + 部署验证**
