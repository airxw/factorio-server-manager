---
type: plan
title: 主页与衔接漏斗独立优化方案（/ → 登录 / 身份 / Demo）
date: 2026-07-28
status: draft
independent_of:
  - docs/plans/store-ui-polish-plan.md
  - docs/plans/homepage-visual-upgrade-plan.md
  - docs/plans/homepage-premium-redesign-plan.md
related:
  - panel/frontend/src/pages/LandingV6.tsx
  - panel/frontend/src/landing-v6.css
  - panel/frontend/src/App.tsx
  - panel/frontend/src/pages/Login.tsx
  - panel/frontend/src/pages/SelectIdentity.tsx
  - panel/frontend/src/pages/IdentitySelector.tsx
  - panel/frontend/src/pages/DemoExperience.tsx
  - docs/frontend/pages/login.md
  - docs/plans/demo-page-redesign-light-apple-style.md
  - docs/plans/light-apple-style-redesign.md
tags: [homepage, landing, entry-funnel, login, demo, identity, apple-style]
---

# 主页与衔接漏斗独立优化方案

> **对象**：公网入口 `https://gsp.ecsrz.com:3001/`（未登录主页）及其**衔接页面**（登录、身份选择、Demo、注册/文档等公开链）。  
> **独立**：不并入 `/store` 工作台统一方案；可与 store 并行，但本方案只改「进站漏斗」与营销/认证壳。  
> **约束**：只列执行步骤、开发事项与建议；不估工期、不排人力优先级。默认不改后端鉴权契约；路由行为变更须单列并人工确认。

---

## 0. 工程过程 / 交接状态 / 最终结果

### 工程过程
1. 解析 `App.tsx` 根路由 `RootRedirect` 与公开路由表。  
2. 精读 `LandingV6`（巨型 HTML 字符串 + `useEffect` 剧场）、`landing-v6.css`、`Login`、`SelectIdentity`、`IdentitySelector`、`DemoExperience`。  
3. 对照既有 `homepage-visual-upgrade`（已 deployed）、`homepage-premium-redesign`（in_progress 诊断仍部分有效）、`login.md`（与现码有漂移）。  
4. 产出本独立方案。

### 交接状态
- 当前：分析 + 方案落盘 + 代码核对 + **波次 1 漏斗打通完成（2026-07-28）** + **波次 2 衔接页皮肤统一（批次 B/C/D/E）全部完成（2026-07-28）**。  
- 权威文件：`docs/plans/homepage-entry-funnel-optimization-plan.md`。  
- 核对结论：13 项核心诊断核实通过；已补充 5 处修正（§1 公开路由清单、§3.1 login.md 漂移完整清单、§3.2 SelectIdentity 单身份 UX 断点 + from 不传递、§3.3 IdentitySelector 注释过时、§5.2 档 A 玩家入口现状/建议标注、§5.3 SelectIdentity 改造点细化）+ 2 处附加观察（§3.3 三卡角色叙事不对齐、§3.1 demo 暴露风险），§7 决策清单同步新增 2 条。
- 波次 0 决策冻结（2026-07-28）：①登录跳转=智能直达+from深链 ②演示CTA=页内锚点剧场 ③玩家入口=改/login from=/guild ④Demo账号=生产关闭。
- 波次 1 漏斗打通完成（2026-07-28）：
  - LandingV6：玩家入口 `/player` → `/login` from=/guild；预览/剧场 URL 假路径 `/dashboard` `/join` → 真实 `:3001/store` `:3001/guild`；Hero 演示 CTA 已是页内锚点（无需改）。
  - Login.tsx：`getLoginRedirectPath` 改为 async 智能直达（admin→/admin；单身份→activateIdentity+from深链/基座；多身份/无身份→/select-identity?from=...；预检失败降级）；演示账号入口 `showDemoEntry = import.meta.env.DEV`（生产关闭）。
  - auth.tsx：`login()` 返回值新增 `user: UserInfo`，供 Login 端立即做角色判断。
  - SelectIdentity.tsx：单身份自动直达（不展示选择 UI）；`handleSelectIdentity`/`handleCreateIdentity` 读 `from` 跳深链。
  - login.md：§1/§3/§4/§5/§7/§8/§9/§11 全部漂移点同步修正。
  - 验证：`tsc && vite build` 通过；verify 脚本扫描 dist 无 localhost:3000/127.0.0.1:3000；.env.production 与改动文件源码扫描清洁。
