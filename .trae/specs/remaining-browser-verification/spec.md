# 剩余验证项浏览器端到端验证 - Product Requirement Document

## Overview
- **Summary**: 对 extend-pack-schema-for-factorio、add-in-game-chat-commands、verify-deploy-and-fix-web-init 三个 spec 中未完成的浏览器可验证项进行一次性端到端验证，覆盖 5 款 Pack 的实例详情 Tab、聊天命令相关页面、管理后台功能、Pack 与版本管理等，总计 40+ 个验证点。
- **Purpose**: 之前三个 spec 因"需真实游戏二进制"或"未启动手动验证"而残留未勾选项，导致 spec 无法正式闭合。通过浏览器自动化验证，可以将其中大部分"UI 层 + API 层"的验证项闭合，仅剩真正需要游戏运行时的少数项。
- **Target Users**: 项目维护者 / QA / 交付审查

## Goals
- 验证 extend-pack-schema-for-factorio 中 Task 22 的 11 项端到端检查中，UI 层和 API 层可验证的部分
- 验证 add-in-game-chat-commands 中各页面的 UI 渲染与交互正确性
- 验证 verify-deploy-and-fix-web-init 中安装向导相关的前端行为
- 输出可验证的证据链（截图 + 控制台日志 + 网络请求记录）
- 将三个 spec 的残留验证项最大限度闭合

## Non-Goals (Out of Scope)
- 不验证需要真实游戏二进制运行的项（如游戏内命令实际生效、RCON 实际连接、Mod 实际加载等）
- 不修改任何代码，纯验证
- 不进行性能测试和压力测试
- 不验证 Daemon 侧进程生命周期逻辑（仅验证 Panel 侧 UI/API）

## Background & Context
- 当前线上部署版本：v3.5.2，地址 gsp.ecsrz.com:3000
- 三个部分完成的 spec：
  1. **extend-pack-schema-for-factorio**：21/22 tasks 完成，Task 22 端到端验证 11 项全部 `[ ]`
  2. **add-in-game-chat-commands**：12 tasks 标记 `[x]` 但大量 sub-task `[ ]`，需真实游戏实例
  3. **verify-deploy-and-fix-web-init**：5/6 tasks 完成，Task 1 手动备份重置未做
- 内置浏览器可访问公网部署环境，验证 UI 渲染、页面导航、表单交互、API 响应等
- Demo 账号可用：admin@local.dev / admin123（server_admin）

## Functional Requirements
- **FR-1**: 登录页验证 — demo 账号一键登录功能、三种角色切换、表单状态
- **FR-2**: 实例列表验证 — 5 款 Pack 的实例展示、归属者列、版本号、状态徽章
- **FR-3**: 实例详情 Tab 验证 — 每款 Pack 对应的 Tab 正确渲染（概览/控制台/配置/世界/Mod/存档/玩家/聊天/更新/商店管理等）
- **FR-4**: 聊天命令相关页面验证 — 玩家绑定页、聊天触发器、玩家加入设置（含离开消息）
- **FR-5**: 管理后台页面验证 — 用户管理、系统配置、Pack 管理、审计日志、Webhook、实例清理、诊断
- **FR-6**: 版本管理验证 — 版本池页面、各 Pack 版本列表、下载按钮、版本选择器
- **FR-7**: 商城相关验证 — 商城品质按 Pack 动态显示、购物车、订单、CDK 兑换
- **FR-8**: 移动端响应式验证 — 窄视口下关键页面布局正确性

## Non-Functional Requirements
- **NFR-1**: 每个验证点必须有截图证据，存放在 `.trae/documents/screenshots/verification-20260717/`
- **NFR-2**: 关键 API 请求必须记录响应状态码和主要字段
- **NFR-3**: 浏览器控制台无严重报错（error 级别）
- **NFR-4**: 页面首屏加载 < 3s（3G 网络除外，默认环境）

## Constraints
- **Technical**: 仅使用内置浏览器进行验证，不编写自动化测试代码
- **Business**: 验证过程不能影响线上数据（不创建/删除实例，不修改敏感配置）
- **Dependencies**: 依赖公网环境 gsp.ecsrz.com:3000 可访问；依赖 demo 账号可用

## Assumptions
- 线上部署的 v3.5.2 版本包含所有已完成 spec 的代码变更
- demo 账号 admin@local.dev / admin123 可用且为 server_admin 角色
- 已有至少 1-2 个测试实例用于验证详情页
- 浏览器可以正常加载 JS/CSS 资源

## Acceptance Criteria

### AC-1: 登录与认证流程
- **Given**: 用户访问登录页
- **When**: 使用 demo 管理员账号一键登录
- **Then**: 成功登录并跳转到 Dashboard/实例列表页，JWT token 存入 sessionStorage
- **Verification**: `programmatic`（检查网络请求 /api/auth/login 返回 200，token 存在）

### AC-2: 实例列表页展示
- **Given**: 已登录为 server_admin
- **When**: 进入实例列表页
- **Then**: 展示所有实例，包含归属者列、版本号、状态徽章，表格布局正常
- **Verification**: `programmatic`（检查 /api/servers 返回 200，列表包含 owner_username 字段）

### AC-3: 实例详情 Tab 动态渲染（Factorio Pack）
- **Given**: 存在 Factorio Pack 的实例
- **When**: 进入该实例详情页
- **Then**: Tab 列表包含 Factorio 特有的 Tab（配置文件/世界生成/Mod/存档/聊天日志/玩家历史/更新），切换 Tab 无报错
- **Verification**: `programmatic`（检查 Tab 元素存在，切换后内容区域更新）

