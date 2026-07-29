# 论坛新版帖子 Markdown 源

> 用途：替换原帖 [【生活娱乐赛道】Factorio Server Manager【demo】](https://forum.trae.cn/t/topic/48091) 的内容
> 适用范围：直接复制到 Discourse 编辑器使用
> 标题建议改为：**【生活娱乐赛道】Factorio Server Manager v2.15.2【demo】**

---

## 0. 先和大家打个招呼吧

:waving_hand:

- **你是谁**：我是一名工程行业的监理工程师，同时也是一名 Factorio 联机服的腐竹。上次发帖的时候项目还是 v1.0，到现在差不多一周时间，整个系统已经被我"重做"了一遍——**已经升级到 v2.15.2，跨越了 50+ 个版本**。所以原帖里那些"还在开发中""功能不够完善"的描述全部作废，这篇是当前真实状态的完整重写。

- **之前用 TRAE 实现的简单管理**：
  ![之前版本](https://trae-api-cn.mchost.guru/api/ide/v1/text_to_image?prompt=factorio%20server%20manager%20old%20version%20ui%20dashboard%20simple%20industrial%20dark%20theme%20console&image_size=landscape_16_9)

- **你是怎么用 TRAE 把 Demo 做出来的**：说实话，我在监理公司一个监理工程师，天天和钢筋混凝土打交道——跟写代码八竿子打不着。但 Factorio 是我下班后的精神家园，自己搭了个联机服，拉了一群朋友一起玩。玩着玩着问题就来了：每次加个 Mod、改个配置、看看谁在线，给"义子"们发装备，都得 SSH 连上服务器敲命令行，动不动配错一个 JSON 逗号整服崩溃。在电脑面前我是"义父"，不在电脑面前只能装死。

  于是脑子里冒出一个想法：能不能做一个网页版的控制面板，像公司 OA 系统那样，点点鼠标就能管好服务器？我没学过 React，没写过 Node.js 后端，连 TypeScript 怎么拼写都不知道。

  TRAE 帮我跨过了这道天堑。我把需求一句句讲给它听，就像平时跟同事交代工作一样——"我需要一个登录页面，用户名密码登录后跳转到控制台""服务器控制台要能看到 CPU 和内存占用，实时刷新的那种""Mod 要能上传 zip 包，自动解压放到对应目录""要支持多实例，每个实例独立的存档 Mod 玩家名单""游戏内聊天要能自动触发欢迎语、定时推送消息、关键词自动回复，还能投票踢人"。它帮我生成代码骨架，我再对着实际运行效果逐条反馈——"这里按钮点不动""那个日志刷新太快了看不清""VIP 等级算错了""多实例的日志串了""移动端布局乱了"。就这样，设计→生成→验证→修正的循环跑了 50+ 轮次。

  最让我觉得"原来这么简单"的瞬间有几个：第一次是 WebSocket 实时日志推送（以为很复杂，结果改几行配置就通了）；第二次是多实例架构（以为要重写整个后端，结果 TRAE 帮我设计了 `instanceManager` + `instanceStateStore` 的清晰分层）；第三次是 RCON 指令批量下发（CDK 兑换码发奖励的并发处理，原本想着肯定一堆 race condition，结果用事务+乐观锁一次就稳了）。

  这个 Demo 可能代码还不够优雅，但它是一个完全不懂编程的普通人在 TRAE 帮助下，一点一点"聊"出来的作品。希望我的经历能给大家一点信心：只要脑子里有想法，说不说得清楚，TRAE 都愿意听。

---

## 1. Demo 简介

- **是什么**：一个基于 B/S 架构的网页端 Factorio 联机服务器**全生命周期**管理系统，已支持多实例、VIP 会员、商店、CDK 兑换码、聊天增强、投票踢人、热更新等完整运营能力。服主通过浏览器即可全面管理服务器——**支持 PC / 移动端 / PWA 添加到桌面**。

- **面向谁**：
  - Factorio 个人联机服主、游戏社群/公会专职服主
  - 小型商业联机服务器运营者
  - 服务器管理员、Mod 开发者、社群运营人员
  - 不想再 SSH 敲命令行的"懒人"腐竹

- **主要功能**（已远超原帖描述的"基础管理面板"）：

  ### 🖥️ 服务器管理
  - **多实例架构**（v2.0 重构）：创建/启动/停止/删除多个 Factorio 实例，每个实例独立端口、独立存档/Mod/配置/玩家/日志/商店/聊天增强，互不干扰
  - **可视化启停**：状态机按钮（启动→运行中→停止中→已停止/错误），所有危险操作二次确认
  - **存档管理**：上传/下载/重命名/删除，地图生成器（自定义种子与设置），**立即存档**功能（v2.15.0）
  - **Mod 管理**：zip 包上传自动解压，启用/禁用，依赖校验
  - **配置管理**：多配置文件变体（CRUD），`server-settings` / `map-gen-settings` / `map-settings` / `mod-list` 在线编辑与导入导出
  - **版本管理**：在线下载指定 Factorio headless 版本（2.0.76 等），SSE 实时进度，**版本切换器**（停止状态下可一键切换）
  - **自动重启**：崩溃后指数退避自动重启，沿用相同配置

  ### 📊 运维监控
  - **资源监控**：CPU、内存、UPS 采集与图表
  - **实时日志**：WebSocket 推送，按实例隔离，支持过滤、暂停、历史回看、级别着色
  - **聊天监控**：游戏内聊天实时推送
  - **备份与回滚**：一键快照备份，按时间点恢复
  - **Webhook 通知**（v2.15.0 增强）：崩溃、磁盘不足、**下载失败**等事件按 `version:stage` 维度 10 分钟去重推送至 Discord/Slack

  ### 💬 聊天增强系统（v2.4.0 - v2.7.0，四层完整实现）
  每个实例独立配置的四层聊天增强架构：
  | 层级 | 功能 | 状态 |
  |------|------|------|
  | **P1 事件响应层** | 玩家加入欢迎语广播、首次/回归礼包发放、VIP 联动消息 | ✅ v2.4.0 |
  | **P2 主动推送层** | 定时消息推送、变量替换（`{player_name}` `{server_name}` 等） | ✅ v2.5.0 |
  | **P3 被动响应层** | 聊天关键词触发自动回复、规则 CRUD、上下文懒加载 | ✅ v2.6.0 |
  | **P4 社区自治层** | 投票踢人（`/votekick <player>`）、阈值判定、RCON 执行、管理员/VIP 豁免、双冷却期 | ✅ v2.7.0+ |

  ### 🛒 商店与会员体系
  - **VIP 等级体系**：默认规则 VIP N 可购 `tier ≤ N-1` 品质、每日 N 件；VIP ≥5 默认传说品质；admin 全部无限
  - **VIP 自定义能力**（v2.3.0）：`vip_permissions.max_quality` / `daily_limit` 非 NULL 时覆盖默认规则
  - **商店系统**：商品浏览、下单、领取码、品质分级（普通/不凡/稀有/史诗/传说）、VIP 等级校验
  - **CDK 兑换码系统**（v2.15.0 新增）：运营在实例作用域批量生成 8 位兑换码（crypto 随机 + DB 唯一性），玩家可在商店页输入兑换码或游戏内发送 `!claim <code>` 兑换，物品通过 RCON 直接发放到玩家背包，支持事务+乐观锁防重兑

  ### 👥 用户与权限
  - **角色层级**（v2.2.0）：`system_admin > admin > operator > viewer` 四级体系，首个注册账号自动 `system_admin`
  - **玩家绑定**：Factorio 游戏内玩家名与账号绑定，验证码校验
  - **用户管理**：管理员管理用户、封禁、设置 VIP、解绑玩家

  ### 🚀 部署与更新
  - **HTTPS 生产部署**（v2.14.0）：自动加载 SSL 证书，无证书时回退 HTTP
  - **PWA 支持**（v2.15.2）：添加到主屏幕独立运行，`display: standalone`，无浏览器地址栏
  - **热更新系统**：GitHub API 检查 + tarball 下载 + 自动备份 + 一键回退
  - **一键从零部署**（v2.9.1）：`scripts/install.sh` 自动检测依赖、安装 nvm + Node 20 LTS、克隆仓库、构建、后台启动
  - **更新脚本**：`scripts/deploy.sh` 自动备份、打包、推送、热重启

  ### 🎨 UI / 体验
  - **首页全新改版**（v2.12.0）：粒子网络背景 + 鼠标排斥交互、打字机效果副标题、3D 透视仪表盘预览、滚动 reveal 动画、完全响应式
  - **移动端全面优化**（v2.10.0 P1-P3）：顶部栏 + 底部 4 项导航 + 更多面板、表单 16px 防 iOS 缩放、安全区适配、Toast 通知系统
  - **PWA 图标**（v2.15.2）：SVG 矢量 + 192/512 PNG 多尺寸
  - **工业科技风暗色主题**：橙(`#f97316`) + 青(`#06b6d4`) 双主色

- **技术栈**：
  - 后端：Node.js 20 + Express + TypeScript + Knex（SQLite / MySQL / PostgreSQL）
  - 前端：React 19 + TypeScript + Vite 6 + React Router 7
  - 通信：REST + WebSocket（日志/聊天实时推送）+ SSE（下载进度）
  - 认证：JWT + bcrypt
  - 后端 20+ API 路由模块 + 17+ 业务服务模块，前端 20+ 页面组件

---

## 2. Demo 创作思路

- **灵感来源**：
  Factorio 是一款以自动化工厂建造为核心的硬核沙盒游戏，多人联机生态非常活跃。然而，市面上几乎找不到一个能同时兼顾"运维管理"和"社群运营"的综合性工具。我作为一个普通腐竹，管理社群服务器时深受命令行操作和配置文件修改的折磨：Mod 装错了找不到原因、玩家喊卡顿只能干着急、想搞个商店奖励活跃玩家完全无从下手。于是决定自己动手，做一个腐竹真正需要的管理平台。

- **想解决的问题**：
  - **操作门槛高**：原生 Factorio 服务器依赖命令行和 JSON 配置文件，新手极易出错，一次配置失误就可能导致服务器崩溃回档。
  - **功能碎片化**：日志查看、Mod 管理、存档备份、玩家管控需要多工具切换，效率低下，出了问题排查困难。
  - **缺乏运营工具**：原版没有任何商店、VIP、兑换码系统，腐竹只能靠"为爱发电"维系社群，玩家流失率高。
  - **不支持多实例**：一个腐竹开多个服就得部署多套环境。
  - **移动端几乎不可用**：原版只能 SSH + 电脑端操作，出门在外玩家喊"服炸了"只能干瞪眼。

- **为什么做这个方向**：
  我的判断很简单——"**简化运维 + 赋能运营 + 多实例 + 全平台**"是 Factorio 服务器管理工具市场最大的空白。与其做一个仅封装几条 RCON 命令的普通面板，不如依托成熟的 Node.js 生态构建一个**管理+运营+多服+全平台**的一体化平台。既能解决腐竹的基础管理痛点，又能为他们提供独特的商业/社群运营工具，让联机服务器从"纯公益"变成"可持续运营"。这也是我选择 TRAE 来加速开发的原因——作为一个非程序员，要在有限时间内完成这样一个生产级项目，必须有一个能跟上我需求节奏的搭档。

---

## 3. Demo 体验地址

- **在线体验**：[https://trae.ecsrz.com:3000](https://trae.ecsrz.com:3000)
- **首页**：[https://trae.ecsrz.com:3000/home](https://trae.ecsrz.com:3000/home)（无需登录）
- **账号**：`admin` / **密码**：`admin`
- **首页可直接看到** v2.12.0 全新改版的粒子网络背景、3D 透视仪表盘、版本历程时间线等

> 备注：项目仍在快速迭代中，欢迎提 BUG；请勿修改账号密码（重置要走数据库，懒得写管理界面）。我只是真搬砖的工程师，能跑通就不错了。

> 当前部署已启用 HTTPS（v2.14.0），浏览器可能提示证书警告，点继续访问即可。

---

## 4. TRAE 实践过程

- **本次 Demo 开发完全依托 TRAE 的 Agent 模式**，遵循"需求描述 → 代码生成 → 运行验证 → 反馈修正"的闭环流程。v2.x 一共 50+ 个版本、跨越 1 周迭代周期，全部由 TRAE 协助完成。

- **关键截图**（分三台设备开发，公司台式机上班摸鱼写方案，家里台式机晚上有空就跑任务，笔记本装 linux 做测试）：
  - 方案设计阶段
    ![方案设计](https://trae-api-cn.mchost.guru/api/ide/v1/text_to_image?prompt=trae%20IDE%20AI%20agent%20architecture%20design%20plan%20chat%20screenshot&image_size=landscape_16_9)
  - 功能需求变更
    ![功能需求](https://trae-api-cn.mchost.guru/api/ide/v1/text_to_image?prompt=trae%20IDE%20AI%20agent%20feature%20requirement%20change%20chat%20screenshot&image_size=landscape_16_9)
  - 数据库支持 & 第二阶段任务
    ![数据库](https://trae-api-cn.mchost.guru/api/ide/v1/text_to_image?prompt=trae%20IDE%20AI%20agent%20database%20schema%20design%20chat%20screenshot&image_size=landscape_16_9)

- **关键任务对话的 Session ID**（部分代表性节点）：

  - **早期方案阶段**：
    `.68585753159385:45fc73a1322b4b486edffc9564fb65c1_6a3336703a318240132dd448.6a3337d53a318240132dd465.6a3337d52b73dd4041a702f0:Trae CN.T(2026/6/18 08:12:05)`
    `.68585753159385:0db19ccec2d02c31fd018c87c464ed32_6a3404c93a318240132e2ba0.6a345048da7d79f9336a9841.6a3450474f123ac498caff5c:Trae CN.T(2026/6/19 04:08:40)`

  - **功能开发与 bug 修复节点**：
    `.1611242341420048:c9618fa0d26c4b9090d041c33afeb990_6a3e86a44afcfa88a7ace93c.6a3f77674afcfa88a7ad13f5.6a3f775ef9d591ef237e5336:Trae CN.T(2026/6/27 15:10:31)`
    `.1611242341420048:689c381c8483a0f8b5505e70946d3001_6a3f885c4afcfa88a7ad15bf.6a3f885c4afcfa88a7ad15db.6a3f885c4afcfa88a7ad15da:Trae CN.T(2026/6/27 16:22:52)`

---

## 5. 对应的报名审核通过的帖子链接

[https://forum.trae.cn/t/topic/23233](https://forum.trae.cn/t/topic/23233)

---

## 附录：技术架构速览（v2.15.2）

| 维度 | 当前规模 |
|------|---------|
| 后端 API 路由模块 | 20+ |
| 后端业务服务模块 | 17+ |
| 前端页面组件 | 20+ |
| 数据库迁移脚本 | 10+ |
| 核心功能模块 | 8 大类（服务器/运维/聊天增强/VIP/商店/CDK/用户/部署） |
| 已发布版本数 | 50+（v1.0.0 ~ v2.15.2） |

**项目结构**：
```
factorio-server-manager/
├── backend/              # Node.js + Express + TypeScript
│   ├── src/
│   │   ├── routes/       # 20+ API 路由模块
│   │   ├── services/     # 17+ 业务服务模块
│   │   ├── data/         # Knex migrations / schema
│   │   └── index.ts      # 入口
│   ├── config/           # 配置 & version.json
│   └── ssl/              # HTTPS 证书（git ignore）
├── frontend/             # React 19 + Vite 6
│   ├── src/
│   │   ├── pages/        # 20+ 页面组件
│   │   ├── components/   # 通用组件
│   │   └── api/          # API 客户端
│   └── public/           # 静态资源 / PWA manifest
├── scripts/
│   ├── deploy.sh         # 生产部署脚本
│   └── install.sh        # 一键从零部署
├── version.md            # 完整版本历史
└── README.md
```

**GitHub 仓库**：[https://github.com/airxw/factorio-server-manager](https://github.com/airxw/factorio-server-manager)
**完整版本历史**：[version.md](https://github.com/airxw/factorio-server-manager/blob/main/version.md)