- 波次 2 衔接页皮肤统一（批次 B/C/D/E）全部完成（2026-07-28）：
  - 批次 B Login 换肤：`.login-card` 圆角升 `var(--radius-xl)`=24px、阴影升 `var(--shadow-md)`、max-width 400px、补 `border: 1px solid rgba(0,0,0,0.04)`；新增 `.login-card .btn-primary.btn-block` pill 蓝按钮（border-radius:999px、padding 12px 24px、Apple 蓝阴影 0 4px 16px rgba(0,122,255,0.25)、hover 升 0 6px 24px）。
  - 批次 C SelectIdentity 换肤：`.select-identity-card` 圆角升 `var(--radius-xl)`、阴影升 `var(--shadow-md)`、补 border；`.select-identity-option` 圆角升 `var(--radius-lg)`=20px；`.select-identity-icon` 圆角 18px。Login/SelectIdentity 现视觉同族（24px 卡 + 浅色渐变 option + var(--shadow-md)）。
  - 批次 D `/identity` 重定向：[App.tsx:L337-L340](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/App.tsx#L337-L340) `/identity` 与 `/identity/*` element 改为 `<Navigate to="/" replace />`，移除 `import IdentitySelector`；未登录→LandingV6 主页 CTA，已登录→RootRedirect 角色分流，避免第三套身份营销页（方案 §5.1 收敛建议落地）。`pages/IdentitySelector.tsx` 文件保留作历史参考，未删除（避免破坏性删除，后续波次4 收口时再清理）。
  - 批次 E Demo 浅色化：`demo-experience.css` 整页重写为浅色 Apple 族（背景 `#FBFBFD` + radial-gradient 与 Login/SelectIdentity 同源；文字 `#1D1D1F`/`#6E6E73`/`#86868B`；accent 改 Apple 系统色 `#007AFF`/`#34C759`/`#FF9500`；按钮全改 pill 999px；卡片白底 + 20px 圆角 + var(--shadow-sm/md)）。`DemoExperience.tsx` 文件头注释更新；`DEMO_ROLES.owner.accent` `#5AC8FA`→`#FF9500`（Apple orange，提升白字/白图标对比度，三角色色变为绿/橙/蓝区分度更高）。`DemoShowcase` 共享组件（PlayerHome/Home 也在用）保留深色作「产品预览框」局部（方案 §4.5 功能理由），未在本轮改动。
  - 验证：`tsc --noEmit` + `vite build` 通过；`grep -r "localhost:3000\|127.0.0.1:3000" dist/` 无命中；`.env.production` `VITE_ENABLE_DEMO=false` 确认。
- 波次 3 主页结构化与质感（未开始）：Landing 区块组件化、lucide 替代 replaceEmoji、字距、reduced-motion、chip 真过滤、SEO 元信息。

### 最终结果（本阶段）
- 分析结论见 §1–§3；可执行事项见 §5–§6；核对修正见 §3/§5/§7 各处「现状/建议/漂移」标注；波次 1 产出见交接状态清单。

---

## 1. 入口地图（现状）

```text
浏览器打开 /
  ├─ Auth initializing → loading-screen
  ├─ 已登录 → 按 effectiveRole
  │     server_admin|system_admin|admin → /admin
  │     instance_admin → /store
  │     其他 → /guild
  └─ 未登录 → LandingV6（营销主页）

公开衔接（与主页 CTA / 导航相关）：
  /login              登录（成功 → 代码恒跳 /select-identity）
  /select-identity    登录后身份绑定/切换（业务页，偏表单）
  /identity           IdentitySelector 三角色营销卡（备用入口）
  /demo               DemoExperience（深色演示 + 一键演示账号）
  /register           注册
  /home               同 LandingV6 别名
  /landing            旧 Landing
  /player             PlayerHome（历史玩家入口）
  /docs /api-reference /pack-dev /community /team /blog /contact /privacy …
  /help /setup …

公开但不直接挂在主页 CTA/导航的认证/法务/异常链（执行时须保证视觉同源，避免「精美首页 → 旧壳」）：
  /forgot-password /reset-password /verify-email   密码找回 + 邮箱验证（Login 页内链）
  /terms /privacy                                  协议（Login/Footer 内链）
  /maintenance /500                                503/500 提示页（API client 自动跳）
  /discover                                        公开发现页（登录后重定向 /guild/discover）
  /players/:userId                                 公开玩家档案
```

**主页自身结构（LandingV6）**  
固定顶栏 → Hero（口号 + 双 CTA + 产品预览框）→ Demo Theatre（6 场景自动剧）→ 核心能力 → 游戏网格 → 数字带 → 更新日志 → 三角色 CTA → Footer（含唯一 BUILD 文案）。

**实现形态**  
- 主体是 `BODY_HTML_RAW` 超长模板字符串 → `replaceEmoji` → `dangerouslySetInnerHTML`。  
- 交互/动画在挂载后 `useEffect` 里用原生 DOM（`$`/`$$`、虚拟光标、场景定时器）驱动。  
- 样式独立文件 `landing-v6.css`（已大量 `.landing-v6` 作用域，比 premium 方案诊断时好）。

---

## 2. 诊断：主页

### 2.1 架构债（比「好不好看」更优先）

| 问题 | 证据 | 影响 |
|------|------|------|
| **非 React 页面** | 千行 HTML 字符串 + DOM 剧场 | 难测、难 a11y、难按区块迭代；任何文案改动都在字符串里搜 |
| **双轨入口叙事** | 主页三角色 CTA + `/identity` 三卡 + `/demo` 三角色 + 登录后 `/select-identity` | 用户不知道「选身份」发生在营销页还是登录后 |
| **演示两套** | 页内 Theatre vs 独立 `/demo`（且 Demo 页**深色**） | 浅色主页点「观看演示」进深色页 = 品牌跳戏 |
| **预览假壳** | Hero/Theatre URL 仍用 `/dashboard`、`/join` 等叙事域名路径 | 与真实三基座 `/admin` `/store` `/guild` 不一致，进站后认知落差 |
| **遗留路由未收敛** | `/landing` `/player` `/home` `/identity` 并存 | SEO/分享多入口，维护成本高 |

### 2.2 视觉与内容（在 V6 浅色基线上的剩余问题）

| 问题 | 说明 |
|------|------|
| **图标仍是「字符串 SVG 字典」** | `replaceEmoji` 把 emoji 换成内联 SVG 字符串，不是 `lucide-react` 组件；质感优于 emoji，但仍非设计系统图标 |
| **中文排版** | CSS 已把 Hero 收到 `clamp(..., 5rem)`、`font-weight:800`、字距 `-0.02em`（premium 部分已落地）；section 标题仍 `-0.04em`，中文略挤 |
| **信息密度偏营销长页** | 剧场 + 功能 + 游戏 + 数字 + changelog + CTA，首屏后滚动成本高；转化路径不够「短」 |
| **社会证明弱** | 数字带「11 游戏 / 3 层级 / 5 分钟 / 100% 开源」偏自证，缺可核验背书位（可用「开源协议 + 真实 BUILD + 文档」代替假流水） |
| **游戏 chip 筛选** | UI 有「全部/沙盒…」chip，需确认是否真过滤（若仅装饰则删或做真过滤） |
| **无障碍** | 剧场大量 `div` 按钮语义、下拉靠 hover（触控差）、进度条/场景名对读屏不友好 |

### 2.3 转化路径问题

当前主路径偏：

```text
看很久剧场 → 滚到页底三角色 → /login?from=基座 或 /demo
```

更干净的漏斗应是：

```text
理解价值（短）→ 选路径（服主/玩家/先看）→ 登录或 Demo → 基座
```

Hero 次按钮「5 分钟开服」只 `data-goto="cta"` 滚到页底，**不直接登录/注册**，转化链路偏长。

---

## 3. 诊断：衔接页

### 3.1 `/login`

- 独立 `login-page` 视觉，与 Landing 浅色 Apple 仅部分同源。  
- 成功后**固定** `navigate('/select-identity')`，**忽略** URL/`state` 的 `from`（与 [login.md](file:///home/airxw/Documents/gsp/gameserver-panel/docs/frontend/pages/login.md) 旧描述「回 `/` 再分流」不一致）。  
- 文件头注释写「单身份可直达工作台」，实现未做，一律进选择页。  
- 演示账号折叠：仅 DEV 或 `runtimeMode==='demo'`，合理。  
- 返回 `/` 正确。
- **login.md 漂移点（完整清单，更新文档时一并改正）**：
  - 跳转描述漂移：md 写 `navigate('/')` 再由根路由分流，实际恒跳 `/select-identity`。
  - 输入框类型漂移：md 写 `type="email"` + 浏览器原生校验，实际 [Login.tsx:214](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/Login.tsx#L214) 为 `type="text"`（支持邮箱或用户名，自定义校验）。
  - 标题动态化漂移：md 写「`from` 上下文会改变页面标题与顶栏文案」，实际 [Login.tsx:59](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/Login.tsx#L59) `useDocumentTitle('登录')` 写死，未读 from。
  - 文件头描述漂移：md L4-9 写「按身份数量决定跳转」，实际 Login 端不做数量判断（数量分流在 SelectIdentity 内）。
- **演示账号线上暴露风险**：[Login.tsx:166-167](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/Login.tsx#L166-L167) `showDemoEntry = DEV || runtimeMode === 'demo'`，若生产 `VITE_ENABLE_DEMO=true` 则演示账号邮箱/密码直接外露，需确认策略。

### 3.2 `/select-identity`（登录后）

- 业务必需：无身份创建 / 多身份激活。  
- UI 为 `select-identity-page` 卡片表单风，与营销主页、Workbench、Login 又是第四种壳。  
- admin 角色直接 `Navigate /admin`，合理。
- **单身份 UX 断点**：[SelectIdentity.tsx:194-237](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/SelectIdentity.tsx#L194-L237) 的「多身份」分支在 `identities.length === 1` 时也会命中——单身份用户必须手动点击卡片才能进工作台，与文件头注释「单身份由 Login.tsx 直接跳转，此页不处理」不符（Login 端并未做单身份直达）。
- **from 不传递**：[SelectIdentity.tsx:87-89](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/SelectIdentity.tsx#L87-L89) `handleSelectIdentity` 与 L109-113 `handleCreateIdentity` 均直接 `navigate('/store' 或 '/guild')`，不读取 `from`，导致登录前 `from=/store` 的用户即使选了服主身份也只会到默认基座（此处恰好同向，但 `from=/guild/servers/:id` 这类深链会丢失）。

### 3.3 `/identity`（IdentitySelector）

- 营销三角色卡 + lucide，目标 `/store` `/guild` `/demo`，未登录带 `from` 去 login。  
- 与 Landing 底 CTA **功能重复**，易成死链入口（仅导航偶尔链到）。
- **文件头注释过时**：[IdentitySelector.tsx:3](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/IdentitySelector.tsx#L3) 写「身份选择器（根页面 /）」，实际根页面是 LandingV6（v4.17.0 起改），`/identity` 仅备用入口；废弃重定向时一并改注释。
- **三卡缺「平台管理员」**：仅服主/玩家/先看看，而 [DemoExperience.tsx:44-81](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/DemoExperience.tsx#L44-L81) 的三演示角色含 platform/admin/owner/player 三基座——`/identity` 与 `/demo` 角色叙事不对齐，废弃时不必补，保留作收敛理由。

### 3.4 `/demo`

- 深色主题（文件头写明约束），与主页浅色冲突。  
- 一键登录演示账号进三基座——**强转化工具**，应保留能力、统一皮肤。  
- 与页内 Theatre 职责重叠：一个「嵌入讲故事」，一个「可登录真系统」。

### 3.5 其它公开链

- 文档/社区/团队等：主页导航大量 `data-link`；需保证页面存在且顶栏/页脚语言接近 Landing，避免「精美首页 → 空白或旧后台壳」。  
- 旧 `Landing` / `PlayerHome`：建议标记废弃，避免双主页。

---

## 4. 优化目标（本方案定稿方向）

1. **一条进站故事**：未登录只认 **LandingV6 为唯一主页**；身份选择叙事收敛。  
2. **漏斗变短**：Hero 即给清「演示 / 登录开服 / 我是玩家」；页内剧场降权或缩短。  
3. **衔接页同一浅色家族**：Login / SelectIdentity / Demo（改浅或双肤）共享 token（可抽 `entry-shell` CSS 变量，对齐 landing-v6 的 `--bg/--blue/--t1`）。  
4. **工程可维护**：剧场与区块逐步组件化，停止继续加长 HTML 字符串。  
5. **真实产品映射**：预览与文案对齐 `/store` `/guild` `/admin`，禁止再暗示不存在的 `/dashboard` 产品信息架构。  
6. **信任**：假指标克制；Footer BUILD 唯一；开源与文档可点。  
7. **不碰**：store/admin/guild 业务页皮肤（另案）；不改 JWT/角色模型除非漏斗逻辑显式批准。

---

## 5. 方案设计

### 5.1 信息架构（建议）

| 阶段 | 页面 | 用户决策 |
|------|------|----------|
| 认知 | `/` Landing | 这是什么、是否值得试 |
| 路径 | 主页 CTA 或极简路径条 | 服主 / 玩家 / 先看 |
| 认证 | `/login`（`from` 保留） | 凭证 |
| 身份（仅需要时） | `/select-identity` | 无身份或多重身份 |
| 体验 | `/demo` | 不注册看真系统（演示模式） |
| 落地 | `/store` `/guild` `/admin` | 产品 |

**收敛建议**  
- `/identity`：301/Navigate 到 `/#cta` 或主页路径区，避免第三套选身份。  
- `/home`：保持别名或统一重定向 `/`。  
- `/landing`：文档标废弃，后续重定向 `/`。  
- 页内 Theatre：**保留为「故事」**；「一键进真系统」统一指向 `/demo` 或登录，避免两套演示抢主 CTA。

### 5.2 主页改版策略（分档，可组合）

**档 A — 漏斗与文案（低结构风险）**  
- Hero 三按钮（**现状 → 建议**）：
  - `观看演示` → 现状 `data-goto="demo"` 经事件代理跳 `/demo`，建议保留。
  - `服主登录` → 现状 `data-nav="owner"` 跳 `/login` state.from=/store（[LandingV6.tsx:1056](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/LandingV6.tsx#L1056)），建议保留。
  - `玩家入口` → **现状** `data-nav="player"` 跳 `/player`（旧 PlayerHome，[LandingV6.tsx:1057](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/LandingV6.tsx#L1057)）；**建议**改为 `/login` from=/guild（与服主入口对称），或保留 `/player` 但确认 PlayerHome 与 /guild 视觉同源后再决定。
- 预览框侧栏文案改为「工作台 / 实例 / 商城 / 玩家」并与 store 浅色语言接近。  
- Theatre / preview URL 改为 `gsp.ecsrz.com:3001/store` 等真实路径叙事（注意 0.md：页面展示可用公网域名，**代码不得写 localhost:3000**）。当前 [LandingV6.tsx:111/177/654/656](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/LandingV6.tsx#L111) 仍用 `/dashboard` `/join` 假路径，须一并替换。  
- 删或改夸大/难核验数字；changelog 只保留近 3～4 条 + 链 `/help`。  
- 游戏 chip：做真过滤或去掉交互伪饰（当前 [LandingV6.tsx:1036-1038](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/LandingV6.tsx#L1036-L1038) 只切 `on` class 不过滤）。

**档 B — 视觉与组件质感**  
- 抽 `EntryShell`（顶栏简易版可与 Landing nav 共享 token）。  
- 区块 React 化顺序：Footer/CTA → Feat/Games → Hero → 最后 Theatre（最难）。  
- 图标统一 lucide 组件，删 `ICONS` 字符串表与 replaceEmoji。  
- 中文 section 字距收到 `-0.02em`；减少装饰动画在 `prefers-reduced-motion` 下的开销。

**档 C — 剧场工程化**  
- 场景数据驱动（JSON/TS 常量）+ 小组件，替代 innerHTML 场景。  
- 虚拟光标仅 desktop 且 reduced-motion 关闭。  
- 单测：场景切换纯函数；E2E：主 CTA 可达 login/demo。

### 5.3 衔接页统一

**Login**  
- 视觉：浅底、大圆角卡、主按钮 pill 蓝，与 landing token 对齐；保留返回主页。  
- 逻辑建议（**需确认**）：  
  - **L1**：有合法 `from` 且用户角色唯一匹配时，登录后直达 `from` 或角色默认基座，**跳过**选择页。需在 Login.tsx 引入 `listIdentities` 预检（或后端在 login 响应中返回身份数量），并改造 `getLoginRedirectPath()` 不再恒返回 `/select-identity`。  
  - **L2**：多身份或无身份 → `/select-identity`，并携带 `from` 供选完后落地。  
  - 更新 `login.md` 与代码一致（漂移点见 §3.1 完整清单）。  

**SelectIdentity**  
- 套 Entry 浅色壳；两列「服主/玩家」卡视觉靠近 IdentitySelector（可复用卡片样式，**不要**再维护 `/identity` 路由）。  
- 加载/错误用明确空态，避免仅居中「加载中」。
- **单身份自动直达**：`identities.length === 1` 时，应自动 `activateIdentity` 后跳转，不再让用户手动点击（修复 §3.2 单身份 UX 断点）。
- **from 落地改造**：`handleSelectIdentity` 与 `handleCreateIdentity` 两个函数都需读取 `useSearchParams` 的 `from`，在身份类型与 from 目标基座匹配时跳到 `from` 深链（如 `from=/guild/servers/:id` + 选玩家身份 → 跳 from 而非 `/guild`），不匹配则降级到默认基座。当前两函数都写死 `/store` `/guild`。

**DemoExperience**  
- **优先**：改浅色 Apple 族（与 [demo-page-redesign-light-apple-style](file:///home/airxw/Documents/gsp/gameserver-panel/docs/plans/demo-page-redesign-light-apple-style.md) 对齐），深色仅作可选局部（如终端块）。  
- 顶栏：回主页、去登录；三角色一键演示保留。  
- 与 Landing Theatre：主页「完整故事」短版，Demo 页「可操作真账号」。

**Register / 文档类**  
- 最小：同 token 顶栏+页脚；缺页不要从主页链出 404。

### 5.4 明确不做

- 不把主页做成登录后的 Dashboard。  
- 不在主页引入 store Workbench 全套业务组件。  
- 不恢复深色电竞整页主页。  
- 不一次重写全部 Theatre 又同时大改 store（范围爆炸）。

---

## 6. 执行步骤（建议波次）

### 波次 0 — 基线与决策冻结
1. 确认登录后跳转策略（L1 直达 vs 现行永远 select-identity）。  
2. 确认主 CTA：Theatre 锚点 vs 直跳 `/demo`。  
3. 确认 `/identity` `/landing` 废弃方式。  
4. 清单：主页链出的每个 `data-link` 是否 200。

### 波次 1 — 漏斗打通（不重构巨字符串）
1. Hero/导航/底 CTA 的 `navigate` 与 `from` 对齐三基座。  
2. Login 尊重 `from` + 文档同步。  
3. 预览/剧场 URL 与文案去假路径。  
4. 主页 → Login → SelectIdentity → 基座 全路径手测。

### 波次 2 — 衔接页皮肤统一
1. 抽 `entry-tokens`（CSS 变量）供 login / select-identity / demo。  
2. Login、SelectIdentity 换肤。  
3. Demo 浅色化（或按已有 demo 方案落地）。  
4. `/identity` 重定向到主页 CTA。

### 波次 3 — 主页结构化与质感
1. CTA/Footer/Feat/Games 拆组件。  
2. lucide 化、字距、reduced-motion。  
3. chip 真过滤或删除。  
4. SEO：`index.html` description/OG（若 premium 未做完则补）。

### 波次 4 — 剧场工程化与收口
1. 场景数据驱动；削减 DOM 脚本表面积。  
2. E2E：未登录 `/`、主按钮、login、demo。  
3. 0.md 产物扫描；version.md 在编码合并时按 bb.md 记录。  
4. 废弃路由重定向与文档（frontend pages 补 `landing.md` 一页说明）。

**失败回退**：按文件回退 LandingV6 / login；token CSS 可先加后用，避免破坏已登录壳。

---

## 7. 开发事项清单

### 决策（实施前）
- [ ] 登录后：永远 select-identity / 智能直达+条件选择  
- [ ] 主 CTA 演示：页内锚点 / 仅 `/demo` / 双入口文案区分  
- [ ] 废弃 `/identity` `/landing` 是否立即重定向
- [ ] 玩家入口：保留 `/player` 旧入口 / 改跳 `/login` from=/guild（与服主入口对称）
- [ ] 演示账号线上暴露策略：生产环境 `VITE_ENABLE_DEMO` 是否允许 true；若允许，是否需要遮蔽密码明文

### 漏斗
- [ ] Hero/Nav/Footer CTA 与 `from` 三基座对齐  
- [ ] Login `from` 生效 + login.md 改正  
- [ ] SelectIdentity 携带落地  
- [ ] 预览与 Theatre 真实路径文案  
- [ ] data-link 死链排查  

### 视觉与工程
- [ ] entry-tokens + Login/SelectIdentity/Demo 换肤  
- [ ] `/identity` 重定向  
- [ ] Landing 区块组件化（分批）  
- [ ] lucide 替代 replaceEmoji  
- [ ] 游戏 chip 行为  
- [ ] reduced-motion / 基础 a11y  
- [ ] SEO 元信息  
- [ ] E2E 与 0.md 扫描  

---

## 8. 验收标准

1. 未登录打开 `/` 仅为 V6 主页；已登录不闪主页（除 initializing）。  
2. 从主页到服主/玩家基座：路径可说清、`from` 不丢（在选定策略下）。  
3. Login / SelectIdentity / Demo 与主页同属浅色家族（Demo 若保留局部深色须有功能理由）。  
4. 无第三套「身份营销页」与主页抢入口（或明确重定向）。  
5. 无 localhost:3000；公网展示地址合法。  
6. Footer 仅一处 BUILD；无页顶重复 BUILD。  
7. 主转化按钮 3 步内可达登录或 Demo，无需通读全文 changelog。

---

## 9. 建议

1. **先波次 1 漏斗，再换肤**——否则好看但仍进错基座。  
2. **Demo 浅色化收益高**：主页已浅、Demo 仍深是当前最大「衔接违和」。  
3. **Theatre 不要第一刀重写**；先改 CTA 与 URL 叙事。  
4. 与 store 方案并行时：共享的只有「浅色 Apple token 哲学」，**不要**把 WorkbenchUI 塞进营销页。  
5. `homepage-premium-redesign` 未完成项并入本方案波次 3，避免第三份首页计划继续分叉；本文件为**入口漏斗**权威，旧 premium 标为 superseded-by 本方案（可选元数据）。

---

## 10. 关键文件索引

| 文件 | 角色 |
|------|------|
| [App.tsx](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/App.tsx) `RootRedirect` | 根分流 |
| [LandingV6.tsx](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/LandingV6.tsx) | 主页 |
| [landing-v6.css](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/landing-v6.css) | 主页样式 |
| [Login.tsx](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/Login.tsx) | 登录 |
| [SelectIdentity.tsx](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/SelectIdentity.tsx) | 登录后身份 |
| [IdentitySelector.tsx](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/IdentitySelector.tsx) | 备用三角色 |
| [DemoExperience.tsx](file:///home/airxw/Documents/gsp/gameserver-panel/panel/frontend/src/pages/DemoExperience.tsx) | 演示衔接 |
| [login.md](file:///home/airxw/Documents/gsp/gameserver-panel/docs/frontend/pages/login.md) | 文档（待与代码对齐） |

---

## 11. 与其它方案边界

| 方案 | 关系 |
|------|------|
| store-ui-polish | 登录**之后**的服主基座；本方案在进 /store 前结束 |
| homepage-visual-upgrade | 历史「深→浅」已 deployed；本方案在 V6 浅色上做漏斗与衔接 |
| homepage-premium-redesign | 质感/emoji/SEO 诊断仍有用；执行项并入本方案波次，避免双头 |
| demo-page-redesign | Demo 浅色细节可引用；本方案管 Demo 在漏斗中的位置 |
