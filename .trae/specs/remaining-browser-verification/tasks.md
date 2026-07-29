# 剩余验证项浏览器端到端验证 - 实施计划

## [x] Task 1: 登录与基础导航验证
- **Priority**: high
- **Depends On**: None
- **Description**:
  - 访问 gsp.ecsrz.com:3000 登录页
  - 使用 demo 管理员账号一键登录
  - 验证登录成功后跳转
  - 验证侧边栏导航各项可访问
- **Acceptance Criteria Addressed**: AC-1, AC-2
- **Test Requirements**:
  - `programmatic` TR-1.1: 登录页加载成功，标题和表单正确渲染
  - `programmatic` TR-1.2: demo 管理员按钮点击后 /api/auth/login 返回 200，token 存入 sessionStorage
  - `programmatic` TR-1.3: 登录后跳转至 /instances 或 /dashboard
  - `human-judgement` TR-1.4: 侧边栏导航项完整，展开/折叠正常
- **Notes**: 使用 admin@local.dev / admin123

## [x] Task 2: 实例列表与详情 Tab 验证
- **Priority**: high
- **Depends On**: Task 1
- **Description**:
  - 验证实例列表页展示（归属者列、版本号、状态徽章）
  - 进入 Factorio 实例详情（如有），验证所有 Tab 渲染
  - 进入 Minecraft 实例详情（如有），验证 Tab 数量差异
  - 切换各 Tab，验证无控制台错误
- **Acceptance Criteria Addressed**: AC-2, AC-3, AC-4, AC-5, AC-6, AC-7, AC-8, AC-9
- **Test Requirements**:
  - `programmatic` TR-2.1: /api/servers 返回 200，列表含 owner_username 字段
  - `programmatic` TR-2.2: Factorio 实例详情 Tab 数量 ≥ Factorio Pack 声明的 tab 数
  - `programmatic` TR-2.3: Minecraft 实例详情 Tab 数量 < Factorio Tab 数量
  - `programmatic` TR-2.4: 切换 Tab 时无控制台 error
  - `human-judgement` TR-2.5: 配置文件编辑器、Mod 列表、存档列表、聊天日志、玩家历史各页面布局正常
- **Notes**: 如无 Factorio 实例，取第一个支持最多 Tab 的 Pack 实例验证

## [x] Task 3: 聊天命令与玩家绑定相关页面验证
- **Priority**: high
- **Depends On**: Task 1
- **Description**:
  - 验证玩家绑定页（验证码展示、绑定说明）
  - 验证实例详情 → 聊天触发器 Tab（mode/cooldown 字段）
  - 验证实例详情 → 玩家加入设置 Tab（欢迎消息 + 离开消息）
  - 验证 Profile 页的玩家绑定入口卡片
- **Acceptance Criteria Addressed**: AC-11, AC-12, AC-13
- **Test Requirements**:
  - `programmatic` TR-3.1: 玩家绑定页成功加载，验证码区域存在
  - `programmatic` TR-3.2: 聊天触发器列表含 mode 和 cooldown 列
  - `programmatic` TR-3.3: 玩家加入设置表单含 leave_message 输入框
  - `human-judgement` TR-3.4: 三个页面布局正常，表单标签清晰
- **Notes**: add-in-game-chat-commands spec 的主要前端验证点

## [x] Task 4: 管理后台页面验证
- **Priority**: high
- **Depends On**: Task 1
- **Description**:
  - 用户管理页（/admin/users）
  - Pack 管理页（/admin/packs）
  - 系统健康页（/admin/system-health）
  - 诊断页（/admin/diagnostics）
  - 实例清理页（/admin/cleanup）
  - 审计日志、Webhook 等其他管理页
- **Acceptance Criteria Addressed**: AC-16, AC-17, AC-18, AC-19, AC-20
- **Test Requirements**:
  - `programmatic` TR-4.1: /api/users 返回 200，用户列表含角色列
  - `programmatic` TR-4.2: /api/packs 返回 200 且 ≥5 个 pack
  - `programmatic` TR-4.3: /api/system/metrics 和 /api/system/health 返回 200
  - `programmatic` TR-4.4: /api/system/diagnostics POST 返回 200
  - `programmatic` TR-4.5: /api/admin/cleanup-instances 返回 200
  - `human-judgement` TR-4.6: 各管理页面布局正常，数据展示正确
- **Notes**: 诊断页需点击执行按钮触发 POST 请求

## [x] Task 5: 版本管理与商城品质验证
- **Priority**: high
- **Depends On**: Task 1
- **Description**:
  - 版本管理页（/versions）：5 款 Pack 版本列表
  - 实例详情 → 更新 Tab：版本选择器
  - Factorio 实例商城页：品质列显示（5 档）
  - Minecraft 实例商城页：品质列隐藏
- **Acceptance Criteria Addressed**: AC-10, AC-14, AC-15
- **Test Requirements**:
  - `programmatic` TR-5.1: /api/packs/:id/versions 对 5 款 Pack 均返回 200
  - `programmatic` TR-5.2: Factorio pack /items-config 返回 quality_tiers > 0 且 support_quality = true
  - `programmatic` TR-5.3: Minecraft pack /items-config 返回 quality_tiers = 0 或 support_quality = false
  - `human-judgement` TR-5.4: Factorio 商城表含"品质"列，Minecraft 商城表不含
- **Notes**: v3.5.0 版本选择器 + v3.4.5 动态品质的联合验证

## [x] Task 6: 控制台错误与移动端响应式验证
- **Priority**: medium
- **Depends On**: Task 1, 2, 3, 4, 5
- **Description**:
  - 汇总所有页面的控制台 error 日志
  - 移动端 375px 视口下验证实例列表卡片布局
  - 验证无横向溢出
- **Acceptance Criteria Addressed**: AC-21, AC-22
- **Test Requirements**:
  - `programmatic` TR-6.1: 全部页面控制台 error 数为 0
  - `human-judgement` TR-6.2: 移动端实例列表卡片布局正常，无横向溢出
  - `human-judgement` TR-6.3: 移动端侧边栏/导航可正常展开收起
- **Notes**: warn 级别日志可接受