### AC-4: 实例详情 Tab 动态渲染（Minecraft Pack）
- **Given**: 存在 Minecraft Pack 的实例
- **When**: 进入该实例详情页
- **Then**: Tab 列表包含 Minecraft 对应的 Tab，数量少于 Factorio（无世界生成等）
- **Verification**: `programmatic`（检查 Tab 数量与 Pack.ui_tabs 匹配）

### AC-5: 配置文件编辑器
- **Given**: 进入实例详情 → 配置文件 Tab
- **When**: 选择一个配置文件
- **Then**: 编辑器正确展示文件内容，保存按钮存在，UI 布局无错乱
- **Verification**: `human-judgment`（检查编辑器渲染、按钮可用性）

### AC-6: Mod 管理 Tab
- **Given**: 进入实例详情 → Mod Tab
- **When**: 页面加载完成
- **Then**: 展示 Mod 列表（空状态或已有 Mod），开关/添加/删除按钮可用
- **Verification**: `human-judgment`（检查列表结构、操作按钮）

### AC-7: 存档管理 Tab
- **Given**: 进入实例详情 → 存档 Tab
- **When**: 页面加载完成
- **Then**: 展示存档列表（空状态或已有存档），创建/激活/删除按钮存在
- **Verification**: `human-judgment`

### AC-8: 聊天日志 Tab
- **Given**: 进入实例详情 → 聊天日志 Tab
- **When**: 页面加载完成
- **Then**: 聊天日志列表正确渲染（空状态或有数据），时间/玩家/消息列展示正常
- **Verification**: `human-judgment`

### AC-9: 玩家历史 Tab
- **Given**: 进入实例详情 → 玩家历史 Tab
- **When**: 页面加载完成
- **Then**: 玩家进出记录列表，时间/玩家名/事件列展示正常
- **Verification**: `human-judgment`

### AC-10: 版本管理页面
- **Given**: 进入版本管理页
- **When**: 页面加载完成
- **Then**: 展示 5 款 Pack 的版本列表，每款显示已下载版本，下载按钮可交互
- **Verification**: `programmatic`（检查 /api/packs/:id/versions 返回 200）

### AC-11: 玩家绑定页面
- **Given**: 进入玩家绑定页（Profile → 玩家绑定 或 /player-bindings）
- **When**: 页面加载完成
- **Then**: 验证码展示区、绑定说明、绑定状态正确显示
- **Verification**: `human-judgment`

### AC-12: 聊天触发器管理
- **Given**: 实例详情 → 聊天触发器 Tab（管理端）
- **When**: 页面加载完成
- **Then**: 触发器列表包含 mode/cooldown 字段，新建/编辑表单有对应输入项
- **Verification**: `human-judgment`

### AC-13: 玩家加入设置（含离开消息）
- **Given**: 实例详情 → 玩家加入设置 Tab
- **When**: 页面加载完成
- **Then**: 表单包含欢迎消息和离开消息两个输入框，保存按钮可用
- **Verification**: `human-judgment`

### AC-14: 商城品质动态显示（Factorio）
- **Given**: Factorio 实例的商城页
- **When**: 页面加载完成
- **Then**: 商品列表包含"品质"列，下拉/筛选中有 5 档品质选项
- **Verification**: `programmatic`（检查 /api/packs/:id/items-config 返回 quality_tiers > 0 且 support_quality = true）

### AC-15: 商城品质动态隐藏（Minecraft）
- **Given**: Minecraft 实例的商城页
- **When**: 页面加载完成
- **Then**: 商品列表不显示"品质"列，品质相关 UI 元素不存在
- **Verification**: `programmatic`（检查 /api/packs/:id/items-config 返回 quality_tiers = 0 或 support_quality = false）

### AC-16: 管理后台 - 用户管理
- **Given**: 进入 /admin/users
- **When**: 页面加载完成
- **Then**: 用户列表展示，包含角色列，编辑/删除操作可用
- **Verification**: `human-judgment`

### AC-17: 管理后台 - Pack 管理
- **Given**: 进入 /admin/packs
- **When**: 页面加载完成
- **Then**: 5 款 Pack 信息展示，含版本/物品数/UI Tab 列表，重载按钮可用
- **Verification**: `programmatic`（检查 /api/packs 返回 200 且包含 5 个 pack）

### AC-18: 管理后台 - 系统健康
- **Given**: 进入 /admin/system-health
- **When**: 页面加载完成
- **Then**: CPU/内存/磁盘三张资源卡 + 服务状态列表，数据正确展示
- **Verification**: `programmatic`（检查 /api/system/metrics 和 /api/system/health 返回 200）

### AC-19: 管理后台 - 诊断页面
- **Given**: 进入 /admin/diagnostics
- **When**: 点击执行诊断
- **Then**: 诊断结果正常返回，展示结构化信息
- **Verification**: `programmatic`（检查 /api/system/diagnostics 返回 200）

### AC-20: 实例清理页面
- **Given**: 进入 /admin/cleanup
- **When**: 页面加载完成
- **Then**: 展示全量实例概览 + 待清理列表，忽略/确认删除按钮存在
- **Verification**: `programmatic`（检查 /api/admin/cleanup-instances 返回 200）

### AC-21: 浏览器控制台无严重错误
- **Given**: 遍历所有主要页面
- **When**: 每个页面加载完成并交互后
- **Then**: 控制台 error 级别日志为 0（warn 可接受）
- **Verification**: `programmatic`（控制台日志检查）

### AC-22: 移动端响应式（实例列表）
- **Given**: 视口宽度 375px（移动端）
- **When**: 进入实例列表页
- **Then**: 展示卡片式布局而非表格，无横向溢出，触摸目标足够大
- **Verification**: `human-judgment`

## Open Questions
- [ ] 线上是否有 Factorio 和 Minecraft 各至少一个实例用于 Tab 对比验证？
- [ ] 线上 demo 账号是否仍为 admin@local.dev / admin123？
